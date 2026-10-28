'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash,X509Certificate}=require('node:crypto');
const {rootCertificates}=require('node:tls');
const {validateHostedPracticeEnvironment,supabaseDatabaseConnection}=require('../dist/hosted-practice/profile.js');
const {databaseSearchPath}=require('../dist/db/index.js');
const {checkSupabaseIdentity}=require('../dist/hosted-practice/supabase-readiness.js');
const manifest=require('../src/hosted-practice/supabase-schema-manifest.json');
const configured=require('../src/hosted-practice/supabase-profile.json');
const p={...configured,enabled:true};
const ca=rootCertificates.find(value=>{const c=new X509Certificate(value);return c.ca&&Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)>Date.now();});
const env=()=>({EPDG_HOSTED_PRACTICE_MODE:'1',EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'supabase',NODE_ENV:'production',
 RAILWAY_PROJECT_ID:p.projectId,RAILWAY_ENVIRONMENT_ID:p.environmentId,RAILWAY_SERVICE_ID:p.serviceId,
 DB_HOST:p.databaseConnectionHost,DB_PORT:'5432',DB_NAME:p.databaseName,DB_USER:p.databaseLoginUser,DB_SSL:'true',
 DB_PASSWORD:'unit-only-db-password-'.repeat(3),SESSION_CSRF_SECRET:'unit-only-csrf-secret-'.repeat(3),
 HOSTED_PRACTICE_DB_CA_CERT:ca,HOSTED_PRACTICE_INSTANCE_ID:p.instanceId,PORTAL_ORIGIN:p.frontendOrigin,
 FRONTEND_URL:p.frontendOrigin,CORS_ORIGINS:p.frontendOrigins.join(','),EPDG_HOSTED_PRACTICE_LOGIN_ALIAS:p.loginAlias,
 MAIL_DELIVERY_MODE:'database-capture',SMTP_FROM:'EPDG Synthetic <no-reply@epdg.invalid>'});

test('Supabase source profile stays disabled while an explicitly reviewed candidate validates exact provider pins',()=>{
 assert.equal(configured.enabled,false);
 assert.throws(()=>validateHostedPracticeEnvironment(env()));
 assert.equal(validateHostedPracticeEnvironment(env(),p).supabaseProjectRef,'ymitqvcxttcbesijzbfy');
 for(const patch of [{EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:undefined},{EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'railway'},
  {EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'unreviewed'},{DB_HOST:'db.otherproject.supabase.co'},
  {DB_NAME:'epdg_synthetic'},{DB_USER:'postgres'},{DB_USER:'epdg_synthetic_app'},
  {DB_SSL:'false'},{SUPABASE_SERVICE_ROLE_KEY:'unit-forbidden-key'},{SUPABASE_URL:'https://unreviewed.invalid'},
  {EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD:'unit-forbidden-operator'},{HOSTED_PRACTICE_DB_CA_CERT:undefined}])
  assert.throws(()=>validateHostedPracticeEnvironment({...env(),...patch},p));
 for(const patch of [{supabaseProjectRef:'otherproject'},{databaseEndpoint:'transaction-pooler'},
  {databaseHost:'aws-0-us-west-1.pooler.supabase.com'},{inheritedPublicTemp:false},{databaseLoginUser:'postgres'}])
  assert.throws(()=>validateHostedPracticeEnvironment(env(),{...p,...patch}));
});

test('Supabase search path excludes public and explicitly places temp after catalog and application schema',()=>{
 // Default-disabled source cannot silently select a provider or open the portal.
 assert.equal(databaseSearchPath({}),'epdg,public');
 assert.throws(()=>databaseSearchPath(env()));
 const runtime=require('../dist/hosted-practice/supabase-profile.json'),original=runtime.enabled;
 runtime.enabled=true;
 try{assert.equal(databaseSearchPath(env()),'pg_catalog,epdg,pg_temp');}finally{runtime.enabled=original;}
});

test('only the verified session pooler maps project-suffixed logins to the unchanged SQL app principal',()=>{
 const session={...p,databaseEndpoint:'session-pooler',databaseConnectionHost:'aws-0-us-west-1.pooler.supabase.com',
  databaseLoginUser:`epdg_synthetic_app.${p.supabaseProjectRef}`};
 const sessionEnv={...env(),DB_HOST:session.databaseConnectionHost,DB_USER:session.databaseLoginUser};
 assert.equal(validateHostedPracticeEnvironment(sessionEnv,session).databaseUser,'epdg_synthetic_app');
 assert.deepEqual(supabaseDatabaseConnection(session),{host:session.databaseConnectionHost,user:session.databaseLoginUser,
  operatorUser:`postgres.${p.supabaseProjectRef}`});
 const direct={...p,databaseEndpoint:'direct',databaseConnectionHost:p.databaseHost,databaseLoginUser:'epdg_synthetic_app'};
 assert.deepEqual(supabaseDatabaseConnection(direct),{host:p.databaseHost,user:'epdg_synthetic_app',operatorUser:'postgres'});
 for(const patch of [{databasePort:6543},{databaseConnectionHost:'unreviewed.pooler.supabase.com'},
  {databaseLoginUser:'epdg_synthetic_app'},{databaseLoginUser:'epdg_synthetic_app.otherproject'},
  {databaseHost:session.databaseConnectionHost}])assert.throws(()=>supabaseDatabaseConnection({...session,...patch}));
});

function identity(){return {db:'postgres',role:p.databaseUser,port:5432,rolsuper:false,rolcreatedb:false,rolcreaterole:false,
 rolreplication:false,rolbypassrls:false,rolinherit:false,rolcanlogin:true,memberships:0,database_create:false,database_temp:true,database_owner:false,
 tls:true,search_path:'pg_catalog,epdg,pg_temp',instance_id:p.instanceId,project_id:p.projectId,environment_id:p.environmentId,
 service_id:p.serviceId,supabase_project_ref:p.supabaseProjectRef,supabase_organization_id:p.supabaseOrganizationId,
 database_host:p.databaseHost,baseline_sha256:p.baselineSha256,isolation_sha256:p.isolationSha256,schema_sha256:manifest.hosted.sha256,
 source_instance:p.instanceId,source_provider:'supabase',source_project_ref:p.supabaseProjectRef,source_baseline:p.baselineSha256,source_isolation:p.isolationSha256};}
function catalog(){return {app_tables:33,app_rls:33,app_owner_drift:false,app_relation_owner_drift:false,app_function_owner_drift:false,
 durable_owner:false,unknown_namespace:false,managed_create:false,managed_table:false,managed_column:false,managed_sequence:false,managed_definer:false,browser_effective:false,managed_schema_acl:p.managedSchemaAclMd5};}
const client=(first,second)=>({async query(sql){return {rows:[sql.startsWith('SELECT current_database()')?first:second]};}});
test('Supabase catalog gate rejects TLS, role, endpoint, marker, ownership and inherited capability drift',async()=>{
 await checkSupabaseIdentity(client(identity(),catalog()),p);
 for(const patch of [{role:'postgres'},{db:'other'},{port:6543},{tls:false},{rolbypassrls:true},{rolcreaterole:true},
  {rolinherit:true},{rolcanlogin:false},
  {memberships:1},{database_owner:true},{database_create:true},{database_temp:false},{search_path:'pg_temp,epdg,public'},
  {supabase_project_ref:'unreviewed'},{source_provider:'railway'},{source_project_ref:'unreviewed'},
  {source_instance:'unreviewed'},{schema_sha256:'0'.repeat(64)}])
  await assert.rejects(checkSupabaseIdentity(client({...identity(),...patch},catalog()),p),error=>error.statusCode===503);
 for(const patch of [{app_tables:34},{app_rls:32},{app_owner_drift:true},{app_relation_owner_drift:true},
  {app_function_owner_drift:true},{durable_owner:true},{unknown_namespace:true},{managed_create:true},{managed_table:true},{managed_column:true},{managed_sequence:true},
  {managed_definer:true},{browser_effective:true},{managed_schema_acl:'0'.repeat(32)}])
  await assert.rejects(checkSupabaseIdentity(client(identity(),{...catalog(),...patch}),p),error=>error.statusCode===503);
});

test('Supabase bundle records actual applied bytes while preserving original Railway and local migration evidence',()=>{
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const entries=[manifest.baseline,manifest.security,...manifest.learning,manifest.hosted];
 assert.equal(entries.length,11);assert.equal(new Set(entries.map(m=>m.file)).size,11);
 for(const m of entries){assert.match(m.file,/^supabase\/migrations\/\d{14}_epdg_supabase_[a-z_]+\.sql$/);
  assert.equal(hash(readFileSync(join(__dirname,'../..',m.file))),m.sha256);}
 assert.equal(p.baselineSha256,manifest.baseline.sha256);assert.equal(p.isolationSha256,manifest.hosted.sha256);
 assert.equal(manifest.appTables,33);assert.equal(manifest.appSecuredTables,33);assert.equal(manifest.hosted.policies,52);
 assert.equal(entries.some(m=>m.file.includes('20260708')),false,'Legacy directory entry is not in bootstrap allowlist');
 const learning=require('../src/learning/schema-manifest.json');
 const original=[learning,...learning.extensions];
 for(const [index,m]of manifest.learning.entries()){
  assert.equal(hash(readFileSync(join(__dirname,'../learning-migrations',original[index].file))),m.upstreamSha256);
  assert.equal(m.sha256===m.upstreamSha256,index<6,'Only the separately reviewed provider ports may differ');
 }
 const originalHosted=require('../src/hosted-practice/schema-manifest.json');
 assert.equal(hash(readFileSync(join(__dirname,'../hosted-practice-migrations',originalHosted.file))),originalHosted.sha256);
});

test('Supabase operator configuration rejects partial credentials before creating a network client',async()=>{
 const {bootstrap,environment}=require('../scripts/hosted-practice/bootstrap-supabase.cjs');let constructed=0;
 class NeverConnect{constructor(){constructed++;throw new Error('Network client must not be constructed');}}
 await assert.rejects(bootstrap({ClientCtor:NeverConnect,env:{}}),error=>error.message==='Supabase synthetic bootstrap configuration is unavailable');
 assert.equal(constructed,0);
 const operator=require('../../scripts/hosted-practice/operator-profile.json');
 class StopBeforeNetwork{constructor(){constructed++;throw new Error('Unit preflight completed before network');}}
 const operatorEnv={EPDG_HOSTED_PRACTICE_BOOTSTRAP:'1',
  EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'supabase',RAILWAY_PROJECT_ID:p.projectId,RAILWAY_ENVIRONMENT_ID:p.environmentId,
  RAILWAY_SERVICE_ID:operator.bootstrapServiceId,EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD:'unit-only-operator-'.repeat(3),
  HOSTED_PRACTICE_APP_PASSWORD:'unit-only-app-password-'.repeat(3),HOSTED_PRACTICE_FIXTURE_PASSWORD:'unit-only-fixture-password-'.repeat(2),
  HOSTED_PRACTICE_DB_CA_CERT:ca};
 await assert.rejects(bootstrap({ClientCtor:StopBeforeNetwork,env:operatorEnv}),error=>error.message==='Unit preflight completed before network');
 assert.equal(constructed,1,'All reviewed SQL must pass preflight before a connection is created');
 for(const name of ['OPERATOR_PASSWORD','OPERATOR_DB_PASSWORD','POSTGRES_PASSWORD','PGPASSWORD','SUPABASE_SERVICE_ROLE_KEY'])
  assert.throws(()=>environment({...operatorEnv,[name]:'unit-forbidden-legacy-secret'}));
});
