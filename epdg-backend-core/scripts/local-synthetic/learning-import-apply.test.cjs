'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fixtures = require('./learning-fixtures.cjs');
const manifest = require('../../src/learning/schema-manifest.json');
const { applyWithClient, ImportApplyHold } = require('./learning-import-apply.cjs');
const { IMPORT_FORMAT } = require('./learning-import-plan.cjs');
const program = fixtures.programs[0];
const assignment = program.items.find(item => item.kind === 'assignment');
function bundle() {
  return { format: IMPORT_FORMAT, version: 1, environment: 'synthetic-local', batch_id: 'SYNTHETIC-IMPORT-TEST-1',
    mapping_version: 'SYNTHETIC-MAP-TEST-1', reviewer_key: 'SYNTHETIC-OPERATOR',
    mappings: { programs: [{ source_key: 'SYNTHETIC-SOURCE-PROGRAM-A', target_program_id: program.id }],
      assignments: [{ source_key: 'SYNTHETIC-SOURCE-ASSIGNMENT-A', target_item_id: assignment.id, target_program_id: program.id }],
      people: [{ source_key: 'SYNTHETIC-SOURCE-PERSON-A', target_learner_key: 'SYNTHETIC-LEARNER-A' }] },
    resources: [{ source_id: 'SYNTHETIC-RESOURCE-APPLY-1', source_version: 'v1', program_source_key: 'SYNTHETIC-SOURCE-PROGRAM-A',
      resource_kind: 'guide', format: 'pdf', title: 'SYNTHETIC Import test resource', description: 'SYNTHETIC metadata only.',
      source_ref: 'urn:epdg-synthetic:RESOURCE-APPLY-1', rights_use: 'internal_training', source_permission_state: 'not_applicable_synthetic',
      source_modified_at: '2026-10-30T12:00:00.000Z' }],
    history: [{ source_id: 'SYNTHETIC-HISTORY-APPLY-1', source_version: 'v1', record_kind: 'revision',
      person_source_key: 'SYNTHETIC-SOURCE-PERSON-A', program_source_key: 'SYNTHETIC-SOURCE-PROGRAM-A',
      assignment_source_key: 'SYNTHETIC-SOURCE-ASSIGNMENT-A', source_format: 'docx', title: 'SYNTHETIC Prior draft',
      summary: 'SYNTHETIC Prior work retained as evidence.', source_ref: 'urn:epdg-synthetic:HISTORY-APPLY-1',
      original_work_at: '2026-09-22T15:30:00.000Z', source_modified_at: '2026-09-23T10:00:00.000Z',
      privacy_decision: 'learner_and_assigned_mentor', source_permission_state: 'not_applicable_synthetic' }] };
}
function fakeClient({ prior = [], matchingEnrollment = true } = {}) {
  const calls = []; let inserted = 0;
  return { calls, get inserted() { return inserted; }, async query(sql, values = []) {
    calls.push({ sql, values });
    if (sql === 'SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version') {
      return { rows: [manifest, ...manifest.extensions].map(({ version, sha256 }) => ({ version, sha256 })) };
    }
    if (sql.startsWith('SELECT source_id,source_version,source_fingerprint,id::text AS target_id')) return { rows: prior };
    if (sql.startsWith('SELECT e.id::text AS enrollment_id')) return { rows: matchingEnrollment ? [{ enrollment_id: fixtures.programs[0].enrollmentId, learner_id: 2 }] : [] };
    if (sql.startsWith('INSERT INTO synthetic_learning.')) { inserted++; return { rowCount: 1, rows: [] }; }
    return { rowCount: 0, rows: [] };
  } };
}
const verifyIdentity = async (_db, config) => assert.equal(config, 'synthetic-test-config');

test('apply stores only fully accepted synthetic metadata and returns source dates in no output fields', async () => {
  const db = fakeClient();
  const result = await applyWithClient(bundle(), db, { config: () => 'synthetic-test-config', verifyIdentity });
  assert.equal(db.inserted, 2);
  assert.deepEqual(result.inserted, { resources: 1, historical_evidence: 1 });
  assert.equal(result.transfer_status, 'metadata_only');
  assert.equal(result.production_touched, false);
  assert.equal(result.real_records_used, false);
  assert.equal(result.rows[1].status, 'inserted');
  assert.ok(!JSON.stringify(result).includes('Prior work retained'));
  assert.ok(db.calls.some(call => call.sql === 'COMMIT'));
  assert.equal(db.calls.some(call => call.sql === 'ROLLBACK'), false);
});

test('any held row rolls back the entire batch before an insert', async () => {
  const candidate = bundle(); candidate.history[0].privacy_decision = 'hold';
  const db = fakeClient();
  await assert.rejects(applyWithClient(candidate, db, { config: () => 'synthetic-test-config', verifyIdentity }), error => error instanceof ImportApplyHold);
  assert.equal(db.inserted, 0);
  assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(db.calls.some(call => call.sql === 'COMMIT'), false);
});

test('missing verified synthetic enrollment clearance rolls back with no writes', async () => {
  const db = fakeClient({ matchingEnrollment: false });
  await assert.rejects(applyWithClient(bundle(), db, { config: () => 'synthetic-test-config', verifyIdentity }));
  assert.equal(db.inserted, 0);
  assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
});

test('scope validation queries bind target program, learner, assignment and CRM clearance', async () => {
  const db = fakeClient();
  await applyWithClient(bundle(), db, { config: () => 'synthetic-test-config', verifyIdentity });
  const scopes = db.calls.filter(call => call.sql.startsWith('SELECT e.id::text AS enrollment_id'));
  assert.equal(scopes.length, 2);
  assert.ok(scopes.every(call => call.sql.includes('synthetic_handoff.enrollment_allowed(e.id)')));
  assert.deepEqual(scopes.map(call => [call.values[0], call.values[1], call.values[2]]), [
    [program.id, null, null], [program.id, 'learner-a@epdg.invalid', assignment.id],
  ]);
});
