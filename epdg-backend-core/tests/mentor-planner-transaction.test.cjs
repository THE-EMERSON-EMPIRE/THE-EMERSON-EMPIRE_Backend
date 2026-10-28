'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const database = require('../dist/db/index.js');
const learning = require('../dist/learning/LearningService.js');
const handoff = require('../dist/handoff/HandoffService.js');
const { PortalService } = require('../dist/security/PortalService.js');
const { MentorReviewService } = require('../dist/learning/MentorReviewService.js');
const { credentialVersion, hashToken, PortalError } = require('../dist/security/primitives.js');
const { runtimeEnv } = require('../scripts/local-synthetic/common.cjs');
const receipt = '30000000-0000-4000-8000-000000000004';
const mapping = '40000000-0000-4000-8000-000000000004';
const membership = '50000000-0000-4000-8000-000000000004';
const attachment = '60000000-0000-4000-8000-000000000004';
const token = 'a'.repeat(43);
const privateSentinel = 'unit-only-private-planner-failure';
const safeEnv = () => runtimeEnv({ instanceId: 'd85bdca2-f5c3-48f7-99ec-b2e01f55a609',
  appPassword: 'test-only-password', jwtSecret: 'j'.repeat(48), certificateSecret: 'c'.repeat(48), csrfSecret: 's'.repeat(48) });

// The real PortalService owns BEGIN/COMMIT/ROLLBACK. This pg-client double
// rejects unscoped planner settings and models their transaction lifetime.
class Client {
  constructor({ failSetting, failWork, publishedDraft = false } = {}) {
    this.options = { failSetting, failWork, publishedDraft }; this.calls = []; this.inTransaction = false;
    this.session = { join_collapse_limit: 8, from_collapse_limit: 8 }; this.local = null; this.workCalls = 0;
  }
  release() { assert.equal(this.inTransaction, false); }
  async query(sql) {
    this.calls.push(sql);
    if (sql === 'BEGIN') { assert.equal(this.inTransaction, false); this.inTransaction = true; this.local = { ...this.session }; return { rows: [] }; }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') { assert.equal(this.inTransaction, true); this.inTransaction = false; this.local = null; return { rows: [] }; }
    assert.equal(this.inTransaction, true, 'All authenticated service work must remain inside the real transaction');
    if (/^SET\b/i.test(sql)) {
      const match = /^SET LOCAL (join_collapse_limit|from_collapse_limit) TO 1$/.exec(sql);
      assert(match, 'Planner settings must never be session/global settings');
      if (this.options.failSetting === match[1]) throw Object.assign(new Error(privateSentinel), { detail: privateSentinel });
      this.local[match[1]] = 1; return { rows: [] };
    }
    if (sql.startsWith('SELECT user_id FROM portal_security.sessions')) return { rows: [{ user_id: 42 }] };
    if (sql.includes('cu.id,cu.name,cu.email,cu.password')) return { rows: [{ id: 42, name: 'SYNTHETIC Mentor A',
      email: 'school-a@epdg.invalid', password: 'test-only-hash', role: 'school', active: true, eligible: true, revision: '1' }] };
    if (sql.includes('FROM portal_security.memberships m WHERE')) return { rows: [{ id: membership, revision: '1', school_id: 11, company_id: null }] };
    if (sql.startsWith('SELECT *,')) return { rows: [{ id: receipt, user_id: 42, revoked_at: null, current: true,
      account_revision: '1', credential_version: credentialVersion('test-only-hash'), membership_fingerprint: hashToken(membership + ':1'),
      expires_at: new Date('2099-01-01T00:00:00Z') }] };
    if (sql.startsWith('UPDATE portal_security.sessions SET last_seen_at')) return { rows: [], rowCount: 1 };
    if (sql.includes("set_config('synthetic_handoff.enabled'") || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    assert.deepEqual(this.local, { join_collapse_limit: 1, from_collapse_limit: 1 }, 'Every mentor query must follow both local planner settings');
    this.workCalls++;
    if (this.options.failWork) throw new Error('unit-only-work-failure');
    if (sql.startsWith('SELECT id FROM synthetic_learning.mentor_assignments')) return { rows: [] };
    if (sql.includes("AS review_state")) return { rows: [] };
    if (sql.startsWith('SELECT ma.id AS mapping_id')) return { rows: [{ mapping_id: mapping, receipt_id: receipt,
      item_id: receipt, program_id: receipt, learner_id: 43, learner_label: 'SYNTHETIC Learner A', program_title: 'SYNTHETIC program',
      assignment_title: 'SYNTHETIC assignment', answer: 'SYNTHETIC answer', submitted_at: new Date('2026-01-01T00:00:00Z'),
      submission_revision: 1, attempt_number: 1,
      attachments: [{ id: attachment, filename: 'synthetic.txt', media_type: 'text/plain', size_bytes: 3,
        sha256: 'a'.repeat(64), uploaded_at: '2026-01-01T00:00:00Z' }] }] };
    if (sql.startsWith('SELECT comment,revision,saved_at')) return { rows: this.options.publishedDraft ? [{ comment: 'SYNTHETIC feedback', revision: 1, saved_at: new Date() }] : [] };
    if (sql.startsWith('SELECT id,comment,revision,published_at')) return { rows: [] };
    if (sql.startsWith('INSERT INTO synthetic_learning.mentor_review_')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT a.filename,a.bytes')) return { rows: [{ filename: 'synthetic.txt', bytes: Buffer.from('abc') }] };
    assert.fail('Unexpected SQL in mentor transaction double');
  }
}
const operations = [
  ['queue', service => service.queue(token)],
  ['review', service => service.review(token, receipt)],
  ['draft', service => service.saveDraft(token, receipt, 'SYNTHETIC feedback', 0)],
  ['publish', service => service.publish(token, receipt, 1)],
  ['download', service => service.download(token, receipt, attachment)],
];
async function harness(options, work) {
  const previous = { ...process.env }, getPool = database.getPool;
  const checkLearning = learning.checkLearningSchema, checkHandoff = handoff.checkHandoffSchema;
  Object.assign(process.env, safeEnv());
  const client = new Client(options);
  database.getPool = () => ({ connect: async () => client });
  const readiness = async () => {
    assert.equal(client.inTransaction, true);
    assert.deepEqual(client.local, { join_collapse_limit: 1, from_collapse_limit: 1 });
    client.calls.push('READINESS');
  };
  learning.checkLearningSchema = readiness; handoff.checkHandoffSchema = readiness;
  try { await work(new MentorReviewService(), client); }
  finally {
    database.getPool = getPool; learning.checkLearningSchema = checkLearning; handoff.checkHandoffSchema = checkHandoff;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test('all mentor operations set transaction-local planner limits after handoff and before readiness or workload', async () => {
  for (const [name, invoke] of operations) await harness({ publishedDraft: name === 'publish' }, async (service, client) => {
    await invoke(service);
    const handoffIndex = client.calls.findIndex(sql => sql.includes("set_config('synthetic_handoff.enabled'"));
    const localIndex = client.calls.indexOf('SET LOCAL join_collapse_limit TO 1');
    assert(handoffIndex > 0 && localIndex > handoffIndex);
    assert.equal(client.calls[localIndex + 1], 'SET LOCAL from_collapse_limit TO 1');
    assert(client.calls.indexOf('READINESS') > localIndex + 1);
    assert(client.workCalls > 0); assert.equal(client.calls.at(-1), 'COMMIT');
    assert.deepEqual(client.session, { join_collapse_limit: 8, from_collapse_limit: 8 }); assert.equal(client.local, null);
    const settingsBefore = client.calls.filter(sql => sql.startsWith('SET ')).length;
    await new PortalService().session(token);
    assert.equal(client.calls.filter(sql => sql.startsWith('SET ')).length, settingsBefore, 'Ordinary session use of the pooled client must not set mentor limits');
    assert.deepEqual(client.session, { join_collapse_limit: 8, from_collapse_limit: 8 }); assert.equal(client.local, null);
  });
});

test('failure of either planner setting rolls back every mentor operation before readiness or workload and redacts the database error', async () => {
  for (const failSetting of ['join_collapse_limit', 'from_collapse_limit']) for (const [, invoke] of operations)
    await harness({ failSetting }, async (service, client) => {
      await assert.rejects(invoke(service), error => error instanceof PortalError && error.statusCode === 503 &&
        ![String(error), error.stack, JSON.stringify(error)].join('\n').includes(privateSentinel) && !Object.hasOwn(error, 'cause'));
      assert.equal(client.calls.at(-1), 'ROLLBACK'); assert.equal(client.workCalls, 0); assert(!client.calls.includes('READINESS'));
      assert.deepEqual(client.session, { join_collapse_limit: 8, from_collapse_limit: 8 }); assert.equal(client.local, null);
    });
});

test('a later mentor workload failure rolls back without retaining either planner limit on the reused client', async () => {
  await harness({ failWork: true }, async (service, client) => {
    await assert.rejects(service.queue(token), /unit-only-work-failure/);
    assert.equal(client.calls.at(-1), 'ROLLBACK'); assert.equal(client.local, null);
    assert.deepEqual(client.session, { join_collapse_limit: 8, from_collapse_limit: 8 });
    const localCalls = client.calls.filter(sql => sql.startsWith('SET LOCAL ')).length;
    await new PortalService().session(token);
    assert.equal(client.calls.filter(sql => sql.startsWith('SET LOCAL ')).length, localCalls);
    assert.equal(client.inTransaction, false);
  });
});
