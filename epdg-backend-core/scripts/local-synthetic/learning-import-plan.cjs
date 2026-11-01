'use strict';
const crypto = require('node:crypto');
const fixtures = require('./learning-fixtures.cjs');

const RESOURCE_KINDS = new Set(['guide', 'reading', 'template', 'presentation', 'training', 'other']);
const FORMATS = new Set(['docx', 'pdf', 'xlsx', 'pptx', 'image', 'video', 'audio', 'link', 'other']);
const EVIDENCE_KINDS = new Set(['deliverable', 'revision', 'mentor_feedback', 'evaluation']);
const LEARNERS = new Map([
  ['SYNTHETIC-LEARNER-A', 'learner-a@epdg.invalid'],
  ['SYNTHETIC-LEARNER-B', 'learner-b@epdg.invalid'],
]);
const IMPORT_FORMAT = 'epdg-synthetic-learning-import';

class ImportPlanError extends Error {
  constructor() { super('The synthetic learning import manifest could not be verified.'); this.name = 'ImportPlanError'; }
}

const fail = () => { throw new ImportPlanError(); };
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isIso = value => typeof value === 'string' && value.length === 24 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const syntheticKey = value => typeof value === 'string' && /^SYNTHETIC-[A-Z0-9][A-Z0-9-]{0,79}$/.test(value);
const sourceId = value => typeof value === 'string' && /^SYNTHETIC-[A-Z0-9][A-Z0-9-]{0,99}$/.test(value);
const sourceRef = value => typeof value === 'string' && /^urn:epdg-synthetic:[A-Z0-9][A-Z0-9-]{0,99}$/.test(value);
const version = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function exactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key));
}

function uniqueMap(rows, keyName, valueName, validateValue) {
  if (!Array.isArray(rows) || rows.length > 500) fail();
  const result = new Map();
  for (const row of rows) {
    if (!exactKeys(row, [keyName, valueName]) || !syntheticKey(row[keyName]) || !validateValue(row[valueName]) || result.has(row[keyName])) fail();
    result.set(row[keyName], row[valueName]);
  }
  return result;
}

function makeTargetMaps(mappings) {
  if (!exactKeys(mappings, ['programs', 'assignments', 'people'])) fail();
  const knownPrograms = new Map(fixtures.programs.map(row => [row.id, row]));
  const knownItems = new Map(fixtures.programs.flatMap(row => row.items.map(item => [item.id, { programId: row.id, item }])));
  const programs = uniqueMap(mappings.programs, 'source_key', 'target_program_id', isUuid);
  const assignments = new Map();
  if (!Array.isArray(mappings.assignments) || mappings.assignments.length > 500) fail();
  for (const row of mappings.assignments) {
    if (!exactKeys(row, ['source_key', 'target_item_id', 'target_program_id']) || !syntheticKey(row.source_key) ||
        !isUuid(row.target_item_id) || !isUuid(row.target_program_id) || assignments.has(row.source_key)) fail();
    const known = knownItems.get(row.target_item_id);
    if (!known || known.programId !== row.target_program_id) fail();
    assignments.set(row.source_key, { itemId: row.target_item_id, programId: row.target_program_id });
  }
  const people = uniqueMap(mappings.people, 'source_key', 'target_learner_key', value => LEARNERS.has(value));
  for (const target of programs.values()) if (!knownPrograms.has(target)) fail();
  return { programs, assignments, people, knownPrograms };
}

function deterministicId(kind, source, sourceVersion) {
  const bytes = crypto.createHash('sha256').update(`${kind}\0${source}\0${sourceVersion}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fingerprint(record) {
  return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function normalizePrior(prior) {
  if (!Array.isArray(prior) || prior.length > 5000) fail();
  const result = new Map();
  for (const row of prior) {
    if (!exactKeys(row, ['source_id', 'source_version', 'source_fingerprint', 'target_id']) || !sourceId(row.source_id) ||
        !version(row.source_version) || !/^[0-9a-f]{64}$/.test(row.source_fingerprint) || !isUuid(row.target_id) || result.has(row.source_id)) fail();
    result.set(row.source_id, row);
  }
  return result;
}

function classify({ kind, sourceIdValue, sourceVersion, targetId, recordFingerprint, prior, seen }) {
  const old = prior.get(sourceIdValue);
  if (old) {
    if (old.source_version === sourceVersion && old.source_fingerprint === recordFingerprint && old.target_id === targetId) return { status: 'existing', reason: 'Identical source version is already recorded.' };
    return { status: 'held', reason: 'Source changed or target conflicts; reviewer decision required.' };
  }
  const duplicate = seen.get(sourceIdValue);
  if (duplicate) {
    if (duplicate.source_version === sourceVersion && duplicate.source_fingerprint === recordFingerprint && duplicate.target_id === targetId) return { status: 'existing', reason: 'Identical source appears earlier in this batch.' };
    return { status: 'held', reason: 'Duplicate source identity has conflicting content or mapping.' };
  }
  seen.set(sourceIdValue, { source_version: sourceVersion, source_fingerprint: recordFingerprint, target_id: targetId, kind });
  return { status: 'accepted', reason: 'Ready for a separately reviewed synthetic import.' };
}

function mapProgram(sourceKey, maps) {
  const id = maps.programs.get(sourceKey);
  if (!id) return { status: 'held', reason: 'Program source mapping is missing.', targetId: null, fixture: null };
  return { status: 'mapped', targetId: id, fixture: maps.knownPrograms.get(id) };
}

function safeRowResult(row, fields, targetId, maps, prior, seen) {
  if (!exactKeys(row, fields.required, fields.optional)) return { status: 'failed', reason: 'Record fields do not match the reviewed contract.', targetId: null };
  const kind = fields.kind;
  if (!sourceId(row.source_id) || !version(row.source_version) || !sourceRef(row.source_ref) || !text(row.title, 200) ||
      !row.title.startsWith('SYNTHETIC ') || !isIso(row.source_modified_at)) return { status: 'failed', reason: 'Synthetic source identity or metadata is invalid.', targetId: null };
  if (kind === 'resource') {
    if (!/^SYNTHETIC-RESOURCE-[A-Z0-9][A-Z0-9-]{0,79}$/.test(row.source_id) || !RESOURCE_KINDS.has(row.resource_kind) || !text(row.description, 2000) ||
        !['internal_training', 'approved', 'private_review', 'do_not_use', 'unknown'].includes(row.rights_use)) return { status: 'failed', reason: 'Resource metadata is invalid.', targetId: null };
    if (!FORMATS.has(row.format)) return { status: 'held', reason: 'Unsupported resource format needs a conversion, link, or hold decision.', targetId: null };
    if (row.source_permission_state !== 'not_applicable_synthetic') return { status: 'held', reason: 'Resource source permission needs review.', targetId: null };
  } else {
    if (!/^SYNTHETIC-HISTORY-[A-Z0-9][A-Z0-9-]{0,79}$/.test(row.source_id) || !EVIDENCE_KINDS.has(row.record_kind) || !text(row.summary, 2000) || !row.summary.startsWith('SYNTHETIC ') ||
        !isIso(row.original_work_at) || !syntheticKey(row.person_source_key) ||
        (row.assignment_source_key !== null && !syntheticKey(row.assignment_source_key)) ||
        !['learner_and_assigned_mentor', 'learner_only', 'hold'].includes(row.privacy_decision)) return { status: 'failed', reason: 'Historical evidence metadata is invalid.', targetId: null };
    if (!FORMATS.has(row.source_format)) return { status: 'held', reason: 'Unsupported historical format needs a conversion, link, or hold decision.', targetId: null };
    if (row.source_permission_state !== 'not_applicable_synthetic') return { status: 'held', reason: 'Historical source permission needs review.', targetId: null };
  }
  const programKey = kind === 'resource' ? row.program_source_key : row.program_source_key;
  if (!syntheticKey(programKey)) return { status: 'failed', reason: 'Program source key is invalid.', targetId: null };
  const program = mapProgram(programKey, maps);
  if (program.status !== 'mapped') return { status: program.status, reason: program.reason, targetId: null };
  if (kind === 'resource') {
    if (!['internal_training', 'approved'].includes(row.rights_use)) return { status: 'held', reason: 'Resource is not cleared for learner use.', targetId: null };
    targetId = deterministicId(kind, row.source_id, row.source_version);
  } else {
    const learnerKey = maps.people.get(row.person_source_key);
    const targetEmail = LEARNERS.get(learnerKey);
    if (!targetEmail || !program.fixture || program.fixture.learner !== targetEmail) return { status: 'held', reason: 'Person and program mapping do not identify the same synthetic learner.', targetId: null };
    if (row.assignment_source_key !== null) {
      const assignment = maps.assignments.get(row.assignment_source_key);
      if (!assignment || assignment.programId !== program.targetId) return { status: 'held', reason: 'Assignment mapping is missing or points to another program.', targetId: null };
    }
    if (row.privacy_decision === 'hold') return { status: 'held', reason: 'Historical evidence is on privacy hold.', targetId: null };
    targetId = deterministicId(kind, row.source_id, row.source_version);
  }
  const normalized = Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]]));
  const sourceFingerprint = fingerprint(normalized);
  const decision = classify({ kind, sourceIdValue: row.source_id, sourceVersion: row.source_version, targetId,
    recordFingerprint: sourceFingerprint, prior, seen });
  return { ...decision, targetId, sourceFingerprint };
}

function createLearningImportPlan(bundle, prior = []) {
  if (!exactKeys(bundle, ['format', 'version', 'environment', 'batch_id', 'mapping_version', 'reviewer_key', 'mappings', 'resources', 'history']) ||
      bundle.format !== IMPORT_FORMAT || bundle.version !== 1 || bundle.environment !== 'synthetic-local' ||
      !syntheticKey(bundle.batch_id) || !syntheticKey(bundle.mapping_version) || bundle.reviewer_key !== 'SYNTHETIC-OPERATOR' ||
      !Array.isArray(bundle.resources) || bundle.resources.length > 500 || !Array.isArray(bundle.history) || bundle.history.length > 500) fail();
  const maps = makeTargetMaps(bundle.mappings);
  const priorById = normalizePrior(prior);
  const seen = new Map();
  const rows = [];
  for (const resource of bundle.resources) {
    const outcome = safeRowResult(resource, { kind: 'resource', required: ['source_id', 'source_version', 'program_source_key', 'resource_kind', 'format',
      'title', 'description', 'source_ref', 'rights_use', 'source_permission_state', 'source_modified_at'], optional: [] }, null, maps, priorById, seen);
    rows.push(planRow('resource', resource, outcome));
  }
  for (const evidence of bundle.history) {
    const outcome = safeRowResult(evidence, { kind: 'evidence', required: ['source_id', 'source_version', 'record_kind', 'person_source_key', 'program_source_key',
      'assignment_source_key', 'source_format', 'title', 'summary', 'source_ref', 'original_work_at', 'source_modified_at', 'privacy_decision', 'source_permission_state'], optional: [] }, null, maps, priorById, seen);
    rows.push(planRow('historical_evidence', evidence, outcome));
  }
  const counts = { accepted: 0, existing: 0, held: 0, failed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { format: IMPORT_FORMAT, environment: 'synthetic-local', batch_id: bundle.batch_id, mapping_version: bundle.mapping_version,
    reviewer_key: bundle.reviewer_key, transfer_status: 'not_performed', counts, rows };
}

function planRow(kind, source, outcome) {
  const sourceIdValue = sourceId(source?.source_id) ? source.source_id : null;
  const sourceVersion = version(source?.source_version) ? source.source_version : null;
  return { kind, source_id: sourceIdValue, source_version: sourceVersion, status: outcome.status, target_id: outcome.targetId ?? null,
    source_fingerprint: outcome.sourceFingerprint ?? null, reason: outcome.reason };
}

module.exports = { createLearningImportPlan, ImportPlanError, IMPORT_FORMAT };
