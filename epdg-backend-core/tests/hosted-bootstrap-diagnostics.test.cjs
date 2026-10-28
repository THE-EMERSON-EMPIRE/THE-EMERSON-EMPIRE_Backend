'use strict';
// Public fake secrets and injected clients only. Never opens a provider socket.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const {EventEmitter}=require('node:events');
const {X509Certificate}=require('node:crypto');
const {rootCertificates}=require('node:tls');
const {bootstrap,bootstrapFailure}=require('../scripts/hosted-practice/bootstrap-supabase.cjs');
const profile=require('../src/hosted-practice/supabase-profile.json');
const manifest=require('../src/hosted-practice/supabase-schema-manifest.json');
const operator=require('../../scripts/hosted-practice/operator-profile.json');
const privateSentinel='Unit-private-diagnostic-sentinel-not-a-real-secret';
const ca=rootCertificates.find(value=>{const cert=new X509Certificate(value);return cert.ca&&Date.parse(cert.validFrom)<=Date.now()&&Date.parse(cert.validTo)>Date.now();});
const environment=()=>({EPDG_HOSTED_PRACTICE_BOOTSTRAP:'1',EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'supabase',
 RAILWAY_PROJECT_ID:profile.projectId,RAILWAY_ENVIRONMENT_ID:profile.environmentId,RAILWAY_SERVICE_ID:operator.bootstrapServiceId,
 EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD:'Unit-operator-private-placeholder-'.repeat(2),
 HOSTED_PRACTICE_APP_PASSWORD:'Unit-app-private-placeholder-'.repeat(2),
 HOSTED_PRACTICE_FIXTURE_PASSWORD:'Unit-fixture-private-placeholder-'.repeat(2),HOSTED_PRACTICE_DB_CA_CERT:ca});
const keys=new Set(['success','environment','operation','phase','code','gate','variable','check']);
function safe(error){
 const result=bootstrapFailure(error),serialized=JSON.stringify(result);
 assert.equal(result.success,false);assert.equal(result.environment,'synthetic-hosted');assert.equal(result.operation,'supabase-bootstrap');
 assert.ok(Object.keys(result).every(key=>keys.has(key)),'Only the fixed diagnostic fields may be emitted');
 for(const [key,value]of Object.entries(result))if(key!=='success')assert.equal(typeof value,'string');
 assert.ok(!serialized.includes(privateSentinel),'Raw fake secret must never enter the safe diagnostic');
 for(const value of Object.values(environment()))if(typeof value==='string'&&value.length>=32)
  assert.ok(!serialized.includes(value),'Certificate and runtime values must never enter the safe diagnostic');
 for(const forbidden of ['message','detail','query','params','stack','cause','passwordLength','credentialLength'])assert.equal(Object.hasOwn(result,forbidden),false);
 return result;
}
const poisoned=code=>Object.assign(new Error(privateSentinel),{code,detail:privateSentinel,query:privateSentinel,
 params:[privateSentinel],stack:privateSentinel,cause:new Error(privateSentinel),
 phase:privateSentinel,gate:privateSentinel,variable:privateSentinel,check:privateSentinel});
async function failure(options){
 let caught;
 try{await bootstrap(options);}catch(error){caught=error;}
 assert.ok(caught,'The injected bootstrap failure must be rethrown');return caught;
}

test('untrusted diagnostic properties and raw error material cannot forge safe bootstrap metadata',()=>{
 const result=safe(poisoned(privateSentinel));
 assert.equal(result.phase,'unclassified');assert.equal(result.code,'UNCLASSIFIED');
 for(const key of ['gate','variable','check'])assert.equal(Object.hasOwn(result,key),false);
 for(const error of [undefined,null,privateSentinel,{message:privateSentinel,code:privateSentinel},new Error(privateSentinel)]){
  const summary=safe(error);assert.equal(summary.phase,'unclassified');assert.equal(summary.code,'UNCLASSIFIED');
 }
});

test('only finite approved SQLSTATE, network and TLS codes survive diagnostic sanitization',()=>{
 for(const code of ['EPDG_GATE','ERR_ASSERTION','28P01','42501','ENOTFOUND','ECONNREFUSED','ETIMEDOUT','ERR_TLS_CERT_ALTNAME_INVALID']){
  const summary=safe(poisoned(code));assert.equal(summary.phase,'unclassified');assert.equal(summary.code,code);
  for(const key of ['gate','variable','check'])assert.equal(Object.hasOwn(summary,key),false);
 }
 for(const code of ['28P01\n'+privateSentinel,'P0001',privateSentinel,0,null,{},['28P01']])
  assert.equal(safe(poisoned(code)).code,'UNCLASSIFIED');
 let reads=0;const changing={get code(){reads++;return reads===1?'ENOTFOUND':privateSentinel;}};
 assert.equal(safe(changing).code,'ENOTFOUND');assert.equal(reads,1,'Read untrusted code getter only once');
 assert.equal(safe({get code(){throw new Error(privateSentinel);}}).code,'UNCLASSIFIED');
});

test('actual operator CLI prints one safe preflight JSON failure and no raw stack',()=>{
 const child=spawnSync(process.execPath,[join(__dirname,'../scripts/hosted-practice/bootstrap-supabase.cjs')],
  {env:{EPDG_HOSTED_PRACTICE_BOOTSTRAP:privateSentinel},encoding:'utf8',timeout:10000,maxBuffer:32768,windowsHide:true});
 assert.equal(child.error,undefined,'The local preflight child must start and finish within its bounded timeout');
 assert.equal(child.status,1);assert.equal(child.signal,null);assert.equal(child.stdout,'');
 const lines=child.stderr.trim().split(/\r?\n/);assert.equal(lines.length,1);
 const result=JSON.parse(lines[0]);assert.deepEqual(result,{success:false,environment:'synthetic-hosted',operation:'supabase-bootstrap',
  phase:'environment',code:'EPDG_GATE',gate:'operator_environment',variable:'EPDG_HOSTED_PRACTICE_BOOTSTRAP'});
 assert.ok(!child.stderr.includes(privateSentinel));assert.doesNotMatch(child.stderr,/\bat (?:\S+|Object\.)|\bError:|\bdetails?\b|password/i);
});

test('environment diagnostics stop before client construction and expose no runtime value or length',async()=>{
 let constructed=0;class NeverConnect{constructor(){constructed++;throw new Error(privateSentinel);}}
 for(const patch of [{RAILWAY_SERVICE_ID:privateSentinel},{SMTP_PASSWORD:privateSentinel},
  {EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD:'short'},{HOSTED_PRACTICE_DB_CA_CERT:privateSentinel}]){
  const error=await failure({env:{...environment(),...patch},ClientCtor:NeverConnect});
  const result=safe(error);assert.equal(result.phase,'environment');
  assert.equal(result.code,Object.hasOwn(patch,'HOSTED_PRACTICE_DB_CA_CERT')?'UNCLASSIFIED':'EPDG_GATE');
  if(result.variable)assert.ok(Object.keys(patch).includes(result.variable),'Only the rejected variable name is allowed');
 }
 assert.equal(constructed,0);assert.equal(profile.enabled,false);
});

test('connection failures preserve the original error while reporting only the fixed connect phase',async()=>{
 for(const code of ['28P01','ENOTFOUND','ERR_TLS_CERT_ALTNAME_INVALID',privateSentinel]){
  const original=poisoned(code);let connected=0,queries=0;
  class BrokenConnect{async connect(){connected++;throw original;}async query(){queries++;throw new Error(privateSentinel);}async end(){}}
  const caught=await failure({env:environment(),ClientCtor:BrokenConnect});assert.equal(caught,original);
  const result=safe(caught);assert.equal(result.phase,'connect');assert.equal(result.code,code===privateSentinel?'UNCLASSIFIED':code);
  assert.equal(connected,1);assert.equal(queries,0);
 }
});

test('transaction startup failures retain their error and report begin without SQL or parameters',async()=>{
 const original=poisoned('42501'),queries=[];
 class BrokenBegin{async connect(){}async query(sql){queries.push(sql);if(sql==='BEGIN')throw original;return {rows:[]};}async end(){}}
 const caught=await failure({env:environment(),ClientCtor:BrokenBegin});assert.equal(caught,original);
 const result=safe(caught);assert.equal(result.phase,'begin');assert.equal(result.code,'42501');
 assert.equal(queries[0],'BEGIN');assert.ok(queries.every(sql=>sql==='BEGIN'||sql==='ROLLBACK'));
});

test('idle client error events are captured privately and prohibit further operator or runtime SQL',async()=>{
 for(const location of ['operator_connect','operator_query','runtime_connect']){
  const original=poisoned('ECONNRESET'),clients=[];
  class IdleFailure extends EventEmitter{
   constructor(){super();this.number=clients.length+1;this.queries=[];clients.push(this);}
   async connect(){if((location==='operator_connect'&&this.number===1)||(location==='runtime_connect'&&this.number===2)){
    assert.equal(this.listenerCount('error'),1);this.emit('error',original);
   }}
   async end(){}
   async query(sql){
    this.queries.push(sql);
    if(location==='operator_query'){assert.equal(this.listenerCount('error'),1);this.emit('error',original);return {rows:[]};}
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.startsWith('SELECT current_database()'))return {rows:[{db:'postgres',role:'postgres',port:5432,tls:true,
     rolsuper:false,rolcreaterole:true,rolbypassrls:true}]};
    if(sql.includes('AS schemas'))return {rows:[{schemas:'unit-public-managed-placeholder'}]};
    if(sql.includes("to_regclass('hosted_practice.identity')"))return {rows:[{present:true}]};
    if(sql.includes('FROM hosted_practice.identity'))return {rows:[{instance_id:profile.instanceId,project_id:profile.projectId,
     environment_id:profile.environmentId,service_id:profile.serviceId,supabase_project_ref:profile.supabaseProjectRef,
     supabase_organization_id:profile.supabaseOrganizationId,database_host:profile.databaseHost,baseline_sha256:profile.baselineSha256,
     isolation_sha256:profile.isolationSha256,schema_sha256:manifest.hosted.sha256}]};
    if(sql.includes('FROM synthetic_learning.schema_migrations'))return {rows:manifest.learning.map(({version,sha256})=>({version,sha256}))};
    throw new Error('Unexpected unit SQL');
   }
  }
  const error=await failure({env:environment(),ClientCtor:IdleFailure});assert.equal(error,original);
  const result=safe(error);assert.equal(result.code,'ECONNRESET');
  assert.equal(result.phase,location==='operator_connect'?'connect':location==='operator_query'?'begin':'runtime_connect');
  if(location==='operator_connect')assert.equal(clients[0].queries.length,0);
  else if(location==='operator_query')assert.deepEqual(clients[0].queries,['BEGIN']);
  else{assert.equal(clients.length,2);assert.equal(clients[1].queries.length,0);}
 }
});

test('operator identity rejection reports a fixed check without leaking assertion actual or expected rows',async()=>{
 class WrongOperator{async connect(){}async query(sql){
  if(sql.startsWith('SELECT current_database()'))return {rows:[{db:privateSentinel,role:privateSentinel,port:5432,tls:false,
   rolsuper:false,rolcreaterole:true,rolbypassrls:true}]};
  if(sql==='BEGIN'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  throw new Error(privateSentinel);
 }async end(){}}
 const error=await failure({env:environment(),ClientCtor:WrongOperator});const result=safe(error);
 assert.equal(result.phase,'operator_identity');assert.equal(result.code,'ERR_ASSERTION');
 assert.equal(typeof result.check,'string');assert.match(result.check,/^[a-z][a-z0-9_]*$/);
 assert.notEqual(result.check,privateSentinel);
});
