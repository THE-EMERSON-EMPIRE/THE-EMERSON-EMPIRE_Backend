'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const manifest = require('../src/learning/schema-manifest.json');
const migration = manifest.extensions.find(row => row.file === '009-synthetic-historical-evidence.sql');
const sql = readFileSync(join(__dirname, '..', 'learning-migrations', migration.file), 'utf8');
const service = readFileSync(join(__dirname, '..', 'src/learning/LearningService.ts'), 'utf8');
const mentor = readFileSync(join(__dirname, '..', 'src/learning/MentorReviewService.ts'), 'utf8');
const localMigrate = readFileSync(join(__dirname, '..', 'scripts/local-synthetic/learning-migrate.cjs'), 'utf8');
const hostedReadiness = readFileSync(join(__dirname, '..', 'src/hosted-practice/readiness.ts'), 'utf8');
const hostedBootstrap = readFileSync(join(__dirname, '..', 'scripts/hosted-practice/bootstrap.cjs'), 'utf8');

test('historical catalog migration is immutable, metadata-only, local-only, and forward-only', () => {
  assert.equal(migration.local_only, true);
  assert.equal(createHash('sha256').update(sql).digest('hex'), migration.sha256);
  assert.equal(manifest.secured_tables, 15);
  assert.match(sql, /current_database\(\)<>'epdg_synthetic'/);
  assert.match(sql, /current_user<>'epdg_synthetic_operator'/);
  assert.match(sql, /original_work_at timestamptz NOT NULL/);
  assert.match(sql, /source_modified_at timestamptz NOT NULL/);
  assert.match(sql, /source_permission_state text NOT NULL CHECK\(source_permission_state='not_applicable_synthetic'\)/);
  assert.match(sql, /learner_only/);
  assert.match(sql, /CREATE TRIGGER imported_resource_guard BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /CREATE TRIGGER historical_evidence_guard BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON synthetic_learning\.imported_resources,synthetic_learning\.historical_evidence FROM PUBLIC/);
  const statements = sql.replace(/^--.*$/gm, '');
  assert.doesNotMatch(statements, /CREATE POLICY|SECURITY DEFINER|\bDROP\b|\bTRUNCATE\b|INSERT INTO synthetic_learning\.(completions|assignment_receipts)/i);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(migration.file, sql);
});

test('learner reads are bound to its own active enrollment and return dates without creating progress', () => {
  assert.match(service, /FROM synthetic_learning\.imported_resources ir[\s\S]*WHERE \$\{enrollmentScope\}/);
  assert.match(service, /FROM synthetic_learning\.historical_evidence h[\s\S]*WHERE \$\{enrollmentScope\} AND h\.learner_id=\$1/);
  assert.match(service, /original_work_at: row\.original_work_at\.toISOString\(\)/);
  assert.match(service, /history_read_missing/);
  assert.match(service, /history_write/);
  assert.match(service, /history_guards !== 2/);
  assert.match(localMigrate, /GRANT SELECT ON synthetic_learning\.imported_resources,synthetic_learning\.historical_evidence TO epdg_synthetic_app/);
  assert.doesNotMatch(localMigrate, /GRANT (?:INSERT|UPDATE|DELETE)[^;]*imported_resources|GRANT (?:INSERT|UPDATE|DELETE)[^;]*historical_evidence/);
});

test('mentor sees only learner-and-assigned-mentor evidence for its active current enrollment mapping', () => {
  assert.match(mentor, /h\.privacy_decision='learner_and_assigned_mentor'/);
  assert.match(mentor, /if \(!isHostedPractice\(\)\) \{[\s\S]*FROM synthetic_learning\.historical_evidence/);
  assert.match(mentor, /ma\.enrollment_id=e\.id AND ma\.active AND ma\.mentor_user_id=\$1/);
  assert.match(mentor, /ma\.membership_id=ANY\(\$2::uuid\[\]\)/);
  assert.match(mentor, /synthetic_handoff\.enrollment_allowed\(e\.id\)/);
  assert.match(mentor, /JOIN portal_security\.memberships lm[\s\S]*JOIN portal_security\.account_states ls/);
  assert.match(mentor, /FROM epdg\.intern_profiles ip[\s\S]*ip\.is_approved AND ip\.rejection_reason IS NULL/);
  assert.doesNotMatch(mentor, /h\.privacy_decision\s+IN|privacy_decision='learner_only'/);
});

test('local-only migration is excluded from hosted practice bootstrap and readiness ledger', () => {
  assert.match(hostedReadiness, /filter\(migration => !\('local_only' in migration && migration\.local_only\)\)/);
  assert.match(hostedBootstrap, /filter\(m=>!m\.local_only\)/);
});
