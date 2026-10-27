'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {test}=require('node:test');
const {assignmentAnswer,assignmentRevision}=require('../dist/learning/primitives.js');
const {LearningService}=require('../dist/learning/LearningService.js');
const {PortalError}=require('../dist/security/primitives.js');
const manifest=require('../src/learning/schema-manifest.json');

test('assignment revision rejects scope-like objects, coercion, fractions and integer overflow',()=>{
  for(const value of [null,undefined,'0',{},[],true,-1,0.2,Infinity,NaN,2147483648]) {
    assert.throws(()=>assignmentRevision(value),error=>error instanceof PortalError&&error.statusCode===400);
  }
  for(const value of [0,1,2147483647])assert.equal(assignmentRevision(value),value);
});
test('plain-text drafts preserve whitespace and permit clearing a saved response',()=>{
  for(const value of ['', '   \n', 'SYNTHETIC fictional answer\nSecond line', '<script>fictional plain text</script>']) {
    assert.equal(assignmentAnswer(value),value);
  }
});
test('answer boundaries apply to both JavaScript characters and UTF-8 bytes',()=>{
  for(const value of ['x'.repeat(4000),'€'.repeat(4000),'😀'.repeat(2000)])assert.equal(assignmentAnswer(value),value);
  for(const value of ['x'.repeat(4001),'😀'.repeat(2001),'€'.repeat(4001)]) {
    assert.throws(()=>assignmentAnswer(value),error=>error instanceof PortalError&&error.statusCode===400);
  }
});
test('answer validation rejects structured uploads and invalid PostgreSQL text without reflecting content',()=>{
  for(const value of [null,{},[],{url:'https://example.invalid/file'},12,'SYNTHETIC\0answer','SYNTHETIC\ud800answer']) {
    assert.throws(()=>assignmentAnswer(value),error=>error instanceof PortalError&&error.statusCode===400&&
      !error.message.includes('SYNTHETIC'));
  }
});
test('all assignment operations fail closed outside the exact synthetic environment',async()=>{
  const previous=process.env.EPDG_SYNTHETIC_MODE;delete process.env.EPDG_SYNTHETIC_MODE;let called=false;
  try {
    const service=new LearningService({withAuthenticatedSession:async()=>{called=true;throw new Error('Forbidden database access');}});
    const id='30000000-0000-4000-8000-000000000004';
    for(const invoke of [()=>service.submission('synthetic',id),()=>service.saveDraft('synthetic',id,'SYNTHETIC',0),
      ()=>service.submitAssignment('synthetic',id,0)]) {
      await assert.rejects(invoke(),error=>error instanceof PortalError&&error.statusCode===503);
    }
    assert.equal(called,false);
  }finally{if(previous===undefined)delete process.env.EPDG_SYNTHETIC_MODE;else process.env.EPDG_SYNTHETIC_MODE=previous;}
});
test('forward assignment migration is checksum-pinned, non-destructive and leaves the applied base intact',()=>{
  assert.equal(manifest.sha256,'db3ab105acccb5e6f82bc3bca1a96eb93d4eb3993d6713f87bf8c374bc71a8fb');
  assert.equal(manifest.extensions.length,7);assert.equal(manifest.secured_tables,13);
  const extension=manifest.extensions[0];const sql=readFileSync(join(__dirname,'..','learning-migrations',extension.file),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),extension.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(extension.file,sql);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,2);
  assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE POLICY|ALTER TABLE (?:core|epdg|portal_security)\./i);
  assert.match(sql,/Submitted assignment is immutable/);
  const correction=manifest.extensions[1];
  const correctionSql=readFileSync(join(__dirname,'..','learning-migrations',correction.file),'utf8');
  assert.equal(createHash('sha256').update(correctionSql).digest('hex'),correction.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(correction.file,correctionSql);
});
