'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fixtures = require('./learning-fixtures.cjs');
const { createLearningImportPlan, ImportPlanError, IMPORT_FORMAT } = require('./learning-import-plan.cjs');

const programA = fixtures.programs[0];
const programB = fixtures.programs[2];
const assignmentA = programA.items.find(item => item.kind === 'assignment');
const base = () => ({
  format: IMPORT_FORMAT,
  version: 1,
  environment: 'synthetic-local',
  batch_id: 'SYNTHETIC-WEEK-8-9-BATCH-1',
  mapping_version: 'SYNTHETIC-MAP-V1',
  reviewer_key: 'SYNTHETIC-OPERATOR',
  mappings: {
    programs: [{ source_key: 'SYNTHETIC-SOURCE-PROGRAM-A', target_program_id: programA.id }],
    assignments: [{ source_key: 'SYNTHETIC-SOURCE-ASSIGNMENT-A', target_item_id: assignmentA.id, target_program_id: programA.id }],
    people: [{ source_key: 'SYNTHETIC-SOURCE-PERSON-A', target_learner_key: 'SYNTHETIC-LEARNER-A' }],
  },
  resources: [{ source_id: 'SYNTHETIC-RESOURCE-1', source_version: 'v1', program_source_key: 'SYNTHETIC-SOURCE-PROGRAM-A',
    resource_kind: 'guide', format: 'pdf', title: 'SYNTHETIC Week 8 guide', description: 'Fictional guide for import mapping checks.',
    source_ref: 'urn:epdg-synthetic:RESOURCE-1', rights_use: 'internal_training', source_permission_state: 'not_applicable_synthetic',
    source_modified_at: '2026-10-30T12:00:00.000Z' }],
  history: [{ source_id: 'SYNTHETIC-HISTORY-1', source_version: 'v1', record_kind: 'deliverable',
    person_source_key: 'SYNTHETIC-SOURCE-PERSON-A', program_source_key: 'SYNTHETIC-SOURCE-PROGRAM-A',
    assignment_source_key: 'SYNTHETIC-SOURCE-ASSIGNMENT-A', source_format: 'docx', title: 'SYNTHETIC Historical draft',
    summary: 'SYNTHETIC Earlier draft retained as historical evidence.', source_ref: 'urn:epdg-synthetic:HISTORY-1',
    original_work_at: '2026-09-22T15:30:00.000Z', source_modified_at: '2026-09-23T10:00:00.000Z',
    privacy_decision: 'learner_and_assigned_mentor', source_permission_state: 'not_applicable_synthetic' }],
});

test('resource and historical mappings create a metadata-only synthetic plan with stable target IDs', () => {
  const first = createLearningImportPlan(base());
  const second = createLearningImportPlan(base());
  assert.deepEqual(first.counts, { accepted: 2, existing: 0, held: 0, failed: 0 });
  assert.equal(first.transfer_status, 'not_performed');
  assert.deepEqual(first.rows.map(row => row.target_id), second.rows.map(row => row.target_id));
  assert.equal(first.rows[1].kind, 'historical_evidence');
  assert.equal(first.rows[1].source_id, 'SYNTHETIC-HISTORY-1');
  assert.equal(Object.hasOwn(first.rows[1], 'original_work_at'), false);
  assert.equal(Object.hasOwn(first.rows[1], 'receipt_id'), false);
  assert.equal(Object.hasOwn(first.rows[1], 'grade'), false);
  assert.equal(Object.hasOwn(first.rows[1], 'completion'), false);
});

test('identical retries are existing while changed versions and conflicting copies are held', () => {
  const plan = createLearningImportPlan(base());
  const resource = plan.rows[0];
  const same = createLearningImportPlan(base(), [{ source_id: resource.source_id, source_version: resource.source_version,
    source_fingerprint: resource.source_fingerprint, target_id: resource.target_id }]);
  assert.equal(same.rows[0].status, 'existing');
  const changed = base(); changed.resources[0].source_version = 'v2';
  const changedPlan = createLearningImportPlan(changed, [{ source_id: resource.source_id, source_version: resource.source_version,
    source_fingerprint: resource.source_fingerprint, target_id: resource.target_id }]);
  assert.equal(changedPlan.rows[0].status, 'held');
  const duplicate = base(); duplicate.resources.push({ ...duplicate.resources[0], description: 'SYNTHETIC Changed source content.' });
  const duplicatePlan = createLearningImportPlan(duplicate);
  assert.deepEqual(duplicatePlan.counts, { accepted: 2, existing: 0, held: 1, failed: 0 });
  assert.equal(duplicatePlan.rows[1].status, 'held');
});

test('unknown program and assignment mappings remain review holds', () => {
  const value = base();
  value.resources[0].program_source_key = 'SYNTHETIC-SOURCE-UNKNOWN';
  value.history[0].assignment_source_key = 'SYNTHETIC-SOURCE-UNKNOWN-ASSIGNMENT';
  const plan = createLearningImportPlan(value);
  assert.deepEqual(plan.counts, { accepted: 0, existing: 0, held: 2, failed: 0 });
  assert.equal(plan.rows[0].target_id, null);
  assert.match(plan.rows[0].reason, /mapping is missing/);
});

test('privacy, rights, and external-permission states hold rather than becoming learner-visible', () => {
  const value = base();
  value.resources[0].rights_use = 'private_review';
  value.history[0].privacy_decision = 'hold';
  const plan = createLearningImportPlan(value);
  assert.deepEqual(plan.counts, { accepted: 0, existing: 0, held: 2, failed: 0 });
  value.resources[0].rights_use = 'approved';
  value.resources[0].source_permission_state = 'pending';
  assert.equal(createLearningImportPlan(value).rows[0].status, 'held');
});

test('person-program and assignment-program mismatches are held', () => {
  const value = base();
  value.mappings.people[0].target_learner_key = 'SYNTHETIC-LEARNER-B';
  value.mappings.programs[0].target_program_id = programB.id;
  const plan = createLearningImportPlan(value);
  assert.equal(plan.rows[1].status, 'held');
  const wrongItem = base();
  wrongItem.mappings.assignments[0].target_program_id = programB.id;
  assert.throws(() => createLearningImportPlan(wrongItem), ImportPlanError);
});

test('unsupported fields, identifiers, dates, formats, or source references fail without echoing values', () => {
  const value = base();
  value.history[0].grade = 'A';
  value.resources[0].source_ref = 'https://drive.google.com/file/d/real-file/view';
  const plan = createLearningImportPlan(value);
  assert.deepEqual(plan.counts, { accepted: 0, existing: 0, held: 0, failed: 2 });
  assert.ok(plan.rows.every(row => !JSON.stringify(row).includes('real-file')));
  const invalidDate = base(); invalidDate.history[0].original_work_at = 'not-a-date';
  assert.equal(createLearningImportPlan(invalidDate).rows[1].status, 'failed');
  const unsupportedFormat = base(); unsupportedFormat.resources[0].format = 'zip';
  assert.equal(createLearningImportPlan(unsupportedFormat).rows[0].status, 'held');
});

test('top-level input rejects non-synthetic environments and real identifiers', () => {
  const value = base(); value.environment = 'production';
  assert.throws(() => createLearningImportPlan(value), ImportPlanError);
  const real = base(); real.resources[0].source_id = 'REAL-123';
  assert.equal(createLearningImportPlan(real).rows[0].status, 'failed');
  const pii = base(); pii.history[0].learner_email = 'learner@example.com';
  assert.equal(createLearningImportPlan(pii).rows[1].status, 'failed');
});
