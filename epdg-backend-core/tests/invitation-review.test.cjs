'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const {requireInvitationReview,INVITATION_ROLE_CATALOG}=require('../dist/security/invitationPolicy.js');
test('invitation mode cannot be enabled for production, hosted projects, or non-synthetic email',()=>{
  const local={...runtimeEnv({instanceId:crypto.randomUUID(),appPassword:'fixture',jwtSecret:'j'.repeat(48),certificateSecret:'c'.repeat(48),csrfSecret:'s'.repeat(48)}),EPDG_INVITATION_REVIEW_MODE:'1',EPDG_ADMIN_STAGING_MODE:'1'};
  assert.doesNotThrow(()=>requireInvitationReview(local));
  for(const change of [{NODE_ENV:'production'},{EPDG_INVITATION_REVIEW_MODE:''},{EPDG_ADMIN_STAGING_MODE:''},{EPDG_HOSTED_PRACTICE_MODE:'1'},{EPDG_NEON_ADMIN_STAGING_MODE:'1'},{DB_HOST:'database.example.invalid'},{SMTP_FROM:'admin@example.invalid'},{RESEND_API_KEY:'forbidden-test-value'}])assert.throws(()=>requireInvitationReview({...local,...change}));
});
test('requested role catalog distinguishes review proposals from granted scopes',()=>{
  assert.equal(INVITATION_ROLE_CATALOG.length,10);
  assert.deepEqual(INVITATION_ROLE_CATALOG.filter(r=>r.invitable).map(r=>r.code),['participant']);
  assert.ok(INVITATION_ROLE_CATALOG.filter(r=>!r.invitable).every(r=>typeof r.reason==='string'));
});
test('invitation migration is checksummed, additive, RLS-enabled, and never creates accounts or public grants',()=>{
  const m=require('../src/security/invitation-schema-manifest.json');const sql=fs.readFileSync(path.join(__dirname,'../invitation-review-migrations',m.file),'utf8');
  assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),m.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(m.file,sql);
  assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE)\b|INSERT INTO (?:core|epdg)\.users|GRANT.*TO PUBLIC/i);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,5);
  assert.match(sql,/SECURITY DEFINER SET search_path=''/);
  assert.match(sql,/proof IS NULL OR password_hash IS NULL/);
});
test('combined review router preserves the learner multipart authentication boundary',async()=>{
  const original={...process.env};for(const key of Object.keys(process.env))delete process.env[key];
  Object.assign(process.env,runtimeEnv({instanceId:crypto.randomUUID(),appPassword:'fixture',jwtSecret:'j'.repeat(48),certificateSecret:'c'.repeat(48),csrfSecret:'s'.repeat(48)}),{EPDG_INVITATION_REVIEW_MODE:'1',EPDG_ADMIN_STAGING_MODE:'1'});
  const app=require('../dist/app.js').createApp({readinessCheck:async()=>{}});const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const form=new FormData();form.set('file',new Blob(['SYNTHETIC attachment'],{type:'text/plain'}),'fixture.txt');form.set('expected_revision','0');
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/learner/assignments/00000000-0000-0000-0000-000000000000/attachments`,{method:'POST',headers:{Origin:'http://127.0.0.1:58080','X-EPDG-Request':'portal'},body:form});
    assert.equal(response.status,401);assert.equal((await response.json()).message,'Authentication required');
  }finally{await new Promise(resolve=>server.close(resolve));for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,original);}
});
