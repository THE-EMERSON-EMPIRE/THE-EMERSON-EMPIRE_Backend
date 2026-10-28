'use strict';
// Public fictional fixtures and injected IO only. Never opens a provider socket.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {EventEmitter}=require('node:events');
const {createHash,X509Certificate}=require('node:crypto');
const {rootCertificates}=require('node:tls');
const profile=require('../src/hosted-practice/supabase-profile.json');
const originalProfile=JSON.stringify(profile);
const manifest=require('../src/hosted-practice/supabase-schema-manifest.json');
const operator=require('../../scripts/hosted-practice/operator-profile.json');
const email='learner-a@epdg.invalid';
const fixturePassword='Unit-fictional-restore-only-9!'.repeat(2);
const resetToken=Buffer.alloc(32,41).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const recoveryHtml=link=>'<p>A password reset was requested for your account.</p><p><a href="'+link+
 '">Reset password</a></p><p>This link expires in 20 minutes. If you did not request it, ignore this message.</p>';
const ca=rootCertificates.find(value=>{const cert=new X509Certificate(value);return cert.ca&&Date.parse(cert.validFrom)<=Date.now()&&Date.parse(cert.validTo)>Date.now();});
function environment(){return {
 EPDG_HOSTED_PRACTICE_BOOTSTRAP:'1',EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'supabase',
 EPDG_HOSTED_PRACTICE_RECOVERY_ACCEPTANCE:'1',RAILWAY_PROJECT_ID:profile.projectId,
 RAILWAY_ENVIRONMENT_ID:profile.environmentId,RAILWAY_SERVICE_ID:operator.bootstrapServiceId,
 EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD:'Unit-operator-only-not-real-'.repeat(2),
 HOSTED_PRACTICE_APP_PASSWORD:'Unit-app-only-not-real-'.repeat(2),
 HOSTED_PRACTICE_FIXTURE_PASSWORD:fixturePassword,HOSTED_PRACTICE_DB_CA_CERT:ca,
};}
function identity(){return {db:'postgres',role:'postgres',port:5432,tls:true,read_only:'on',
 instance_id:profile.instanceId,project_id:profile.projectId,environment_id:profile.environmentId,
 service_id:profile.serviceId,supabase_project_ref:profile.supabaseProjectRef,
 supabase_organization_id:profile.supabaseOrganizationId,database_host:profile.databaseHost,
 baseline_sha256:profile.baselineSha256,isolation_sha256:profile.isolationSha256,
 schema_sha256:manifest.hosted.sha256,source_instance:profile.instanceId,source_provider:'supabase',
 source_project_ref:profile.supabaseProjectRef,source_baseline:profile.baselineSha256,
 source_isolation:profile.isolationSha256};}
function harness(options={}){
 const state={constructed:0,connected:0,ended:0,requests:[],queries:[],events:[],sessions:new Map(),
  currentPassword:fixturePassword,resetAccepted:false,resetAttempts:0,restores:0,forgot:0,tokenConsumed:false,
  knownSecrets:new Set([fixturePassword,resetToken]),since:new Date(),baselineCaptures:4,sessionSerial:0};
 const envelope=value=>({success:true,environment:'synthetic-hosted',privileged_controls_available:false,...value});
 const response=(status,body={},headers={})=>({status,body:envelope(body),headers});
 function sessionFor(session){return session&&state.sessions.get(session.cookie);}
 function login(password){
  if(password!==state.currentPassword)return response(401,{success:false});
  const raw=Buffer.alloc(32,++state.sessionSerial).toString('base64url');
  const csrf=Buffer.alloc(32,100+state.sessionSerial).toString('base64url');
  const cookie='__Host-epdg_session='+raw;
  state.knownSecrets.add(raw);state.knownSecrets.add(csrf);state.knownSecrets.add(cookie);
  state.sessions.set(cookie,{raw,csrf,valid:true,serial:state.sessionSerial});
  const result=response(200,{user:{id:2,email:options.loginWrongEmail?'learner-b@epdg.invalid':email,
   legacy_role:'intern',memberships:[],permissions:[],privileged_controls_available:false},csrf_token:csrf,
   expires_at:new Date(Date.now()+3600000).toISOString()},
   {'set-cookie':[cookie+'; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=Strict']});
  if(options.badEnvelope)result.body.environment='synthetic-local';
  if(options.missingCookie)result.headers['set-cookie']=[];
  return result;
 }
 function revoke(){for(const session of state.sessions.values())session.valid=false;}
 function capture(){return {id:'91000000-0000-4000-8000-000000000001',
  from_address:'EPDG Synthetic <no-reply@epdg.invalid>',recipient:email,subject:'EPDG portal password recovery',
  html:recoveryHtml(profile.frontendOrigin+'/reset-password#token='+resetToken),
  captured_at:new Date(state.since.getTime()+1),total:state.baselineCaptures+1,...options.capture};}
 class FakeClient extends EventEmitter{
  constructor(config){super();state.constructed++;state.connection=config;}
  async connect(){
   state.connected++;if(options.connectError)throw new Error(options.connectError);
   if(options.idleError){state.idleListenerAttached=this.listenerCount('error')>0;
    if(state.idleListenerAttached)this.emit('error',new Error(options.idleError));
    else throw new Error('Unit client has no idle-error listener');}
  }
  async end(){state.ended++;if(options.endError)throw new Error(options.endError);}
  async query(sql,values=[]){
   state.queries.push({sql,values});
   if(['SET SESSION search_path TO pg_catalog,epdg,pg_temp','SET SESSION default_transaction_read_only TO on','SET SESSION statement_timeout TO 10000'].includes(sql))return {rows:[]};
   if(sql.startsWith("SELECT current_setting('search_path')"))return {rows:[{search_path:'pg_catalog,epdg,pg_temp',read_only:'on',statement_timeout:'10s'}]};
   const stripped=sql.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*--.*$/gm,'').trim();
   assert.ok(/^SELECT\b/i.test(stripped),'Operator must issue SELECT only');
   assert.ok(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|SET)\b/i.test(stripped),'No SQL mutation or settings statement');
   for(const value of values)if(typeof value==='string')for(const secret of state.knownSecrets)
    assert.ok(!value.includes(secret),'SQL parameters may contain hashes, never raw credentials/session/recovery tokens');
   if(sql.includes('recovery-acceptance:identity'))return {rows:[{...identity(),...options.identity}]};
   if(sql.includes('recovery-acceptance:capture-marker'))return {rows:[{since:state.since,n:state.baselineCaptures}]};
   if(sql.includes('recovery-acceptance:session')){
    assert.ok(values[0]===email&&values[2]===state.since&&/^[a-f0-9]{64}$/.test(values[1]),'Session proof binds learner A, hashed token and DB clock marker');
    const found=[...state.sessions.values()].some(s=>s.valid&&values.includes(hash(s.raw)));
    state.events.push('target-session-proof');
    return {rows:[{n:options.targetSessionMissing?0:found?1:0}]};
   }
   if(sql.includes('recovery-acceptance:capture')){
    assert.ok(/captured_at\s*>=\s*\$2/.test(sql),'Capture query must be bounded by DB clock marker');
    assert.ok(values[0]===email&&values[1]===state.since,'Capture query must bind only learner A and the exact marker');
    let rows=options.captureCount===0?[]:[capture()];
    if(options.captureCount===2)rows.push({...capture(),id:'91000000-0000-4000-8000-000000000002'});
    rows=rows.filter(row=>new Date(row.captured_at).getTime()>=state.since.getTime());
    return {rows};
   }
   if(sql.includes('recovery-acceptance:token')){
    assert.ok(values[0]===email&&values[1]===hash(resetToken),'Token metadata must bind learner A and the captured token hash');
    return {rows:options.tokenMissing?[]:[{lifetime_seconds:1200,active:true,...options.token}]};
   }
   throw new Error('Unexpected SELECT tag');
  }
 }
 async function requestJson(request){
  state.requests.push(request);state.events.push(request.path);
  assert.ok(request.origin===profile.backendOrigin,'API origin is source-pinned');
  assert.ok(request.portalOrigin===profile.frontendOrigin,'Portal origin is source-pinned');
  assert.ok(!request.path.includes('?')&&!request.path.includes('#'),'Tokens never travel in request URLs');
  if(request.path==='/health')return response(200,{status:'ready'});
  const input=request.body??{};
  if(request.path==='/api/auth/login'){
   assert.deepEqual(Object.keys(input).sort(),['email','password']);
   assert.ok(input.email===email,'Only the fictional learner A is used');
   return login(input.password);
  }
  if(request.path==='/api/auth/forgot-password'){
   assert.deepEqual(Object.keys(input),['email']);assert.ok(input.email===email);
   assert.ok(state.events.includes('target-session-proof'),'Target DB session proof must precede recovery');
   state.forgot++;return response(200,{message:'If the account is eligible, recovery instructions will be sent'});
  }
  if(request.path==='/api/auth/reset-password'){
   assert.deepEqual(Object.keys(input).sort(),['password','token']);state.resetAttempts++;
   if(state.tokenConsumed||input.token!==resetToken)return response(400,{success:false});
   assert.ok(typeof input.password==='string'&&input.password!==fixturePassword,'Reset uses a new fictional temporary password');
   state.knownSecrets.add(input.password);state.currentPassword=input.password;
   state.resetAccepted=true;state.tokenConsumed=true;revoke();
   if(options.ambiguousResetError){options.ambiguousResetError=false;throw new Error('Unit raw transport failure '+resetToken+' '+input.password);}
   return response(200);
  }
  if(request.path==='/api/auth/session'){
   if(state.resetAccepted&&options.failureAfterReset){options.failureAfterReset=false;throw new Error('Unit raw session failure '+resetToken);}
   const session=sessionFor(request.session);
   if(state.cleanupReady&&!state.cleanupFaultInjected&&(options.cleanupErrorStatus||options.cleanupWrongEnvelope)){
    state.cleanupFaultInjected=true;const result=response(options.cleanupErrorStatus??401,{success:false});
    if(options.cleanupWrongEnvelope)result.body.environment='synthetic-local';return result;
   }
   if(state.restoredSessionSerial&&session&&!session.valid&&session.serial<state.restoredSessionSerial){
    state.afterRestoreRevocations??=new Set();state.afterRestoreRevocations.add(session.serial);
    if(state.afterRestoreRevocations.size===2)state.cleanupReady=true;
   }
   return session?.valid?response(200,{user:{id:2,email,legacy_role:'intern',permissions:[],privileged_controls_available:false},csrf_token:session.csrf}):response(401,{success:false});
  }
  if(request.path==='/api/auth/change-password'){
   const session=sessionFor(request.session);
   assert.ok(session?.valid&&request.session.csrf===session.csrf,'Restore requires current session and CSRF');
   assert.deepEqual(Object.keys(input).sort(),['current_password','new_password']);
   if(options.restorationFailure)return response(503,{success:false});
   if(input.current_password!==state.currentPassword)return response(400,{success:false});
   assert.ok(input.new_password===fixturePassword,'Only the original fixture credential is restored');
   state.currentPassword=input.new_password;state.restores++;revoke();return response(200);
  }
  if(request.path==='/api/auth/logout'){
   const session=sessionFor(request.session);
   if(!session?.valid)return response(401,{success:false});
   assert.ok(request.session.csrf===session.csrf);session.valid=false;
   if(state.restores>0)state.restoredSessionSerial=session.serial;return response(200);
  }
  throw new Error('Unexpected API path');
 }
 return {state,ClientCtor:FakeClient,requestJson,sleep:async()=>{
  state.sleeps=(state.sleeps??0)+1;assert.ok(state.sleeps<=50,'Capture polling must be bounded');
  await new Promise(resolve=>setImmediate(resolve));
 },env:environment()};
}
async function run(io){
 for(const key of ['EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD','HOSTED_PRACTICE_APP_PASSWORD','HOSTED_PRACTICE_FIXTURE_PASSWORD'])
  if(io.env[key])io.state.knownSecrets.add(io.env[key]);
 const output=[];const methods=['log','warn','error'],saved=Object.fromEntries(methods.map(k=>[k,console[k]]));
 for(const method of methods)console[method]=(...args)=>output.push(args.map(String).join(' '));
 let result;
 try{
  const {acceptRecovery}=require('../scripts/hosted-practice/recovery-acceptance.cjs');
  try{result=await acceptRecovery(io);}catch{throw new Error('Acceptance must return a safe failure summary, never throw raw IO errors');}
 }finally{for(const method of methods)console[method]=saved[method];}
 assert.ok(result&&typeof result==='object');
 assert.ok(Object.keys(result).every(k=>['success','environment','fixtureRestored','failure_stage',
  'passwordResetAttempted','sessionBindingVerified','restoration_required'].includes(k)),'Summary has no unapproved diagnostic fields');
 for(const key of ['passwordResetAttempted','sessionBindingVerified','restoration_required'])
  if(key in result)assert.equal(typeof result[key],'boolean');
 assert.equal(typeof result.success,'boolean');assert.equal(typeof result.fixtureRestored,'boolean');
 assert.equal(result.environment,'synthetic-hosted');
 if(!result.success)assert.match(result.failure_stage,/^[a-z_]+$/);
 const serialized=JSON.stringify(result)+'\n'+output.join('\n');
 for(const secret of io.state.knownSecrets)assert.ok(!serialized.includes(secret),'No credential, cookie, CSRF or recovery token is emitted');
 assert.ok(!serialized.includes('<a href=')&&!serialized.includes('Unit raw'),'No mail HTML or raw IO exception is emitted');
 return result;
}

test('recovery acceptance opt-in and existing strict environment fail before any IO',async()=>{
 for(const patch of [{EPDG_HOSTED_PRACTICE_RECOVERY_ACCEPTANCE:undefined},{EPDG_HOSTED_PRACTICE_RECOVERY_ACCEPTANCE:'true'},
  {RAILWAY_SERVICE_ID:profile.serviceId},{HOSTED_PRACTICE_DB_CA_CERT:undefined},
  {EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD:undefined},{OPERATOR_PASSWORD:'unit-forbidden-legacy-secret'},
  {NODE_TLS_REJECT_UNAUTHORIZED:'0'},{NODE_DEBUG:'https'},{NODE_DEBUG_NATIVE:'tls'}]){
  const io=harness();io.env={...io.env,...patch};const result=await run(io);
  assert.equal(result.success,false);assert.equal(io.state.constructed,0);assert.equal(io.state.requests.length,0);
 }
});

test('fixed learner A flow proves selected database, exercises recovery and restores via normal API',async()=>{
 const io=harness();const result=await run(io);
 assert.equal(result.success,true);assert.equal(result.fixtureRestored,true);
 assert.ok(io.state.currentPassword===fixturePassword,'Fixture restored');
 assert.equal(io.state.forgot,1);assert.ok(io.state.resetAttempts>=2,'Token reuse is tested');assert.equal(io.state.restores,1);
 assert.ok(io.state.events.indexOf('target-session-proof')<io.state.events.indexOf('/api/auth/forgot-password'));
 assert.ok(io.state.events.filter(x=>x==='target-session-proof').length>=3,'Initial, temporary and restored logins are bound to selected DB');
 assert.equal(io.state.ended,1);assert.equal(JSON.stringify(profile),originalProfile);
 assert.ok([...io.state.sessions.values()].every(s=>!s.valid),'Every test-created session is invalid at completion');
 const config=io.state.connection;assert.equal(config.host,profile.databaseConnectionHost);
 assert.equal(config.user,'postgres.'+profile.supabaseProjectRef);assert.equal(config.database,'postgres');
 assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.servername,profile.databaseConnectionHost);
 assert.ok(/(?:default_transaction_read_only|transaction_read_only)=on/.test(config.options),'Connection is read-only');
});

test('an API still writing sessions to the old Railway DB is rejected before forgot or reset',async()=>{
 const io=harness({targetSessionMissing:true});const result=await run(io);
 assert.equal(result.success,false);assert.equal(io.state.forgot,0);assert.equal(io.state.resetAttempts,0);assert.equal(io.state.restores,0);
 assert.ok(io.state.currentPassword===fixturePassword);assert.equal(io.state.ended,1);
});

test('database identity, TLS and read-only drift stop before API requests',async()=>{
 for(const patch of [{db:'epdg_synthetic'},{role:'epdg_synthetic_app'},{tls:false},{read_only:'off'},
  {source_provider:'railway'},{source_project_ref:'wrong'},{instance_id:'00000000-0000-4000-8000-000000000000'}]){
  const io=harness({identity:patch});const result=await run(io);
  assert.equal(result.success,false);assert.equal(io.state.requests.length,0);assert.equal(io.state.resetAttempts,0);assert.equal(io.state.ended,1);
 }
});

test('wrong login identity, wrapper metadata or missing cookie stop before recovery',async()=>{
 for(const options of [{loginWrongEmail:true},{badEnvelope:true},{missingCookie:true}]){
  const io=harness(options);const result=await run(io);
  assert.equal(result.success,false);assert.equal(io.state.forgot,0);assert.equal(io.state.resetAttempts,0);
  assert.ok(io.state.currentPassword===fixturePassword);
 }
});

test('connection, idle-event and cleanup errors return only secret-free failure summaries',async()=>{
 const raw='Unit raw database error '+resetToken+' '+fixturePassword;
 for(const options of [{connectError:raw},{idleError:raw},{endError:raw},{cleanupErrorStatus:503},{cleanupWrongEnvelope:true}]){
  const io=harness(options);const result=await run(io);assert.equal(result.success,false);
  if(options.endError){assert.equal(result.fixtureRestored,true);assert.equal(result.failure_stage,'database_cleanup');}
  else if(options.cleanupErrorStatus||options.cleanupWrongEnvelope){
   assert.equal(result.fixtureRestored,true);assert.equal(result.failure_stage,'session_cleanup');
   assert.equal(io.state.cleanupFaultInjected,true);assert.ok([...io.state.sessions.values()].every(s=>!s.valid));
  }
  else{assert.equal(io.state.requests.length,0);assert.equal(io.state.resetAttempts,0);}
  if(options.idleError){assert.equal(io.state.idleListenerAttached,true);assert.equal(io.state.queries.length,0);}
 }
});

test('missing, duplicate or mismatched capture is rejected without resetting credentials',async()=>{
 for(const options of [{captureCount:0},{captureCount:2},{capture:{recipient:'learner-b@epdg.invalid'}},
  {capture:{from_address:'other@epdg.invalid'}},{capture:{subject:'Unexpected subject'}},
  {capture:{html:recoveryHtml('https://wrong.invalid/reset-password#token='+resetToken)}},
  {capture:{html:recoveryHtml(profile.frontendOrigin+'/reset-password?token='+resetToken)}},
  {capture:{html:recoveryHtml(profile.frontendOrigin+'/other/../reset-password#token='+resetToken)}},
  {capture:{html:recoveryHtml(profile.frontendOrigin+'/reset-password#token='+resetToken).replace('20 minutes','2 hours')}},
  {capture:{total:9}},{capture:{captured_at:new Date(0)}}]){
  const io=harness(options);const result=await run(io);
  assert.equal(result.success,false);assert.equal(io.state.resetAttempts,0);assert.ok(io.state.currentPassword===fixturePassword);
 }
});

test('expired, missing or wrong-lifetime recovery metadata is rejected before reset',async()=>{
 for(const options of [{tokenMissing:true},{token:{active:false}},{token:{lifetime_seconds:1100}},{token:{lifetime_seconds:1300}}]){
  const io=harness(options);const result=await run(io);
  assert.equal(result.success,false);assert.equal(io.state.resetAttempts,0);assert.ok(io.state.currentPassword===fixturePassword);
 }
});

test('subsecond recovery timestamp evaluation retains the normal twenty-minute lifetime',async()=>{
 const io=harness({token:{lifetime_seconds:1199.999975}});const result=await run(io);
 assert.equal(result.success,true);assert.equal(result.fixtureRestored,true);assert.ok(io.state.currentPassword===fixturePassword);
});

test('failure after a completed reset still restores fixture through authenticated change-password',async()=>{
 const io=harness({failureAfterReset:true});const result=await run(io);
 assert.equal(result.success,false);assert.equal(result.fixtureRestored,true);assert.ok(io.state.currentPassword===fixturePassword);
 assert.equal(io.state.restores,1);assert.equal(io.state.ended,1);
});

test('ambiguous reset transport failure still attempts restoration without leaking raw exception',async()=>{
 const io=harness({ambiguousResetError:true});const result=await run(io);
 assert.equal(result.success,false);assert.equal(result.fixtureRestored,true);assert.ok(io.state.currentPassword===fixturePassword);
 assert.equal(io.state.restores,1);assert.equal(io.state.ended,1);
});

test('failed API restoration is explicitly reported and never claimed as a restored fixture',async()=>{
 const io=harness({restorationFailure:true});const result=await run(io);
 assert.equal(result.success,false);assert.equal(result.fixtureRestored,false);assert.equal(result.restoration_required,true);
 assert.equal(io.state.restores,0);assert.equal(io.state.ended,1);
});

test('real HTTP helper rejects non-pinned destinations and paths before constructing any socket',async()=>{
 const https=require('node:https'),original=https.request;
 const {requestJson}=require('../scripts/hosted-practice/recovery-acceptance.cjs');let requests=0;
 https.request=()=>{requests++;throw new Error('Unit socket construction is forbidden');};
 try{
  for(const patch of [{origin:'https://unreviewed.invalid'},{portalOrigin:'https://unreviewed.invalid'},
   {path:'/api/auth/login?token='+resetToken},{path:'/api/auth/owner'},{path:'https://unreviewed.invalid/'}]){
   let rejected=false;
   try{await requestJson({origin:profile.backendOrigin,portalOrigin:profile.frontendOrigin,
    path:'/api/auth/login',method:'POST',body:{},...patch});}catch{rejected=true;}
   assert.equal(rejected,true);assert.equal(requests,0);
  }
 }finally{https.request=original;}
});

test('email and endpoint-looking environment additions cannot redirect the fixed acceptance flow',async()=>{
 const io=harness();Object.assign(io.env,{EPDG_HOSTED_PRACTICE_RECOVERY_EMAIL:'learner-b@epdg.invalid',
  EPDG_HOSTED_PRACTICE_RECOVERY_ORIGIN:'https://unreviewed.invalid'});const result=await run(io);
 // Rejecting unknown selectors is also safe; they must never nominate IO targets.
 if(result.success)assert.equal(result.fixtureRestored,true);
 assert.ok(io.state.requests.every(r=>r.origin===profile.backendOrigin&&(!r.body?.email||r.body.email===email)));
});
