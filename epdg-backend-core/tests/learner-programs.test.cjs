'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {test}=require('node:test');
const {lessonProgress,learningIdentifier,requireSyntheticLearning}=require('../dist/learning/primitives.js');
const {LearningService}=require('../dist/learning/LearningService.js');
const {PortalError}=require('../dist/security/primitives.js');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const manifest=require('../src/learning/schema-manifest.json');
const fixtures=require('../scripts/local-synthetic/learning-fixtures.cjs');
const safeEnv=()=>runtimeEnv({instanceId:'d85bdca2-f5c3-48f7-99ec-b2e01f55a609',appPassword:'test-only-password',
  jwtSecret:'test-only-jwt',certificateSecret:'test-only-cert',csrfSecret:'test-only-csrf'});

test('learning progress excludes assignments from both numerator and denominator',()=>{
  assert.deepEqual(lessonProgress([{kind:'lesson',completed_at:'2026-10-24T00:00:00Z'},
    {kind:'lesson',completed_at:null},{kind:'lesson',completed_at:null},{kind:'assignment',completed_at:'2026-10-24T00:00:00Z'}]),
    {completed_items:1,total_items:3,progress_percent:33});
});
test('empty or assignment-only programs have zero lesson progress',()=>{
  assert.deepEqual(lessonProgress([]),{completed_items:0,total_items:0,progress_percent:0});
  assert.deepEqual(lessonProgress([{kind:'assignment',completed_at:null}]),{completed_items:0,total_items:0,progress_percent:0});
});
test('completed lessons produce exactly 100 percent',()=>{
  assert.deepEqual(lessonProgress([{kind:'lesson',completed_at:'2026-10-24T00:00:00Z'}]),
    {completed_items:1,total_items:1,progress_percent:100});
});
test('learning identifiers reject selectors and malformed values with the same not-found response',()=>{
  for(const value of [undefined,null,3,{},[],"' OR true --",'../admin','10000000-0000-4000-8000-000000000001?user_id=1']) {
    assert.throws(()=>learningIdentifier(value),error=>error instanceof PortalError&&error.statusCode===404);
  }
  assert.equal(learningIdentifier('ABCDEF00-0000-4000-8000-000000000001'),'abcdef00-0000-4000-8000-000000000001');
});
test('learning synthetic gate rejects production, remote databases, provider credentials, and altered origins',()=>{
  const env=safeEnv();requireSyntheticLearning(env);
  for(const [key,value] of Object.entries({EPDG_SYNTHETIC_MODE:'0',NODE_ENV:'production',DB_HOST:'database.example.invalid',
    DB_NAME:'production',DB_PORT:'5432',DB_USER:'postgres',DB_SSL:'true',MAIL_DELIVERY_MODE:'resend',
    CORS_ORIGINS:'https://epdg.netlify.app',FRONTEND_URL:'https://epdg.netlify.app',SUPABASE_URL:'https://production.example.invalid',
    SMTP_HOST:'smtp.example.invalid',SMTP_FROM:'sender@example.invalid',SYNTHETIC_INSTANCE_ID:'',DATABASE_URL:'forbidden',
    RESEND_API_KEY:'forbidden',SUPABASE_SERVICE_ROLE_KEY:'forbidden'})) {
    assert.throws(()=>requireSyntheticLearning({...env,[key]:value}),error=>error instanceof PortalError&&error.statusCode===503,key);
  }
});
test('normal production learner access returns unavailable before opening any session or database',async()=>{
  const original=process.env.EPDG_SYNTHETIC_MODE;delete process.env.EPDG_SYNTHETIC_MODE;let called=false;
  try {
    const service=new LearningService({withAuthenticatedSession:async()=>{called=true;throw new Error('must not be reached');}});
    await assert.rejects(service.dashboard('opaque-session'),error=>error instanceof PortalError&&error.statusCode===503);
    assert.equal(called,false);
  }finally{if(original===undefined)delete process.env.EPDG_SYNTHETIC_MODE;else process.env.EPDG_SYNTHETIC_MODE=original;}
});
test('school and unrecognized accounts cannot enter the learner repository even with a valid session',async()=>{
  const original={...process.env};Object.assign(process.env,safeEnv());
  try {
    for(const user of [
      {legacy_role:'school',email:'school-a@epdg.invalid',name:'SYNTHETIC School A'},
      {legacy_role:'admin',email:'learner-a@epdg.invalid',name:'SYNTHETIC Learner A'},
      {legacy_role:'intern',email:'other@epdg.invalid',name:'SYNTHETIC Other'},
      {legacy_role:'intern',email:'learner-a@epdg.invalid',name:'Unapproved identity'},
    ]) {
      let queried=false;
      const service=new LearningService({withAuthenticatedSession:async(_raw,work)=>work({query:async()=>{queried=true;}},user)});
      await assert.rejects(service.dashboard('opaque-session'),error=>error instanceof PortalError&&error.statusCode===403);
      assert.equal(queried,false);
    }
  }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
test('local learning migration remains reviewed and separate from historical production migrations',()=>{
  const sql=readFileSync(join(__dirname,'..','learning-migrations',manifest.file),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),manifest.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(manifest.file,sql);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,7);
  assert.doesNotMatch(sql,/CREATE POLICY|GRANT|CREATE.*FUNCTION|CREATE.*TRIGGER|UPDATE\s+core\.|ALTER\s+TABLE\s+(?:core|epdg|portal_security)\./i);
  const startup=readFileSync(join(__dirname,'..','src','index.ts'),'utf8');
  const localStartup=readFileSync(join(__dirname,'..','scripts','local-synthetic','serve.cjs'),'utf8');
  assert.doesNotMatch(startup+localStartup,/learning-migrate|learning-seed/);
});
test('synthetic fixture program, item, resource and feedback IDs are unique across institutions',()=>{
  const ids=[];
  for(const program of fixtures.programs) {
    ids.push(program.id,program.enrollmentId,...program.items.map(i=>i.id),program.resource.id);
    if(program.feedback)ids.push(program.feedback.id);
    assert.match(program.title,/^SYNTHETIC /);assert.match(program.learner,/@epdg\.invalid$/);
    assert.match(program.school,/@epdg\.invalid$/);
    for(const item of program.items)assert.match(item.content,/SYNTHETIC/);
  }
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(fixtures.programs.filter(p=>p.learner==='learner-a@epdg.invalid').length,2);
  assert.equal(fixtures.programs.filter(p=>p.learner==='learner-b@epdg.invalid').length,1);
});
