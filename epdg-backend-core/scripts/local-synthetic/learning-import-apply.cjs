'use strict';
// Explicit local-only operator command. It stores reviewed synthetic metadata,
// never source bytes or native submission/grade/progress records.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const C = require('./common.cjs');
const fixtures = require('./learning-fixtures.cjs');
const { createLearningImportPlan, ImportPlanError, IMPORT_FORMAT } = require('./learning-import-plan.cjs');
const { identityGate } = require('./learning-migrate.cjs');
const manifest = require('../../src/learning/schema-manifest.json');
const LEARNERS = new Map([['SYNTHETIC-LEARNER-A', 'learner-a@epdg.invalid'], ['SYNTHETIC-LEARNER-B', 'learner-b@epdg.invalid']]);
const VERSION = '2026-11-01-synthetic-historical-evidence-v1';

class ImportApplyHold extends Error {
  constructor(plan) { super('The entire synthetic learning batch is held; no rows were written.'); this.name = 'ImportApplyHold'; this.counts = plan.counts; }
}

function readBundle(file) {
  const absolute = path.resolve(file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size < 2 || stat.size > 1024 * 1024) throw new ImportPlanError();
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { throw new ImportPlanError(); }
  return bundle;
}

async function priorRows(db) {
  const { rows } = await db.query(`SELECT source_id,source_version,source_fingerprint,id::text AS target_id
    FROM synthetic_learning.imported_resources UNION ALL
    SELECT source_id,source_version,source_fingerprint,id::text AS target_id
    FROM synthetic_learning.historical_evidence ORDER BY source_id`);
  return rows;
}

function mappedProgram(bundle, sourceKey) {
  const row = bundle.mappings.programs.find(value => value.source_key === sourceKey);
  if (!row || !fixtures.programs.some(program => program.id === row.target_program_id)) throw new ImportPlanError();
  return row.target_program_id;
}
function mappedAssignment(bundle, sourceKey, programId) {
  if (sourceKey === null) return null;
  const row = bundle.mappings.assignments.find(value => value.source_key === sourceKey);
  if (!row || row.target_program_id !== programId) throw new ImportPlanError();
  return row.target_item_id;
}
function mappedLearner(bundle, sourceKey) {
  const person = bundle.mappings.people.find(value => value.source_key === sourceKey);
  const email = person && LEARNERS.get(person.target_learner_key);
  if (!email) throw new ImportPlanError();
  return email;
}

async function eligibleEnrollment(db, programId, learnerEmail, assignmentId = null) {
  const { rows } = await db.query(`SELECT e.id::text AS enrollment_id,e.user_id AS learner_id
    FROM synthetic_learning.enrollments e
    JOIN synthetic_learning.programs p ON p.id=e.program_id AND p.school_id=e.school_id
    JOIN portal_security.memberships m ON m.id=e.membership_id AND m.user_id=e.user_id AND m.active AND m.school_id=e.school_id
    JOIN portal_security.account_states a ON a.user_id=e.user_id AND a.active
    JOIN core.users u ON u.id=e.user_id AND u.deleted_at IS NULL AND u.is_verified AND u.name LIKE 'SYNTHETIC %'
      AND u.email IN ('learner-a@epdg.invalid','learner-b@epdg.invalid')
    WHERE e.program_id=$1 AND e.active AND ($2::text IS NULL OR u.email=$2)
      AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM synthetic_learning.items i WHERE i.id=$3 AND i.program_id=p.id AND i.kind='assignment'))
      AND synthetic_handoff.enrollment_allowed(e.id)
    ORDER BY e.id LIMIT 2`, [programId, learnerEmail, assignmentId]);
  const found = learnerEmail ? rows.length === 1 : rows.length >= 1;
  if (!found) throw new ImportPlanError();
  return learnerEmail ? rows[0] : null;
}

async function applyWithClient(bundle, db, { config = C.config, verifyIdentity = identityGate } = {}) {
  await db.query('BEGIN');
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-synthetic-learning-import-v1'))");
    const migration = manifest.extensions.find(item => item.version === VERSION && item.local_only === true);
    if (!migration) throw new ImportPlanError();
    await verifyIdentity(db, config());
    const { rows: ledger } = await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version');
    const expected = [manifest, ...manifest.extensions].map(({ version, sha256 }) => ({ version, sha256 }));
    if (ledger.length !== expected.length || expected.some((item, index) => ledger[index]?.version !== item.version || ledger[index]?.sha256 !== item.sha256)) {
      throw new ImportPlanError();
    }
    const plan = createLearningImportPlan(bundle, await priorRows(db));
    if (plan.counts.held || plan.counts.failed) throw new ImportApplyHold(plan);
    const bySource = new Map(bundle.resources.map(row => [row.source_id, { kind: 'resource', row }]));
    for (const row of bundle.history) bySource.set(row.source_id, { kind: 'history', row });
    let insertedResources = 0; let insertedEvidence = 0;
    const applied = [];
    for (const decision of plan.rows) {
      if (decision.status === 'existing') { applied.push({ kind: decision.kind, source_id: decision.source_id, target_id: decision.target_id, status: 'existing' }); continue; }
      assert.equal(decision.status, 'accepted');
      const source = bySource.get(decision.source_id);
      if (!source || !decision.target_id || !decision.source_fingerprint) throw new ImportPlanError();
      const programId = mappedProgram(bundle, source.row.program_source_key);
      if (source.kind === 'resource') {
        await eligibleEnrollment(db, programId, null);
        await db.query(`INSERT INTO synthetic_learning.imported_resources(id,batch_id,mapping_version,reviewer_key,source_id,source_version,
          source_fingerprint,program_id,resource_kind,format,title,description,source_ref,rights_use,source_permission_state,source_modified_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [decision.target_id,bundle.batch_id,bundle.mapping_version,
          bundle.reviewer_key,source.row.source_id,source.row.source_version,decision.source_fingerprint,programId,source.row.resource_kind,
          source.row.format,source.row.title,source.row.description,source.row.source_ref,source.row.rights_use,source.row.source_permission_state,
          source.row.source_modified_at]);
        insertedResources += 1;
      } else {
        const learnerEmail = mappedLearner(bundle, source.row.person_source_key);
        const assignmentId = mappedAssignment(bundle, source.row.assignment_source_key, programId);
        const enrollment = await eligibleEnrollment(db, programId, learnerEmail, assignmentId);
        await db.query(`INSERT INTO synthetic_learning.historical_evidence(id,batch_id,mapping_version,reviewer_key,source_id,source_version,
          source_fingerprint,learner_id,enrollment_id,program_id,assignment_id,record_kind,source_format,title,summary,source_ref,
          original_work_at,source_modified_at,source_permission_state,privacy_decision)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [decision.target_id,bundle.batch_id,
          bundle.mapping_version,bundle.reviewer_key,source.row.source_id,source.row.source_version,decision.source_fingerprint,
          enrollment.learner_id,enrollment.enrollment_id,programId,assignmentId,source.row.record_kind,source.row.source_format,
          source.row.title,source.row.summary,source.row.source_ref,source.row.original_work_at,source.row.source_modified_at,
          source.row.source_permission_state,source.row.privacy_decision]);
        insertedEvidence += 1;
      }
      applied.push({ kind: decision.kind, source_id: decision.source_id, target_id: decision.target_id, status: 'inserted' });
    }
    await db.query('COMMIT');
    return { format: IMPORT_FORMAT, environment: 'synthetic-local', batch_id: bundle.batch_id, mapping_version: bundle.mapping_version,
      reviewer_key: bundle.reviewer_key, counts: plan.counts, inserted: { resources: insertedResources, historical_evidence: insertedEvidence },
      rows: applied, transfer_status: 'metadata_only', production_touched: false, real_records_used: false };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function applyFile(file) {
  const bundle = readBundle(file);
  const c = C.config();
  await C.preflight(c);
  const db = await C.client(c, true);
  try { return await applyWithClient(bundle, db); } finally { await db.end(); }
}

async function main(argv = process.argv.slice(2)) {
  const file = argv.find(value => value !== '--apply');
  if (!file || argv.length > 2 || (argv.length === 2 && !argv.includes('--apply'))) {
    process.stderr.write('Usage: node scripts/local-synthetic/learning-import-apply.cjs <synthetic-manifest.json> [--apply]\n');
    process.exitCode = 2; return;
  }
  try {
    if (!argv.includes('--apply')) {
      const plan = createLearningImportPlan(readBundle(file));
      process.stdout.write(`${JSON.stringify(plan)}\n`); return;
    }
    const receipt = await applyFile(file);
    fs.mkdirSync(C.state, { recursive: true });
    const output = path.join(C.state, `learning-import-${receipt.batch_id}-${Date.now()}.receipt.json`);
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ batch_id: receipt.batch_id, counts: receipt.counts, inserted: receipt.inserted, receipt: output })}\n`);
  } catch (error) {
    if (error instanceof ImportApplyHold) process.stderr.write(`${JSON.stringify({ error: 'synthetic_batch_held', counts: error.counts })}\n`);
    else process.stderr.write('Synthetic learning import was not confirmed; no source contents were logged.\n');
    process.exitCode = 1;
  }
}

module.exports = { applyWithClient, applyFile, eligibleEnrollment, readBundle, ImportApplyHold };
if (require.main === module) void main();
