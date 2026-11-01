'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {LearningService}=require('../dist/learning/LearningService.js');
const {PortalError}=require('../dist/security/primitives.js');
const policy=require('../scripts/local-synthetic/learning-migration-policy.cjs');
const manifest=require('../src/learning/schema-manifest.json');
const migration=manifest.extensions[4];
const sql=readFileSync(join(__dirname,'..','learning-migrations',migration.file),'utf8');

test('revision migration remains checksum pinned while applied001-005hashes stay unchanged',()=>{
  assert.equal(createHash('sha256').update(sql).digest('hex'),migration.sha256);
  assert.deepEqual([manifest,...manifest.extensions.slice(0,4)].map(m=>m.sha256),[
    'db3ab105acccb5e6f82bc3bca1a96eb93d4eb3993d6713f87bf8c374bc71a8fb',
    '2f781d51154eb64a026c75ea0ef4cfbb265e9e77a6881f0b9d828c0a5f245d21',
    'ef724c0ce559585ff70208283558959b9de6ce9bbe9386dd7e113c7c30c37a90',
    '1a0623618a408181e32e2ffb9c9784ddbd3b0ef7e81bbec32bf92f12eb2f7bdc',
    '1af6773a8c6b1c30c705032fe9d5f656bdd75027a70830a6812c3361004ded1e']);
  assert.doesNotMatch(sql,/CREATE TABLE|CREATE POLICY|SECURITY DEFINER|ALTER TABLE (?:core|epdg|portal_security)\./i);
});
test('only the explicitly reviewed local006receiptPKreplacement bypasses the general DROP prohibition',()=>{
  assert.throws(()=>require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(migration.file,sql));
  policy.validate(migration.file,sql);
  assert.throws(()=>policy.validate('007-unreviewed.sql',sql));
  assert.throws(()=>policy.validate(migration.file,sql.replace('DROP CONSTRAINT assignment_receipts_pkey','DROP CONSTRAINT other_constraint')));
  assert.throws(()=>policy.validate(migration.file,sql+'\nDROP TABLE synthetic_learning.items;'));
  assert.throws(()=>policy.validate(migration.file,sql+'\nDELETE FROM synthetic_learning.assignment_receipts;'));
});
test('revision APIs stay closed outside the exact synthetic environment before a session or database opens',async()=>{
  const previous=process.env.EPDG_SYNTHETIC_MODE;delete process.env.EPDG_SYNTHETIC_MODE;let called=false;
  try{
    const service=new LearningService({withAuthenticatedSession:async()=>{called=true;throw Error('Forbidden');}});
    const id='30000000-0000-4000-8000-000000000004';
    for(const work of [()=>service.attempts('opaque',id),()=>service.startRevision('opaque',id,id,1),()=>service.downloadAttemptAttachment('opaque',id,id,id)]) {
      await assert.rejects(work(),error=>error instanceof PortalError&&error.statusCode===503);
    }
    assert.equal(called,false);
  }finally{if(previous===undefined)delete process.env.EPDG_SYNTHETIC_MODE;else process.env.EPDG_SYNTHETIC_MODE=previous;}
});
test('start-revision rejects malformed binding fields without coercing revisions or opening a session',async()=>{
  let called=false;const service=new LearningService({withAuthenticatedSession:async()=>{called=true;throw Error('Forbidden');}});
  const id='30000000-0000-4000-8000-000000000004';
  for(const revision of [undefined,null,'1',{},[],true,-1,0.5,2147483648]) {
    await assert.rejects(service.startRevision('opaque',id,id,revision),error=>error instanceof PortalError&&error.statusCode===400);
  }
  for(const receipt of [undefined,null,{},[],"' OR true --",'not-a-receipt']) {
    await assert.rejects(service.startRevision('opaque',id,receipt,1),error=>error instanceof PortalError&&error.statusCode===400);
  }
  assert.equal(called,false);
});
