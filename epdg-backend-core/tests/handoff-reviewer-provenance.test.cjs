'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const configuration = require('../dist/handoff/config.js');
const { HandoffService } = require('../dist/handoff/HandoffService.js');
const { parseHandoffEvent } = require('../dist/handoff/contract.js');
const manifest = require('../src/learning/schema-manifest.json');

const fixture = Object.freeze({
  person: '81000000-0000-4000-8000-000000000001',
  application: '82000000-0000-4000-8000-000000000001',
  program: '83000000-0000-4000-8000-000000000001',
  mapping: '84000000-0000-4000-8000-000000000001',
  originalReviewer: '80000000-0000-4000-8000-000000000001',
  currentReviewer: '80000000-0000-4000-8000-000000000002',
});
const instance = '00000000-0000-4000-8000-000000000001';
function event(version, decision = 'cleared', reviewer = fixture.originalReviewer) {
  return {
    version: 1, source: 'emerson-crm-synthetic', environment: 'synthetic-local',
    event_id: randomUUID(), person_id: fixture.person, application_id: fixture.application,
    program_id: fixture.program, decision_id: randomUUID(), decision_version: version,
    decision, issued_at: new Date().toISOString(), policy_version: 'synthetic-onboarding-v1',
    reviewer_id: reviewer,
    clearance: { identity_verified: true, onboarding_complete: true, agreements_complete: true, hr_approved: true },
    withdrawn: false,
  };
}
function readySchema() {
  return {
    db: 'epdg_synthetic', role: 'epdg_synthetic_app', host: '127.0.0.1', port: 55432,
    instance_id: instance, sha256: manifest.extensions.at(-1).sha256,
    secured_tables: 3, total_tables: 3, policies: 0, schema_create: false,
    mapping_admin: false, event_admin: false, nonce_admin: false, missing_runtime: false,
    guards: 9, definer: false, gate_execute: true, browser_grants: false, unexpected_insert: false,
  };
}

// Service tests fake only SQL results. They prove query/receipt behavior, not a
// live HR permission or database trigger. The fresh-PostgreSQL check is separate.
function fakeClient() {
  const events = new Map();
  const nonces = new Set();
  const calls = [];
  const latest = () => [...events.values()].sort((a, b) => b.decision_version - a.decision_version)[0];
  return {
    calls, events,
    release() {},
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT current_database()')) return { rows: [readySchema()] };
      if (sql.startsWith('SELECT payload_sha256,mapping_id')) return { rows: events.has(values[0]) ? [events.get(values[0])] : [] };
      if (sql.startsWith('SELECT mapping.id')) {
        assert.doesNotMatch(sql, /mapping\.reviewer_id\s*=/);
        assert.deepEqual(values.length, 3);
        return { rows: values[0] === fixture.person && values[1] === fixture.application && values[2] === fixture.program ? [{ id: fixture.mapping }] : [] };
      }
      if (sql.startsWith('SELECT 1 FROM synthetic_handoff.nonces')) return { rows: nonces.has(values[0]) ? [{}] : [] };
      if (sql.startsWith('SELECT decision_version FROM synthetic_handoff.events')) return { rows: latest() ? [latest()] : [] };
      if (sql.startsWith('INSERT INTO synthetic_handoff.events')) {
        events.set(values[0], {
          event_id: values[0], payload_sha256: values[1], mapping_id: values[2], decision_id: values[3],
          decision_version: values[4], decision: values[5], reviewer_id: values[8], withdrawn: values[13],
          received_at: new Date(),
        });
      }
      if (sql.startsWith('INSERT INTO synthetic_handoff.nonces')) nonces.add(values[0]);
      if (sql.startsWith('SELECT decision,withdrawn,decision_version,received_at')) return { rows: latest() ? [latest()] : [] };
      return { rows: [] };
    },
  };
}

async function withIsolatedService(run) {
  const originalConfig = configuration.handoffConfig;
  const originalInstance = process.env.SYNTHETIC_INSTANCE_ID;
  // No operational configuration or key file is loaded; the disposable key is
  // required only because receive() checks its already-authenticated runtime gate.
  configuration.handoffConfig = () => ({ key: Buffer.alloc(32, 4) });
  process.env.SYNTHETIC_INSTANCE_ID = instance;
  const client = fakeClient();
  try {
    return await run(new HandoffService(async () => client), client);
  } finally {
    configuration.handoffConfig = originalConfig;
    if (originalInstance === undefined) delete process.env.SYNTHETIC_INSTANCE_ID;
    else process.env.SYNTHETIC_INSTANCE_ID = originalInstance;
  }
}

test('current signed reviewer revokes the original review and original retry stays withdrawn', async () => {
  await withIsolatedService(async (service, client) => {
    const approved = event(1);
    assert.equal((await service.receive(approved, 'a'.repeat(64), randomUUID())).current_status, 'ready');
    const revoked = event(2, 'revoked', fixture.currentReviewer);
    const result = await service.receive(revoked, 'b'.repeat(64), randomUUID());
    assert.equal(result.current_status, 'withdrawn');
    assert.equal(result.decision_version, 2);
    assert.equal(client.events.get(revoked.event_id).reviewer_id, fixture.currentReviewer);
    assert.equal(client.events.get(approved.event_id).reviewer_id, fixture.originalReviewer);
    const retry = await service.receive(approved, 'a'.repeat(64), randomUUID());
    assert.equal(retry.result, 'duplicate');
    assert.equal(retry.current_status, 'withdrawn');
    assert.equal(retry.decision_version, 2);
    assert.equal(client.events.size, 2);
  });
});

test('different reviewer cannot change the fixed person/application/program mapping', async () => {
  for (const field of ['person_id', 'application_id', 'program_id']) {
    await withIsolatedService(async (service, client) => {
      const value = { ...event(1, 'revoked', fixture.currentReviewer), [field]: randomUUID() };
      await assert.rejects(service.receive(value, 'c'.repeat(64), randomUUID()), error => error.statusCode === 404);
      assert.equal(client.events.size, 0);
      assert.ok(client.calls.some(call => call.sql === 'ROLLBACK'));
      assert.ok(!client.calls.some(call => call.sql === 'COMMIT'));
    });
  }
});

test('reviewer provenance retains strict UUID parsing and private field rejection', () => {
  const valid = event(2, 'revoked', fixture.currentReviewer);
  assert.equal(parseHandoffEvent(Buffer.from(JSON.stringify(valid))).reviewer_id, fixture.currentReviewer);
  for (const invalid of [{ ...valid, reviewer_id: 'not-a-uuid' }, { ...valid, reviewer_email: 'never-exported@fixture.invalid' }]) {
    assert.throws(() => parseHandoffEvent(Buffer.from(JSON.stringify(invalid))), error => error.statusCode === 400);
  }
});

test('forward-only migration preserves 007 and changes only event reviewer equality', () => {
  const original = manifest.extensions.find(entry => entry.file === '007-synthetic-crm-handoff.sql');
  const correction = manifest.extensions.at(-1);
  assert.equal(original.sha256, '2f32810a5956999693d98e3ea9f4ca200da53ae6530da3fb1e08c51ff54a75ca');
  assert.equal(correction.file, '008-synthetic-handoff-reviewer-provenance.sql');
  const oldSql = readFileSync(join(__dirname, '..', 'learning-migrations', original.file), 'utf8');
  const newSql = readFileSync(join(__dirname, '..', 'learning-migrations', correction.file), 'utf8');
  assert.equal(createHash('sha256').update(oldSql).digest('hex'), original.sha256);
  assert.equal(createHash('sha256').update(newSql).digest('hex'), correction.sha256);
  const guard = /CREATE (?:OR REPLACE )?FUNCTION synthetic_handoff\.guard_event\(\)[\s\S]*?\$\$;/;
  assert.equal(
    newSql.match(guard)[0].replace(/\r\n/g, '\n'),
    oldSql.match(guard)[0].replace(/\r\n/g, '\n').replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('mapping.reviewer_id<>NEW.reviewer_id OR ', ''),
  );
  assert.match(newSql, /current_database\(\)<>'epdg_synthetic' OR current_user<>'epdg_synthetic_operator'/);
  assert.doesNotMatch(newSql, /SECURITY DEFINER|CREATE POLICY|CREATE TABLE|GRANT |\bDROP\b|\bTRUNCATE\b|DELETE FROM|INSERT INTO|UPDATE (?:core|epdg|portal_security|synthetic_learning)\./i);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(correction.file, newSql);
});
