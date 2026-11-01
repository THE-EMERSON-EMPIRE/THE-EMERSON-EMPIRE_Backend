import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PortalError } from '../security/primitives';
import { handoffPath } from './config';
import type { PracticeEnvironment } from '../hosted-practice/environment';

export interface HandoffEvent {
  version: 1; source: 'emerson-crm-synthetic'; environment: PracticeEnvironment;
  event_id: string; person_id: string; application_id: string; program_id: string; decision_id: string;
  decision_version: number; decision: 'cleared' | 'held' | 'revoked'; issued_at: string;
  policy_version: 'synthetic-onboarding-v1'; reviewer_id: string;
  clearance: { identity_verified: boolean; onboarding_complete: boolean; agreements_complete: boolean; hr_approved: boolean };
  withdrawn: boolean;
}
const invalid = () => new PortalError(400, 'Invalid synthetic handoff envelope');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isHandoffUuid = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(input, key))) throw invalid();
  return input;
}
// JSON.parse accepts duplicate object keys. A signed envelope must have one
// unambiguous spelling for every field, including the nested clearance object.
function rejectDuplicateKeys(text: string): void {
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  const string = (): string => {
    const start = position++;
    while (position < text.length) {
      if (text[position] === '\\') { position += 2; continue; }
      if (text[position++] === '"') return JSON.parse(text.slice(start, position)) as string;
    }
    throw invalid();
  };
  const value = (depth: number): void => {
    if (depth > 8) throw invalid(); whitespace();
    if (text[position] === '{') {
      position++; whitespace(); const keys = new Set<string>();
      if (text[position] === '}') { position++; return; }
      while (position < text.length) {
        whitespace(); const key = string();
        if (keys.has(key)) throw invalid(); keys.add(key);
        whitespace(); position++; value(depth + 1); whitespace();
        if (text[position++] === '}') return;
      }
    } else if (text[position] === '[') {
      position++; whitespace(); if (text[position] === ']') { position++; return; }
      while (position < text.length) { value(depth + 1); whitespace(); if (text[position++] === ']') return; }
    } else if (text[position] === '"') { string(); return; }
    else { while (position < text.length && !/[\s,}\]]/.test(text[position])) position++; return; }
    throw invalid();
  };
  value(0);
}
export function parseHandoffEvent(raw: Buffer, environment: PracticeEnvironment = 'synthetic-local'): HandoffEvent {
  if (!raw.length || raw.length > 8192 || raw.toString('utf8').includes('\uFFFD')) throw invalid();
  let input: unknown;
  try { input = JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
  rejectDuplicateKeys(raw.toString('utf8'));
  const value = record(input, ['version', 'source', 'environment', 'event_id', 'person_id', 'application_id', 'program_id',
    'decision_id', 'decision_version', 'decision', 'issued_at', 'policy_version', 'reviewer_id', 'clearance', 'withdrawn']);
  if (value.version !== 1 || value.source !== 'emerson-crm-synthetic' || value.environment !== environment ||
      value.policy_version !== 'synthetic-onboarding-v1' ||
      !['event_id', 'person_id', 'application_id', 'program_id', 'decision_id', 'reviewer_id'].every(key => isHandoffUuid(value[key])) ||
      !Number.isInteger(value.decision_version) || Number(value.decision_version) < 1 || Number(value.decision_version) > 1000000 ||
      !['cleared', 'held', 'revoked'].includes(String(value.decision)) || typeof value.withdrawn !== 'boolean' ||
      typeof value.issued_at !== 'string' || !Number.isFinite(Date.parse(value.issued_at)) ||
      new Date(value.issued_at).toISOString() !== value.issued_at) throw invalid();
  const clearance = record(value.clearance, ['identity_verified', 'onboarding_complete', 'agreements_complete', 'hr_approved']);
  if (Object.values(clearance).some(item => typeof item !== 'boolean') ||
      (value.decision === 'cleared' && (value.withdrawn || Object.values(clearance).some(item => item !== true)))) throw invalid();
  return value as unknown as HandoffEvent;
}

export const handoffDigest = (raw: Buffer): string => createHash('sha256').update(raw).digest('hex');
export interface HostedHandoffAudience { backendOrigin: string; crmOrigin: string }
export function handoffSigningText(timestamp: string, nonce: string, raw: Buffer, hosted?: HostedHandoffAudience): string {
  if (hosted) return `EPDG-CRM-HOSTED-PRACTICE-V1\nPOST\n${handoffPath}\n${hosted.backendOrigin}\n${hosted.crmOrigin}\n${timestamp}\n${nonce}\n${handoffDigest(raw)}`;
  return `EPDG-CRM-HANDOFF-V1\nPOST\n${handoffPath}\n${timestamp}\n${nonce}\n${handoffDigest(raw)}`;
}
export function verifyHandoffSignature(key: Buffer, timestamp: unknown, nonce: unknown, signature: unknown, raw: Buffer,
  nowMs = Date.now(), hosted?: HostedHandoffAudience): { nonce: string; digest: string } {
  if (typeof timestamp !== 'string' || !/^[1-9][0-9]{9,10}$/.test(timestamp) || !isHandoffUuid(nonce) ||
      typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) throw new PortalError(401, 'Handoff authentication required');
  const age = nowMs / 1000 - Number(timestamp);
  if (age > 300 || age < -30) throw new PortalError(401, 'Handoff authentication required');
  const expected = createHmac('sha256', key).update(handoffSigningText(timestamp, nonce, raw, hosted)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new PortalError(401, 'Handoff authentication required');
  return { nonce, digest: handoffDigest(raw) };
}
export function requireFreshIssuedAt(event: HandoffEvent, nowMs = Date.now()): void {
  const age = nowMs - Date.parse(event.issued_at);
  if (age > 300000 || age < -30000) throw invalid();
}
