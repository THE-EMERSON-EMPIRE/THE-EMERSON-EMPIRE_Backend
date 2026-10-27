'use strict';

// Synthetic rehearsal adapter only. These caller-supplied source assertions are
// not production CRM authentication or HR clearance. Never load real CRM/HR data
// here. An application-side, authenticated CRM adapter remains a separate gate.
const { createHash, createHmac, randomUUID } = require('node:crypto');
const http = require('node:http');

const path = '/internal/crm/onboarding-handoffs';
const keyId = 'synthetic-local-v1';
const fixtures = Object.freeze({
  reviewer: '80000000-0000-4000-8000-000000000001',
  person: '81000000-0000-4000-8000-000000000001',
  application: '82000000-0000-4000-8000-000000000001',
  program: '83000000-0000-4000-8000-000000000001',
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clearanceKeys = ['identity_verified', 'onboarding_complete', 'agreements_complete', 'hr_approved'];
const wireKeys = ['version', 'source', 'environment', 'event_id', 'person_id', 'application_id', 'program_id',
  'decision_id', 'decision_version', 'decision', 'issued_at', 'policy_version', 'reviewer_id', 'clearance', 'withdrawn'];
const invalid = () => new Error('Invalid synthetic CRM handoff input');

function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key)) ||
      required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw invalid();
  return value;
}
function identifier(value) { if (typeof value !== 'string' || !uuid.test(value)) throw invalid(); return value; }
function revision(value) { if (!Number.isInteger(value) || value < 1 || value > 1000000) throw invalid(); return value; }
function iso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid();
  return value;
}
function decisionFields(value) {
  if (!['cleared', 'held', 'revoked'].includes(value.decision) || typeof value.withdrawn !== 'boolean' ||
      clearanceKeys.some(key => typeof value[key] !== 'boolean') ||
      (value.decision === 'cleared' && (value.withdrawn || clearanceKeys.some(key => value[key] !== true)))) throw invalid();
}

/** Returns an owned serialization Buffer. Preserve these exact bytes for retry;
 * Buffers are mutable, so callers must not alter this returned copy after use. */
function buildSyntheticCrmEvent(input, options) {
  record(input, ['actor', 'application', 'decision']);
  record(options, ['eventId'], ['issuedAt']);
  const actor = record(input.actor, ['id', 'active', 'hr', 'verifiedByServer', 'synthetic']);
  const application = record(input.application, ['id', 'person_id', 'program_id', 'revision', 'access', 'synthetic']);
  const decision = record(input.decision, ['id', 'reviewer_id', 'application_revision', 'decision_version', 'decision',
    ...clearanceKeys, 'withdrawn', 'current', 'policy_version', 'synthetic']);
  if (actor.id !== fixtures.reviewer || actor.active !== true || actor.hr !== true || actor.verifiedByServer !== true ||
      actor.synthetic !== true || application.id !== fixtures.application || application.person_id !== fixtures.person ||
      application.program_id !== fixtures.program || application.access !== 'hr' || application.synthetic !== true ||
      decision.reviewer_id !== actor.id || decision.current !== true || decision.synthetic !== true ||
      decision.policy_version !== 'synthetic-onboarding-v1' || revision(application.revision) !== revision(decision.application_revision)) throw invalid();
  decisionFields(decision);
  const event = {
    version: 1, source: 'emerson-crm-synthetic', environment: 'synthetic-local',
    event_id: identifier(options.eventId), person_id: application.person_id, application_id: application.id,
    program_id: application.program_id, decision_id: identifier(decision.id), decision_version: revision(decision.decision_version),
    decision: decision.decision, issued_at: iso(options.issuedAt === undefined ? new Date().toISOString() : options.issuedAt),
    policy_version: decision.policy_version, reviewer_id: actor.id,
    clearance: Object.fromEntries(clearanceKeys.map(key => [key, decision[key]])), withdrawn: decision.withdrawn,
  };
  return Buffer.from(JSON.stringify(event), 'utf8');
}

function ownedWireBytes(body) {
  if (!(typeof body === 'string' || Buffer.isBuffer(body))) throw invalid();
  const raw = Buffer.from(body);
  if (!raw.length || raw.length > 8192 || !Buffer.from(raw.toString('utf8'), 'utf8').equals(raw)) throw invalid();
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
  record(event, wireKeys); record(event.clearance, clearanceKeys);
  if (event.version !== 1 || event.source !== 'emerson-crm-synthetic' || event.environment !== 'synthetic-local' ||
      event.person_id !== fixtures.person || event.application_id !== fixtures.application || event.program_id !== fixtures.program ||
      event.reviewer_id !== fixtures.reviewer || event.policy_version !== 'synthetic-onboarding-v1') throw invalid();
  identifier(event.event_id); identifier(event.decision_id); revision(event.decision_version); iso(event.issued_at);
  decisionFields({ decision: event.decision, withdrawn: event.withdrawn, ...event.clearance });
  return raw;
}

function signSyntheticCrmRequest(body, options) {
  record(options, ['key'], ['timestamp', 'nonce']);
  const raw = ownedWireBytes(body);
  const encoded = options.key;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw invalid();
  const key = Buffer.from(encoded, 'base64url');
  try {
    if (key.length !== 32 || key.toString('base64url') !== encoded) throw invalid();
    const timestamp = options.timestamp === undefined ? String(Math.floor(Date.now() / 1000)) : options.timestamp;
    const nonce = identifier(options.nonce === undefined ? randomUUID() : options.nonce);
    if (typeof timestamp !== 'string' || !/^[1-9][0-9]{9,10}$/.test(timestamp)) throw invalid();
    const digest = createHash('sha256').update(raw).digest('hex');
    const signature = createHmac('sha256', key).update(`EPDG-CRM-HANDOFF-V1\nPOST\n${path}\n${timestamp}\n${nonce}\n${digest}`).digest('hex');
    return Object.freeze({
      'Content-Type': 'application/json',
      'X-EPDG-Handoff-Key-Id': keyId,
      'X-EPDG-Handoff-Timestamp': timestamp,
      'X-EPDG-Handoff-Nonce': nonce,
      'X-EPDG-Handoff-Signature': signature,
    });
  } finally { key.fill(0); raw.fill(0); }
}

/** Fixed local TCP destination, no redirects/proxy/browser credentials. Keys and
 * responses are never persisted or logged. The caller decides how to handle a
 * bounded { status, body } receipt, including expected 409 conflicts. */
function sendSyntheticCrmRequest(body, options) {
  const raw = ownedWireBytes(body);
  const headers = signSyntheticCrmRequest(raw, options);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, receipt) => {
      if (finished) return;
      finished = true; clearTimeout(deadline);
      if (error) reject(error); else resolve(receipt);
    };
    const request = http.request({ hostname: '127.0.0.1', port: 58000, path, method: 'POST',
      agent: false, headers: { ...headers, 'Content-Length': String(raw.length) }, timeout: 5000 }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) { request.destroy(new Error('Synthetic handoff response exceeds limit')); return; }
        chunks.push(chunk);
      });
      response.on('error', () => finish(new Error('Synthetic handoff response failed')));
      response.on('end', () => {
        if (bytes > 16384) return;
        if (!response.statusCode || response.statusCode >= 300 && response.statusCode < 400) {
          finish(new Error('Synthetic handoff redirects are forbidden')); return;
        }
        try { finish(null, { status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { finish(new Error('Synthetic handoff response is not bounded JSON')); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('Synthetic handoff request timed out')), 5000);
    request.on('timeout', () => request.destroy(new Error('Synthetic handoff request timed out')));
    request.on('error', () => finish(new Error('Synthetic handoff request failed')));
    request.on('close', () => raw.fill(0));
    request.end(raw);
  });
}

module.exports = { buildSyntheticCrmEvent, signSyntheticCrmRequest, sendSyntheticCrmRequest };
