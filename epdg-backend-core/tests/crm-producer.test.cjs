'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash, createHmac } = require('node:crypto');
const { buildSyntheticCrmEvent: build, signSyntheticCrmRequest: sign, sendSyntheticCrmRequest: send } = require('../scripts/local-synthetic/crm-producer.cjs');

const eventId = '84000000-0000-4000-8000-000000000001';
const decisionId = '85000000-0000-4000-8000-000000000001';
const nonce = '86000000-0000-4000-8000-000000000001';
const issuedAt = '2026-10-24T19:00:00.000Z';
// Public synthetic test vector, never a configured runtime credential.
const key = Buffer.alloc(32, 7).toString('base64url');
function source() {
  return {
    actor: { id: '80000000-0000-4000-8000-000000000001', active: true, hr: true, verifiedByServer: true, synthetic: true },
    application: { id: '82000000-0000-4000-8000-000000000001', person_id: '81000000-0000-4000-8000-000000000001',
      program_id: '83000000-0000-4000-8000-000000000001', revision: 3, access: 'hr', synthetic: true },
    decision: { id: decisionId, reviewer_id: '80000000-0000-4000-8000-000000000001', application_revision: 3,
      decision_version: 1, decision: 'cleared', identity_verified: true, onboarding_complete: true,
      agreements_complete: true, hr_approved: true, withdrawn: false, current: true,
      policy_version: 'synthetic-onboarding-v1', synthetic: true },
  };
}
const buildEvent = input => build(input, { eventId, issuedAt });

test('synthetic CRM proof produces minimal separate owned wire bytes with no source object mutation', () => {
  const input = source(); const before = structuredClone(input); const raw = buildEvent(input); const event = JSON.parse(raw);
  assert.deepEqual(input, before); assert.equal(Buffer.isBuffer(raw), true);
  assert.deepEqual(Object.keys(event), ['version', 'source', 'environment', 'event_id', 'person_id', 'application_id', 'program_id',
    'decision_id', 'decision_version', 'decision', 'issued_at', 'policy_version', 'reviewer_id', 'clearance', 'withdrawn']);
  assert.equal(event.version, 1); assert.equal(event.source, 'emerson-crm-synthetic'); assert.equal(event.environment, 'synthetic-local');
  assert.equal(event.issued_at, issuedAt); assert.equal(event.decision_id, decisionId);
  assert.deepEqual(event.clearance, { identity_verified: true, onboarding_complete: true, agreements_complete: true, hr_approved: true });
  assert.doesNotMatch(raw.toString(), /@|password|resume|onboardingStatus|verifiedByServer|application_revision|"access"/i);
  input.decision.decision_version = 9; assert.equal(JSON.parse(raw).decision_version, 1);
  const other = buildEvent(source()); raw.fill(0); assert.equal(JSON.parse(other).event_id, eventId);
});

test('producer requires active explicitly HR verified synthetic actor and exact approved reviewer', () => {
  for (const field of ['active', 'hr', 'verifiedByServer', 'synthetic']) {
    for (const value of [false, 'true', 1, null, undefined]) { const input = source(); input.actor[field] = value; assert.throws(() => buildEvent(input)); }
  }
  const input = source(); input.actor.id = '80000000-0000-4000-8000-000000000002'; assert.throws(() => buildEvent(input));
});

test('producer requires exact restricted synthetic application and current matching revision', () => {
  for (const field of ['id', 'person_id', 'program_id']) { const input = source(); input.application[field] = eventId; assert.throws(() => buildEvent(input)); }
  for (const value of ['record', 'team', true, undefined]) { const input = source(); input.application.access = value; assert.throws(() => buildEvent(input)); }
  for (const value of [false, 'true', undefined]) { const input = source(); input.application.synthetic = value; assert.throws(() => buildEvent(input)); }
  for (const value of [2, 4, '3', 0, -1, 1.5, 1000001]) { const input = source(); input.decision.application_revision = value; assert.throws(() => buildEvent(input)); }
  for (const field of ['current', 'synthetic']) { const input = source(); input.decision[field] = false; assert.throws(() => buildEvent(input)); }
});

test('stage text, training, private source data and authority fields cannot be smuggled into a proof or options', () => {
  for (const [object, field, value] of [['actor', 'role', 'owner'], ['actor', 'email', 'synthetic@epdg.invalid'],
    ['application', 'onboardingStatus', 'Complete'], ['application', 'resumeUrl', 'https://example.invalid/private'],
    ['application', 'trainingComplete', true], ['decision', 'approved', true], ['decision', 'notes', 'private source text']]) {
    const input = source(); input[object][field] = value; assert.throws(() => buildEvent(input));
  }
  for (const field of ['email', 'url', 'headers']) assert.throws(() => build(source(), { eventId, issuedAt, [field]: 'unsupported' }));
  for (const value of [null, [], 'cleared', Object.create({ actor: source().actor })]) assert.throws(() => buildEvent(value));
});

test('clearance cannot omit any boolean, clear a withdrawn case, use another reviewer or change policy', () => {
  for (const field of ['identity_verified', 'onboarding_complete', 'agreements_complete', 'hr_approved']) {
    for (const value of [false, undefined, 'true', 1]) { const input = source(); input.decision[field] = value; assert.throws(() => buildEvent(input)); }
  }
  for (const [field, value] of [['withdrawn', true], ['withdrawn', 'false'], ['reviewer_id', eventId],
    ['policy_version', 'production'], ['decision', 'Active'], ['decision_version', '1'], ['decision_version', 1000001]]) {
    const input = source(); input.decision[field] = value; assert.throws(() => buildEvent(input));
  }
  for (const decision of ['held', 'revoked']) {
    const input = source(); Object.assign(input.decision, { decision, withdrawn: true, hr_approved: false });
    assert.equal(JSON.parse(buildEvent(input)).decision, decision);
  }
});

test('wire identifiers and timestamps require exact UUID and canonical UTC forms', () => {
  for (const id of [undefined, null, 1, 'not-a-uuid', eventId.toUpperCase()]) {
    // This fixture UUID has no letters; use an uppercase lettered UUID explicitly.
    if (id === eventId) continue;
    assert.throws(() => build(source(), { eventId: id, issuedAt }));
  }
  assert.throws(() => build(source(), { eventId: 'AAAAAAAA-0000-4000-8000-000000000001', issuedAt }));
  for (const value of ['2026-10-24', '2026-10-24T19:00:00Z', '2026-10-24T15:00:00.000-04:00', 'invalid', null]) {
    assert.throws(() => build(source(), { eventId, issuedAt: value }));
  }
});

test('HMAC covers exact body bytes, fixed method/path, timestamp and nonce without modifying caller bytes', () => {
  const raw = buildEvent(source()); const before = Buffer.from(raw); const timestamp = '1792868400';
  const headers = sign(raw, { key, timestamp, nonce });
  const digest = createHash('sha256').update(raw).digest('hex');
  const expected = createHmac('sha256', Buffer.from(key, 'base64url'))
    .update(`EPDG-CRM-HANDOFF-V1\nPOST\n/internal/crm/onboarding-handoffs\n${timestamp}\n${nonce}\n${digest}`).digest('hex');
  assert.equal(headers['X-EPDG-Handoff-Signature'], expected); assert.deepEqual(raw, before);
  assert.equal(headers['X-EPDG-Handoff-Key-Id'], 'synthetic-local-v1'); assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(Object.isFrozen(headers), true); assert.doesNotMatch(JSON.stringify(headers), new RegExp(key));
  const spaced = Buffer.from(JSON.stringify(JSON.parse(raw), null, 1));
  assert.notEqual(sign(spaced, { key, timestamp, nonce })['X-EPDG-Handoff-Signature'], expected);
  assert.notEqual(sign(raw, { key, timestamp, nonce: eventId })['X-EPDG-Handoff-Signature'], expected);
});

test('signing rejects malformed keys/headers and any wire fields outside fixed synthetic fixtures', () => {
  const raw = buildEvent(source());
  for (const bad of [undefined, null, '', key + '=', Buffer.alloc(32), 'a'.repeat(43), key.slice(1)]) assert.throws(() => sign(raw, { key: bad }));
  for (const timestamp of [1, '0', '1792868400.0', '01792868400', '1792868400\n']) assert.throws(() => sign(raw, { key, timestamp }));
  for (const value of ['bad', null, 1, nonce.toUpperCase() + 'A']) assert.throws(() => sign(raw, { key, nonce: value }));
  for (const field of ['email', 'password', 'target', 'url', 'headers']) {
    const event = JSON.parse(raw); event[field] = 'unsupported'; assert.throws(() => sign(JSON.stringify(event), { key }));
    assert.throws(() => sign(raw, { key, [field]: 'unsupported' }));
  }
  const event = JSON.parse(raw); event.person_id = eventId; assert.throws(() => sign(JSON.stringify(event), { key }));
  for (const value of [{}, Buffer.from([0xff]), Buffer.alloc(8193), 'null']) assert.throws(() => sign(value, { key }));
});

test('sender rejects destination/proxy/browser/header overrides before any HTTP request', () => {
  const raw = buildEvent(source());
  for (const field of ['url', 'hostname', 'port', 'path', 'headers', 'proxy', 'redirect', 'credentials']) {
    assert.throws(() => send(raw, { key, [field]: 'forbidden' }));
  }
});
