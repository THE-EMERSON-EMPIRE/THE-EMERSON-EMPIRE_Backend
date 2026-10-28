'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {test}=require('node:test');
const {MentorReviewService,mentorComment}=require('../dist/learning/MentorReviewService.js');
const {PortalError}=require('../dist/security/primitives.js');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const manifest=require('../src/learning/schema-manifest.json');
const safeEnv=()=>runtimeEnv({instanceId:'d85bdca2-f5c3-48f7-99ec-b2e01f55a609',appPassword:'test-only-password',
  jwtSecret:'test-only-jwt',certificateSecret:'test-only-cert',csrfSecret:'test-only-csrf'});

test('feedback drafts preserve plain text and permit blank saved edits',()=>{
  for(const value of ['', ' \t\r\n\u00a0\u3000', 'SYNTHETIC constructive comment\nOne fictional next step.', '<b>plain text only</b>'])assert.equal(mentorComment(value),value);
});
test('feedback text enforces both JavaScript character and UTF-8 bounds',()=>{
  for(const value of ['x'.repeat(4000),'€'.repeat(4000),'😀'.repeat(2000)])assert.equal(mentorComment(value),value);
  for(const value of ['x'.repeat(4001),'€'.repeat(4001),'😀'.repeat(2001),{},[],null,'SYNTHETIC\0','SYNTHETIC\ud800']) {
    assert.throws(()=>mentorComment(value),error=>error instanceof PortalError&&error.statusCode===400&&!error.message.includes('SYNTHETIC'));
  }
});
test('all mentor routes fail closed outside the exact synthetic runtime before session or database work',async()=>{
  const previous=process.env.EPDG_SYNTHETIC_MODE;delete process.env.EPDG_SYNTHETIC_MODE;let called=false;
  try{
    const service=new MentorReviewService({withAuthenticatedSession:async()=>{called=true;throw new Error('Forbidden');}});
    const id='30000000-0000-4000-8000-000000000004';
    for(const invoke of [()=>service.queue('opaque'),()=>service.review('opaque',id),()=>service.saveDraft('opaque',id,'SYNTHETIC',0),
      ()=>service.publish('opaque',id,0),()=>service.download('opaque',id,id)])await assert.rejects(invoke(),error=>error instanceof PortalError&&error.statusCode===503);
    assert.equal(called,false);
  }finally{if(previous===undefined)delete process.env.EPDG_SYNTHETIC_MODE;else process.env.EPDG_SYNTHETIC_MODE=previous;}
});
test('mentor role names alone, learner accounts and nonfixture school identities never reach a query',async()=>{
  const previous={...process.env};Object.assign(process.env,safeEnv());
  try{
    for(const user of [{legacy_role:'intern',email:'learner-a@epdg.invalid',name:'SYNTHETIC Learner A'},
      {legacy_role:'admin',email:'school-a@epdg.invalid',name:'SYNTHETIC School A'},
      {legacy_role:'school',email:'other@epdg.invalid',name:'SYNTHETIC Other'},
      {legacy_role:'school',email:'school-a@epdg.invalid',name:'Unapproved identity'}]){
      let queried=false;const service=new MentorReviewService({withAuthenticatedSession:async(_raw,work)=>work({query:async()=>{queried=true;}},user)});
      await assert.rejects(service.queue('opaque'),error=>error instanceof PortalError&&error.statusCode===403);assert.equal(queried,false);
    }
  }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
test('mentor extension is checksum pinned, additive and separate from unchanged applied learning history',()=>{
  const migration=manifest.extensions[3];const sql=readFileSync(join(__dirname,'..','learning-migrations',migration.file),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),migration.sha256);
  assert.equal(manifest.extensions[2].sha256,'1a0623618a408181e32e2ffb9c9784ddbd3b0ef7e81bbec32bf92f12eb2f7bdc');
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(migration.file,sql);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,3);
  assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE POLICY|ALTER TABLE (?:core|epdg|portal_security)\.|GRANT/);
  assert.match(sql,/pg_advisory_xact_lock_shared/);assert.match(sql,/Published feedback is immutable/);
});
test('explicit mentor seeding is absent from startup and cannot reactivate an existing mapping',()=>{
  const startup=readFileSync(join(__dirname,'..','scripts','local-synthetic','serve.cjs'),'utf8')+readFileSync(join(__dirname,'..','src','index.ts'),'utf8');
  assert.doesNotMatch(startup,/mentor-seed|learning-migrate/);
  const seed=readFileSync(join(__dirname,'..','scripts','local-synthetic','mentor-seed.cjs'),'utf8');
  assert.match(seed,/ON CONFLICT\(id\) DO NOTHING/);
  assert.doesNotMatch(seed,/SET active|SELECT[^;]*password|UPDATE core\.users|UPDATE portal_security/);
});
