'use strict';
const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const {createHmac,createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const http=require('node:http');
const express=require('express');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const {handoffConfig,handoffPath,handoffKeyId}=require('../dist/handoff/config.js');
const {parseHandoffEvent,verifyHandoffSignature,handoffSigningText,requireFreshIssuedAt}=require('../dist/handoff/contract.js');
const {createHandoffRouter}=require('../dist/handoff/routes.js');
const {HandoffService}=require('../dist/handoff/HandoffService.js');
const {LearningService,checkLearningReadiness}=require('../dist/learning/LearningService.js');
const {errorHandler}=require('../dist/middlewares/errorHandler.js');
const {PortalError}=require('../dist/security/primitives.js');
const key=Buffer.alloc(32,67),encodedKey=key.toString('base64url');
const original={...process.env};
const safeEnv=()=>({...runtimeEnv({instanceId:'00000000-0000-4000-8000-000000000001',appPassword:'test-only-password',
  jwtSecret:'j'.repeat(48),certificateSecret:'c'.repeat(48),csrfSecret:'s'.repeat(48)}),
  EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED:'1',EPDG_SYNTHETIC_CRM_HANDOFF_KEY:encodedKey});
const event=()=>({version:1,source:'emerson-crm-synthetic',environment:'synthetic-local',
  event_id:'90000000-0000-4000-8000-000000000001',person_id:'81000000-0000-4000-8000-000000000001',
  application_id:'82000000-0000-4000-8000-000000000001',program_id:'83000000-0000-4000-8000-000000000001',
  decision_id:'91000000-0000-4000-8000-000000000001',decision_version:1,decision:'cleared',issued_at:new Date().toISOString(),
  policy_version:'synthetic-onboarding-v1',reviewer_id:'80000000-0000-4000-8000-000000000001',
  clearance:{identity_verified:true,onboarding_complete:true,agreements_complete:true,hr_approved:true},withdrawn:false});
const nonce='92000000-0000-4000-8000-000000000001';
const sign=(raw,timestamp=String(Math.floor(Date.now()/1000)),requestNonce=nonce)=>({timestamp,nonce:requestNonce,
  signature:createHmac('sha256',key).update(handoffSigningText(timestamp,requestNonce,raw)).digest('hex')});
let server,port,calls=[];
before(async()=>{
  Object.assign(process.env,safeEnv());
  const app=express();
  app.use(handoffPath,createHandoffRouter({receive:async(value,digest,requestNonce)=>{
    calls.push({value,digest,requestNonce});return {success:true,environment:'synthetic-local',event_id:value.event_id,
      result:'accepted',received_at:new Date().toISOString(),current_status:'ready',decision_version:value.decision_version};
  }}));
  app.use(errorHandler);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  port=server.address().port;
});
after(async()=>{
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  for(const name of Object.keys(process.env))if(!(name in original))delete process.env[name];Object.assign(process.env,original);
});
function request({raw=Buffer.from(JSON.stringify(event())),method='POST',path=handoffPath,headers={},extraHeaders=[]}={}){
  const auth=sign(raw);
  const headerList=['Host','127.0.0.1:58000','Content-Type','application/json','Content-Length',String(raw.length),
    'X-EPDG-Handoff-Key-Id',handoffKeyId,'X-EPDG-Handoff-Timestamp',auth.timestamp,
    'X-EPDG-Handoff-Nonce',auth.nonce,'X-EPDG-Handoff-Signature',auth.signature];
  for(const [name,value]of Object.entries(headers)){
    const index=headerList.findIndex((item,i)=>i%2===0&&item.toLowerCase()===name.toLowerCase());
    if(index>=0)headerList[index+1]=value;else headerList.push(name,value);
  }
  headerList.push(...extraHeaders);
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,method,path,headers:headerList},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(raw);
  });
}
test('handoff key is independent canonical32bytebase64url and exactsyntheticconfiguration only',()=>{
  const config=handoffConfig(safeEnv());assert.deepEqual(config.key,key);config.key.fill(0);
  for(const patch of [{EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED:'0'},{EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED:undefined},
    {NODE_ENV:'production'},{DB_HOST:'remote.invalid'},{EPDG_SYNTHETIC_CRM_HANDOFF_KEY:'x'.repeat(44)},
    {EPDG_SYNTHETIC_CRM_HANDOFF_KEY:encodedKey+'='},{SESSION_CSRF_SECRET:encodedKey}]){
    assert.throws(()=>handoffConfig({...safeEnv(),...patch}),error=>error instanceof PortalError&&error.statusCode===503);
  }
});
test('signature binds exactrawbytes methodfixedpath timestampandnonce usingdecodedbinarykey',()=>{
  const raw=Buffer.from(JSON.stringify(event())),auth=sign(raw);
  assert.equal(verifyHandoffSignature(key,auth.timestamp,nonce,auth.signature,raw).digest,createHash('sha256').update(raw).digest('hex'));
  for(const signature of [createHmac('sha256',encodedKey).update(handoffSigningText(auth.timestamp,nonce,raw)).digest('hex'),
    auth.signature.toUpperCase(),'0'.repeat(64),auth.signature.slice(1)]){
    assert.throws(()=>verifyHandoffSignature(key,auth.timestamp,nonce,signature,raw),error=>error.statusCode===401);
  }
  assert.throws(()=>verifyHandoffSignature(key,auth.timestamp,nonce,auth.signature,Buffer.concat([raw,Buffer.from(' ')])),error=>error.statusCode===401);
  assert.throws(()=>verifyHandoffSignature(key,auth.timestamp,'92000000-0000-4000-8000-000000000002',auth.signature,raw),error=>error.statusCode===401);
});
test('authentication freshnessrejects oldfutureandambiguous timestamps',()=>{
  const raw=Buffer.from(JSON.stringify(event()));const now=Date.now();
  for(const stamp of [String(Math.floor(now/1000)-301),String(Math.ceil(now/1000)+31),'01','1e9',null]){
    const signature=createHmac('sha256',key).update(handoffSigningText(String(stamp),nonce,raw)).digest('hex');
    assert.throws(()=>verifyHandoffSignature(key,stamp,nonce,signature,raw,now),error=>error.statusCode===401);
  }
});
test('exactenvelopeallows heldrevoked withoutassertingclearance and requiresall four forcleared',()=>{
  const exact=event();assert.deepEqual(parseHandoffEvent(Buffer.from(JSON.stringify(exact))),exact);
  for(const decision of ['held','revoked']){
    const value=event();value.decision=decision;value.clearance.hr_approved=false;value.withdrawn=true;
    assert.equal(parseHandoffEvent(Buffer.from(JSON.stringify(value))).decision,decision);
  }
  for(const field of Object.keys(event().clearance)){
    const value=event();value.clearance[field]=false;
    assert.throws(()=>parseHandoffEvent(Buffer.from(JSON.stringify(value))),error=>error.statusCode===400);
  }
});
test('envelope rejectsprivatefields alternateformats unknownnestedfields andduplicateJSONkeys',()=>{
  for(const mutate of [value=>{value.email='private@example.invalid';},value=>{value.role='admin';},
    value=>{value.clearance.extra=true;},value=>{delete value.reviewer_id;},value=>{value.decision_version='1';},
    value=>{value.decision_version=1000001;},value=>{value.decision='onboarded';},value=>{value.withdrawn=true;},
    value=>{value.issued_at='2026-10-24T00:00:00Z';},value=>{value.person_id='PERSON';}]){
    const value=event();mutate(value);assert.throws(()=>parseHandoffEvent(Buffer.from(JSON.stringify(value))),error=>error.statusCode===400);
  }
  const raw=JSON.stringify(event());
  for(const duplicate of [raw.replace('"version":1','"version":1,"version":1'),
    raw.replace('"hr_approved":true','"hr_approved":true,"hr_approved":true')]){
    assert.throws(()=>parseHandoffEvent(Buffer.from(duplicate)),error=>error.statusCode===400);
  }
  assert.throws(()=>parseHandoffEvent(Buffer.from('{"secret":"never reflect"}')));
  assert.throws(()=>parseHandoffEvent(Buffer.alloc(8193)));
});
test('newissuedtime freshnessis separatefromfresh signedtransport requiredfordurableduplicates',()=>{
  const value=event();value.issued_at=new Date(Date.now()-301000).toISOString();
  assert.throws(()=>requireFreshIssuedAt(value),error=>error.statusCode===400);
  assert.equal(parseHandoffEvent(Buffer.from(JSON.stringify(value))).issued_at,value.issued_at);
});
test('service rawroute authenticatesbeforeconsumer andpassesexactdigestwithno browsercookie',async()=>{
  const beforeCalls=calls.length;const raw=Buffer.from(JSON.stringify(event()));const result=await request({raw});
  assert.equal(result.status,200);assert.equal(result.body.current_status,'ready');assert.equal(calls.length,beforeCalls+1);
  assert.equal(calls.at(-1).digest,createHash('sha256').update(raw).digest('hex'));
  assert.equal(calls.at(-1).requestNonce,nonce);
});
test('browsercredentials forwardedheaders duplicateheaders pathsandcontentencodings neverreachconsumer',async()=>{
  const beforeCalls=calls.length;
  for(const headers of [{Origin:'http://127.0.0.1:58080'},{Cookie:'epdg_synthetic_session=not-a-token'},
    {Authorization:'Bearer not-a-token'},{'X-EPDG-Request':'portal'},{'Sec-Fetch-Mode':'cors'},
    {'X-Forwarded-For':'127.0.0.1'},{Forwarded:'for=127.0.0.1'},{Host:'localhost:58000'}]){
    assert.equal((await request({headers})).status,403);
  }
  for(const path of [handoffPath+'?debug=1',handoffPath+'/',handoffPath+'/other'])assert.equal((await request({path})).status,403);
  assert.equal((await request({method:'GET'})).status,403);
  assert.equal((await request({headers:{'Content-Encoding':'gzip'}})).status,415);
  assert.equal((await request({headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await request({extraHeaders:['X-EPDG-Handoff-Nonce',nonce]})).status,403);
  assert.equal((await request({headers:{'X-EPDG-Handoff-Signature':'0'.repeat(64)}})).status,401);
  assert.equal((await request({raw:Buffer.from('{"secret":"never reflect"}')})).status,400);
  assert.equal((await request({raw:Buffer.alloc(8193,32)})).status,413);
  assert.equal(calls.length,beforeCalls);
});
test('defaultoff consumer andownsummary closebeforeanydatabaseorsessionwork',async()=>{
  const previous=process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED;delete process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED;
  let opened=false;
  try{
    assert.equal((await request()).status,503);
    await assert.rejects(new HandoffService(async()=>{opened=true;throw Error('Do not connect');}).receive(event(),'a'.repeat(64),nonce),error=>error.statusCode===503);
    await assert.rejects(new LearningService({withAuthenticatedSession:async()=>{opened=true;throw Error('Do not authenticate');}}).onboarding('opaque'),error=>error.statusCode===503);
    assert.equal(opened,false);
  }finally{process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED=previous;}
});
test('health rejects an invalid enabled key before opening DB and permits the default-off configuration',async()=>{
  const database=require('../dist/db/index.js'),originalGetPool=database.getPool;
  const previousKey=process.env.EPDG_SYNTHETIC_CRM_HANDOFF_KEY,previousEnabled=process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED;
  let opened=false;database.getPool=()=>{opened=true;throw new Error('Database boundary reached');};
  try{
    process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED='1';process.env.EPDG_SYNTHETIC_CRM_HANDOFF_KEY='invalid';
    await assert.rejects(checkLearningReadiness(),error=>error instanceof PortalError&&error.statusCode===503);assert.equal(opened,false);
    delete process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED;
    await assert.rejects(checkLearningReadiness(),/Database boundary reached/);assert.equal(opened,true);
    opened=false;process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED='1';process.env.EPDG_SYNTHETIC_CRM_HANDOFF_KEY=encodedKey;
    await assert.rejects(checkLearningReadiness(),/Database boundary reached/);assert.equal(opened,true);
  }finally{
    database.getPool=originalGetPool;process.env.EPDG_SYNTHETIC_CRM_HANDOFF_KEY=previousKey;
    process.env.EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED=previousEnabled;
  }
});
test('newmigration pins priorhistory and adds guardedhandoffobjects withoutidentityorenrollmentwrites',()=>{
  const manifest=require('../src/learning/schema-manifest.json');const reviewed=manifest.extensions.find(m=>m.file==='007-synthetic-crm-handoff.sql');
  assert.equal(reviewed.file,'007-synthetic-crm-handoff.sql');
  const sql=readFileSync(join(__dirname,'..','learning-migrations',reviewed.file),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),reviewed.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(reviewed.file,sql);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,3);
  assert.equal((sql.match(/CREATE TRIGGER (?:a_)?handoff_/g)||[]).length,9);
  assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE POLICY|UPDATE (?:core|epdg|portal_security)\.|INSERT INTO (?:core|epdg|portal_security)\.|UPDATE synthetic_learning\.enrollments/i);
  assert.match(sql,/coalesce\(current_setting\('synthetic_handoff.enabled',true\)='on',false\)/);
  assert.match(sql,/GRANT INSERT\(nonce,event_id\)/);assert.match(sql,/GRANT EXECUTE ON FUNCTION synthetic_handoff.enrollment_allowed/);
});
