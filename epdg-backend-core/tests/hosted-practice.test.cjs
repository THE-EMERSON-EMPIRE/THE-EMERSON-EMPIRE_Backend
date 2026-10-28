'use strict';
const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const http=require('node:http');
const express=require('express');
const {createHmac,X509Certificate}=require('node:crypto');
const {rootCertificates}=require('node:tls');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const configured=require('../dist/hosted-practice/profile.json');
const {validateHostedPracticeEnvironment}=require('../dist/hosted-practice/profile.js');
const {normalizeHostedPracticeCa}=require('../dist/hosted-practice/tls.js');
const {getDatabaseSslConfig}=require('../dist/db/tls.js');
const {resolvePracticeEmail}=require('../dist/hosted-practice/loginAlias.js');
const {portalConfig,portalOriginAllowed}=require('../dist/security/config.js');
const {handoffConfig,handoffEnabled,handoffPath}=require('../dist/handoff/config.js');
const {parseHandoffEvent,handoffSigningText,verifyHandoffSignature}=require('../dist/handoff/contract.js');
const {createHandoffRouter}=require('../dist/handoff/routes.js');
const {HandoffService}=require('../dist/handoff/HandoffService.js');
const {createHostedPracticeApp,checkHostedReadiness}=require('../dist/hosted-practice/app.js');
const {errorHandler}=require('../dist/middlewares/errorHandler.js');
const originalEnv={...process.env},originalProfile=structuredClone(configured);
const ca=rootCertificates.find(pem=>{const cert=new X509Certificate(pem);return cert.ca&&Date.parse(cert.validFrom)<=Date.now()&&Date.parse(cert.validTo)>Date.now();});
assert.ok(ca,'A non-secret currently-valid public CA fixture is required');
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const profile={version:1,enabled:true,projectId:id(1),environmentId:id(2),serviceId:id(3),databaseServiceId:id(4),
 databaseHost:'practice-db.railway.internal',databasePort:5432,databaseName:'epdg_synthetic',databaseUser:'epdg_synthetic_app',instanceId:id(5),
 frontendOrigin:'https://portal.example.invalid',frontendOrigins:['https://portal.example.invalid','https://preview.example.invalid'],
 backendOrigin:'https://backend.example.invalid',crmOrigin:'https://crm.example.invalid',baselineSha256:'a'.repeat(64),isolationSha256:'b'.repeat(64)};
profile.loginAlias='admin@theemersonempire.info';
const key=Buffer.alloc(32,69),encoded=key.toString('base64url');
const env=()=>({NODE_ENV:'production',EPDG_HOSTED_PRACTICE_MODE:'1',RAILWAY_PROJECT_ID:profile.projectId,RAILWAY_ENVIRONMENT_ID:profile.environmentId,
 RAILWAY_SERVICE_ID:profile.serviceId,DB_HOST:profile.databaseHost,DB_PORT:'5432',DB_NAME:'epdg_synthetic',DB_USER:'epdg_synthetic_app',
 DB_PASSWORD:'unit-db-only-'.repeat(4),DB_SSL:'true',HOSTED_PRACTICE_DB_CA_CERT:ca,HOSTED_PRACTICE_INSTANCE_ID:profile.instanceId,
 PORTAL_ORIGIN:profile.frontendOrigin,FRONTEND_URL:profile.frontendOrigin,CORS_ORIGINS:profile.frontendOrigins.join(','),
 SESSION_CSRF_SECRET:'unit-csrf-only-'.repeat(4),MAIL_DELIVERY_MODE:'database-capture',SMTP_FROM:'EPDG Synthetic <no-reply@epdg.invalid>',
 EPDG_HOSTED_PRACTICE_LOGIN_ALIAS:profile.loginAlias,
 EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED:'1',EPDG_HOSTED_PRACTICE_HANDOFF_KEY:encoded});
const event=()=>({version:1,source:'emerson-crm-synthetic',environment:'synthetic-hosted',event_id:id(6),person_id:id(7),application_id:id(8),program_id:id(9),decision_id:id(10),
 decision_version:1,decision:'cleared',issued_at:new Date().toISOString(),policy_version:'synthetic-onboarding-v1',reviewer_id:id(11),
 clearance:{identity_verified:true,onboarding_complete:true,agreements_complete:true,hr_approved:true},withdrawn:false});
before(()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env());Object.assign(configured,profile);});
after(()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,originalEnv);for(const key of Object.keys(configured))delete configured[key];Object.assign(configured,originalProfile);});

test('hosted profile is source-pinned and refuses inherited production providers and operator credentials',()=>{
 assert.equal(validateHostedPracticeEnvironment(env(),profile).projectId,profile.projectId);
 for(const patch of [{RAILWAY_PROJECT_ID:id(20)},{RAILWAY_ENVIRONMENT_ID:id(20)},{RAILWAY_SERVICE_ID:id(20)},
  {DB_HOST:'unreviewed.railway.internal'},{DB_NAME:'railway'},{DB_USER:'postgres'},{DB_SSL:'false'},
  {HOSTED_PRACTICE_INSTANCE_ID:id(20)},{SUPABASE_URL:'https://real.example.invalid'},{RESEND_API_KEY:'unit-forbidden-provider'},
  {DATABASE_URL:'unit-forbidden-url'},{PGPASSWORD:'unit-forbidden-operator'},{EPDG_SYNTHETIC_MODE:'1'},{SMTP_HOST:'external.example.invalid'},
  {EPDG_HOSTED_PRACTICE_BOOTSTRAP:'1'},{HOSTED_PRACTICE_APP_PASSWORD:'unit-job-only'},{HOSTED_PRACTICE_FIXTURE_PASSWORD:'unit-job-only'},
  {SESSION_CSRF_SECRET:env().DB_PASSWORD},{HOSTED_PRACTICE_DB_CA_CERT:undefined}])assert.throws(()=>validateHostedPracticeEnvironment({...env(),...patch},profile));
 assert.throws(()=>validateHostedPracticeEnvironment(env(),{...profile,enabled:false}));
 assert.throws(()=>validateHostedPracticeEnvironment({...env(),DB_HOST:'external.example.invalid'},{...profile,databaseHost:'external.example.invalid'}));
 assert.throws(()=>validateHostedPracticeEnvironment(env(),{...profile,frontendOrigins:[profile.frontendOrigin,profile.frontendOrigin]}));
});
test('hosted database transport always validates the CA and retains standard TLS peer verification',()=>{
 const ssl=getDatabaseSslConfig(env());assert.equal(ssl.rejectUnauthorized,true);assert.equal(new X509Certificate(ssl.ca).ca,true);
 assert.equal(ssl.checkServerIdentity,undefined);assert.equal(ssl.servername,undefined);
 assert.equal(normalizeHostedPracticeCa(ca.replace(/\n/g,'\\n')),normalizeHostedPracticeCa(ca));
 for(const value of [undefined,'sensitive-value','-----BEGIN CERTIFICATE-----\nsensitive-value\n-----END CERTIFICATE-----',ca+ca])
  assert.throws(()=>normalizeHostedPracticeCa(value),error=>!error.message.includes('sensitive-value'));
});
test('hosted policy catalog casts role names to driver-supported text arrays before strict role checks',()=>{
 const {types}=require('pg');
 // pg 8.20 does not parse PostgreSQL name[] (OID 1003); text[] (1009) is parsed.
 // The live bootstrap rehearsal also executes this exact catalog query.
 assert.equal(types.getTypeParser(1003)('{epdg_synthetic_app}'),'{epdg_synthetic_app}');
 assert.deepEqual(types.getTypeParser(1009)('{epdg_synthetic_app}'),['epdg_synthetic_app']);
 assert.deepEqual(types.getTypeParser(1009)('{epdg_synthetic_app,other_role}'),['epdg_synthetic_app','other_role']);
 const source=readFileSync(join(__dirname,'../src/hosted-practice/readiness.ts'),'utf8');
 assert.match(source,/ARRAY\(SELECT rolname::text FROM pg_roles WHERE oid=ANY\(p\.polroles\)\) AS roles/);
 assert.match(source,/actual\.roles\.length === 1 && actual\.roles\[0\] === p\.databaseUser/);
});
test('hosted cookies and origin checks retain Secure HttpOnly Strict host-only behavior for exact approved portals',()=>{
 const config=portalConfig(env());assert.equal(config.cookieName,'__Host-epdg_session');assert.equal(config.cookie.secure,true);
 assert.equal(config.cookie.httpOnly,true);assert.equal(config.cookie.sameSite,'strict');assert.equal(config.cookie.path,'/');assert.equal(config.cookie.domain,undefined);
 for(const origin of profile.frontendOrigins)assert.equal(portalOriginAllowed(origin,env()),true);
 for(const origin of [undefined,'null','http://portal.example.invalid','https://unreviewed.example.invalid',profile.frontendOrigin+'/path'])assert.equal(portalOriginAllowed(origin,env()),false);
});
test('hosted handoff configuration uses a separate canonical independent key and remains default-off',()=>{
 const config=handoffConfig(env());assert.deepEqual(config.key,key);assert.equal(config.hosted.backendOrigin,profile.backendOrigin);config.key.fill(0);
 assert.equal(handoffEnabled({...env(),EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED:'0'}),false);
 for(const patch of [{EPDG_HOSTED_PRACTICE_HANDOFF_KEY:undefined},{EPDG_HOSTED_PRACTICE_HANDOFF_KEY:encoded+'='},
  {SESSION_CSRF_SECRET:encoded},{DB_PASSWORD:encoded}])assert.throws(()=>handoffConfig({...env(),...patch}));
});
test('hosted preferred login alias routes only to existing fictional learner B without changing privileges',()=>{
 assert.equal(resolvePracticeEmail('admin@theemersonempire.info',env()),'learner-b@epdg.invalid');
 for(const email of ['learner-b@epdg.invalid','school-b@epdg.invalid','unrecognized@example.invalid'])assert.equal(resolvePracticeEmail(email,env()),email);
 assert.equal(resolvePracticeEmail('admin@theemersonempire.info',{}),'admin@theemersonempire.info');
 assert.throws(()=>resolvePracticeEmail('admin@theemersonempire.info',{...env(),EPDG_HOSTED_PRACTICE_LOGIN_ALIAS:'other@example.invalid'}));
});
test('hosted health fails before database access when the enabled service signing key is invalid',async()=>{
 const previous=process.env.EPDG_HOSTED_PRACTICE_HANDOFF_KEY;
 process.env.EPDG_HOSTED_PRACTICE_HANDOFF_KEY='invalid-unit-only-key';
 try{await assert.rejects(checkHostedReadiness(),error=>error.statusCode===503);}finally{process.env.EPDG_HOSTED_PRACTICE_HANDOFF_KEY=previous;}
});
test('hosted recovery mail is captured privately with reserved recipients and never falls through to a provider',async()=>{
 const db=require('../dist/db/index.js'),original=db.getPool,captured=[];
 db.getPool=()=>({query:async(sql,values)=>{captured.push({sql,values});return {rows:[]};}});
 try{
  const {deliverEmail}=require('../dist/utils/mailDelivery.js');const valid={from:'EPDG Synthetic <no-reply@epdg.invalid>',to:'learner-b@epdg.invalid',subject:'EPDG portal password recovery',html:'<p>SYNTHETIC recovery link fixture</p>'};
  assert.deepEqual(await deliverEmail(valid),{error:null});assert.equal(captured.length,1);assert.match(captured[0].sql,/^INSERT INTO hosted_practice\.mail_capture/);assert.deepEqual(captured[0].values,[valid.from,valid.to,valid.subject,valid.html]);
  for(const patch of [{to:'real@example.com'},{from:'unexpected@epdg.invalid'},{subject:'unreviewed message'},{html:'x'.repeat(16385)},{to:['learner-b@epdg.invalid','school-b@epdg.invalid']}])await assert.rejects(deliverEmail({...valid,...patch}));
  assert.equal(captured.length,1);
 }finally{db.getPool=original;}
});
test('hosted HMAC domain binds the audience and source and cannot authenticate a local envelope',()=>{
 const raw=Buffer.from(JSON.stringify(event())),timestamp=String(Math.floor(Date.now()/1000)),nonce=id(12);
 const expected=['EPDG-CRM-HOSTED-PRACTICE-V1','POST',handoffPath,profile.backendOrigin,profile.crmOrigin,timestamp,nonce,require('node:crypto').createHash('sha256').update(raw).digest('hex')].join('\n');
 assert.equal(handoffSigningText(timestamp,nonce,raw,profile),expected);
 const signature=createHmac('sha256',key).update(expected).digest('hex');
 assert.equal(verifyHandoffSignature(key,timestamp,nonce,signature,raw,Date.now(),profile).nonce,nonce);
 assert.throws(()=>verifyHandoffSignature(key,timestamp,nonce,signature,raw));
 for(const other of [{...profile,backendOrigin:'https://other.example.invalid'},{...profile,crmOrigin:'https://other.example.invalid'}])assert.throws(()=>verifyHandoffSignature(key,timestamp,nonce,signature,raw,Date.now(),other));
 assert.equal(parseHandoffEvent(raw,'synthetic-hosted').environment,'synthetic-hosted');assert.throws(()=>parseHandoffEvent(raw));
 const local=Buffer.from(JSON.stringify({...event(),environment:'synthetic-local'}));assert.throws(()=>parseHandoffEvent(local,'synthetic-hosted'));
});
async function serving(app,work){const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});try{return await work(server.address().port);}finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}
function request(port,path,{raw=Buffer.alloc(0),method='GET',headers={}}={}){return new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:new URL(profile.backendOrigin).host,'X-Forwarded-Proto':'https',...headers}},res=>{let text='';res.on('data',c=>{text+=c;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),headers:res.headers});}catch{reject(new Error('Unexpected local unit response'));}});});req.on('error',reject);req.end(raw);
});}
test('hosted receiver accepts only raw service authentication and approved HTTPS host/audience/source metadata',async()=>{
 let received=0;const app=express();app.use(handoffPath,createHandoffRouter({receive:async()=>{received++;return {success:true};}}));app.use(errorHandler);
 await serving(app,async port=>{const raw=Buffer.from(JSON.stringify(event())),timestamp=String(Math.floor(Date.now()/1000)),nonce=id(13);
  const headers={'Content-Type':'application/json','Content-Length':raw.length,'X-EPDG-Handoff-Key-Id':'synthetic-hosted-v1',
   'X-EPDG-Handoff-Timestamp':timestamp,'X-EPDG-Handoff-Nonce':nonce,'X-EPDG-Handoff-Signature':createHmac('sha256',key).update(handoffSigningText(timestamp,nonce,raw,profile)).digest('hex'),
   'X-EPDG-Handoff-Audience':profile.backendOrigin,'X-EPDG-Handoff-Source':profile.crmOrigin};
  assert.equal((await request(port,handoffPath,{method:'POST',raw,headers})).status,200);
  for(const patch of [{Host:'unreviewed.example.invalid'},{'X-Forwarded-Proto':'http'},{'X-EPDG-Handoff-Audience':profile.crmOrigin},
   {'X-EPDG-Handoff-Source':'https://other.example.invalid'},{Origin:profile.frontendOrigin},{Cookie:'forbidden=value'},{Authorization:'Bearer forbidden'},{'Sec-Fetch-Mode':'cors'},
   {'X-Forwarded-Host':'unreviewed.example.invalid'},{'X-Forwarded-Port':'80'}])assert.equal((await request(port,handoffPath,{method:'POST',raw,headers:{...headers,...patch}})).status,403);
  assert.equal(received,1);
 });
});
test('actual hosted service receipts preserve the CRM strict seven-field contract through the dedicated app',async()=>{
 const readiness=require('../dist/hosted-practice/readiness.js'),original=readiness.checkHostedDatabase;
 let checks=0,commits=0,record=null,current=null;const nonces=new Set(),mappingId=id(15),issued=event();
 readiness.checkHostedDatabase=async()=>{checks++;};
 const client={release(){},async query(sql,values=[]){
  if(sql==='BEGIN'||sql.startsWith('SELECT set_config(')||sql.startsWith('SELECT pg_advisory_xact_lock('))return {rows:[]};
  if(sql==='COMMIT'){commits++;return {rows:[]};}
  if(sql.startsWith('SELECT payload_sha256,mapping_id'))return {rows:record?[record]:[]};
  if(sql.startsWith('SELECT mapping.id'))return {rows:[{id:mappingId}]};
  if(sql.startsWith('SELECT 1 FROM synthetic_handoff.nonces'))return {rows:nonces.has(values[0])?[{exists:1}]:[]};
  if(sql.startsWith('SELECT decision_version FROM synthetic_handoff.events'))return {rows:current?[{decision_version:current.decision_version}]:[]};
  if(sql.startsWith('INSERT INTO synthetic_handoff.events(')){
   assert.equal(record,null);record={payload_sha256:values[1],mapping_id:values[2]};
   current={decision:values[5],withdrawn:values[13],decision_version:values[4],received_at:new Date()};return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO synthetic_handoff.nonces(')){nonces.add(values[0]);return {rows:[]};}
  if(sql.startsWith('SELECT decision,withdrawn,decision_version,received_at'))return {rows:current?[current]:[]};
  throw new Error('Unexpected unit database operation');
 }};
 try{
  const app=createHostedPracticeApp({readinessCheck:async()=>{},handoffService:new HandoffService(async()=>client)});
  await serving(app,async port=>{
   for(const [index,result]of ['accepted','duplicate'].entries()){
    if(index===1)current={decision:'revoked',withdrawn:true,decision_version:2,received_at:new Date()};
    const raw=Buffer.from(JSON.stringify(issued)),timestamp=String(Math.floor(Date.now()/1000)),nonce=id(16+index);
    const headers={'Content-Type':'application/json','Content-Length':raw.length,'X-EPDG-Handoff-Key-Id':'synthetic-hosted-v1',
     'X-EPDG-Handoff-Timestamp':timestamp,'X-EPDG-Handoff-Nonce':nonce,
     'X-EPDG-Handoff-Signature':createHmac('sha256',key).update(handoffSigningText(timestamp,nonce,raw,profile)).digest('hex'),
     'X-EPDG-Handoff-Audience':profile.backendOrigin,'X-EPDG-Handoff-Source':profile.crmOrigin};
    const response=await request(port,handoffPath,{method:'POST',raw,headers});assert.equal(response.status,200);
    // These are the exact fields enforced by CRM's parseHostedEducationReceipt.
    assert.deepEqual(Object.keys(response.body).sort(),['success','environment','event_id','result','received_at','current_status','decision_version'].sort());
    assert.deepEqual(response.body,{success:true,environment:'synthetic-hosted',event_id:issued.event_id,result,
     received_at:current.received_at.toISOString(),current_status:index===0?'ready':'withdrawn',decision_version:index===0?1:2});
    assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-epdg-environment'],'synthetic-hosted');
   }
  });
  assert.equal(checks,2);assert.equal(commits,2);assert.equal(nonces.size,2);
 }finally{readiness.checkHostedDatabase=original;}
});
test('hosted API rechecks readiness and denies login, sessions and recovery before service work after drift',async()=>{
 const {PortalService}=require('../dist/security/PortalService.js'),methods=['login','session','requestRecovery','resetPassword'];
 const saved=Object.fromEntries(methods.map(name=>[name,PortalService.prototype[name]]));let serviceCalls=0,checks=0,drift=false;
 for(const name of methods)PortalService.prototype[name]=async()=>{serviceCalls++;throw new Error('Portal service must stay behind readiness');};
 try{
  const app=createHostedPracticeApp({readinessCheck:async()=>{checks++;if(drift)throw new Error('Private catalog mismatch detail');}});
  await serving(app,async port=>{
   assert.equal((await request(port,'/api/auth/session')).status,401);assert.equal(checks,1);
   drift=true;
   for(const [path,method,body]of [['/api/auth/login','POST',{email:profile.loginAlias,password:'unit-only-fictional-password'}],
    ['/api/auth/session','GET',null],['/api/auth/forgot-password','POST',{email:profile.loginAlias}],
    ['/api/auth/reset-password','POST',{token:'unit-only-fictional-token',password:'unit-only-fictional-password'}]]){
    const result=await request(port,path,{method,raw:body?Buffer.from(JSON.stringify(body)):Buffer.alloc(0),headers:{'Content-Type':'application/json',Origin:profile.frontendOrigin,'X-EPDG-Request':'portal'}});
    assert.equal(result.status,503);assert.equal(result.body.environment,'synthetic-hosted');assert.equal(result.body.privileged_controls_available,false);
    assert.equal(JSON.stringify(result.body).includes('Private catalog mismatch detail'),false);
   }
   assert.equal(checks,5);assert.equal(serviceCalls,0);
   drift=false;assert.equal((await request(port,'/api/auth/session')).status,401);assert.equal(checks,6);
  });
 }finally{for(const name of methods)PortalService.prototype[name]=saved[name];}
});
test('dedicated app exposes only health and protected portal routes with explicit synthetic environment envelopes',async()=>{
 const app=createHostedPracticeApp({readinessCheck:async()=>{}});
 await serving(app,async port=>{
  const health=await request(port,'/health');assert.equal(health.status,200);assert.equal(health.body.environment,'synthetic-hosted');assert.equal(health.body.privileged_controls_available,false);
  assert.equal(health.headers['cache-control'],'no-store');assert.equal(health.headers['access-control-allow-origin'],undefined);
  for(const route of ['/api/owner','/api/invitations','/api/auth/register'])assert.equal((await request(port,route)).status,503);
  assert.equal((await request(port,'/api/admin')).status,401);assert.equal((await request(port,'/api/learner/onboarding')).status,401);
  assert.equal((await request(port,'/api/auth/login',{method:'POST',raw:Buffer.from('{}'),headers:{'Content-Type':'application/json',Origin:'https://other.example.invalid'}})).status,403);
  assert.equal((await request(port,'/legacy')).status,404);
 });
 const failed=createHostedPracticeApp({readinessCheck:async()=>{throw new Error('sensitive internal detail');}});
 await serving(failed,async port=>{const result=await request(port,'/health');assert.equal(result.status,500);assert.equal(result.body.environment,'synthetic-hosted');assert.ok(!JSON.stringify(result.body).includes('sensitive internal detail'));});
});
test('hosted migration is additive and source-pinned; startup cannot run migration or bootstrap SQL',()=>{
 const manifest=require('../src/hosted-practice/schema-manifest.json'),sql=readFileSync(join(__dirname,'../hosted-practice-migrations',manifest.file),'utf8');
 assert.equal(require('node:crypto').createHash('sha256').update(sql).digest('hex'),manifest.sha256);
 require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(manifest.file,sql);
 for(const file of ['src/hosted-practice/index.ts','src/hosted-practice/app.ts','src/hosted-practice/readiness.ts'])assert.doesNotMatch(readFileSync(join(__dirname,'..',file),'utf8'),/readFileSync|CREATE TABLE|ALTER TABLE|hosted-practice-migrations|bootstrap-sql/);
 assert.match(sql,/hosted_role_immutable BEFORE UPDATE ON core\.user_branch_roles/);assert.match(sql,/GRANT INSERT\(from_address,recipient,subject,html\)/);
 assert.doesNotMatch(sql,/GRANT SELECT ON hosted_practice\.mail_capture|SECURITY DEFINER|GRANT.*TO (PUBLIC|anon|authenticated)/i);
});
