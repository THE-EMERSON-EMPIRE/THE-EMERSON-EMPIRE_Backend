'use strict';
// Explicit operator job. Not imported by API startup. No Supabase SDK/API keys.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const bcrypt=require('bcrypt');
const profile=require('../../src/hosted-practice/supabase-profile.json');
const manifest=require('../../src/hosted-practice/supabase-schema-manifest.json');
const operator=require('../../../scripts/hosted-practice/operator-profile.json');
const {normalizeHostedPracticeCa}=require('../../dist/hosted-practice/tls.js');
const {checkSupabaseIdentity}=require('../../dist/hosted-practice/supabase-readiness.js');
const {checkHostedAccessContract}=require('../../dist/hosted-practice/readiness.js');
const {supabaseDatabaseConnection}=require('../../dist/hosted-practice/profile.js');
const {seed}=require('./supabase-seed.cjs');
const learningPolicy=require('../local-synthetic/learning-migration-policy.cjs');
const originalLearning=require('../../src/learning/schema-manifest.json');
const root=path.resolve(__dirname,'../../..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const unavailable=()=>{throw new Error('Supabase synthetic bootstrap configuration is unavailable');};
const managed=['auth','extensions','graphql','graphql_public','pgbouncer','public','realtime','storage','vault'];

function environment(env=process.env){
 const exact={EPDG_HOSTED_PRACTICE_BOOTSTRAP:'1',EPDG_HOSTED_PRACTICE_DATABASE_PROVIDER:'supabase',
  RAILWAY_PROJECT_ID:profile.projectId,RAILWAY_ENVIRONMENT_ID:profile.environmentId,RAILWAY_SERVICE_ID:operator.bootstrapServiceId};
 if(profile.version!==2||profile.databaseProvider!=='supabase'||
  profile.supabaseProjectRef!=='ymitqvcxttcbesijzbfy'||profile.supabaseOrganizationId!=='hickjdguujhpyiqjddip'||
  profile.databaseHost!==`db.${profile.supabaseProjectRef}.supabase.co`||profile.databaseName!=='postgres'||
  profile.databasePort!==5432||profile.databaseUser!=='epdg_synthetic_app'||
  operator.projectId!==profile.projectId||operator.environmentId!==profile.environmentId||operator.appServiceId!==profile.serviceId||
  Object.entries(exact).some(([key,value])=>env[key]!==value)||profile.baselineSha256!==manifest.baseline.sha256||
  profile.isolationSha256!==manifest.hosted.sha256)unavailable();
 supabaseDatabaseConnection(profile);
 for(const key of ['EPDG_SYNTHETIC_MODE','EPDG_HOSTED_PRACTICE_MODE','DATABASE_URL','DATABASE_PUBLIC_URL','DB_PASSWORD',
  'PGPASSWORD','POSTGRES_PASSWORD','POSTGRES_USER','POSTGRES_DB','OPERATOR_PASSWORD','OPERATOR_DB_PASSWORD',
  'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PORT','SMTP_PASSWORD'])if(env[key])unavailable();
 const secret=name=>{const value=env[name];if(typeof value!=='string'||value.length<32)unavailable();return value;};
 const adminPassword=secret('EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD'),appPassword=secret('HOSTED_PRACTICE_APP_PASSWORD'),fixturePassword=secret('HOSTED_PRACTICE_FIXTURE_PASSWORD');
 if(new Set([adminPassword,appPassword,fixturePassword]).size!==3||Buffer.byteLength(fixturePassword,'utf8')>72)unavailable();
 return {adminPassword,appPassword,fixturePassword,ca:normalizeHostedPracticeCa(env.HOSTED_PRACTICE_DB_CA_CERT)};
}
function reviewed(m){
 if(!/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(m.file)||!/^[a-f0-9]{64}$/.test(m.sha256))unavailable();
 const sql=fs.readFileSync(path.join(root,m.file),'utf8');assert.equal(hash(sql),m.sha256,'Reviewed Supabase migration checksum');
 // Managed schemas, database ACLs and role authority are outside this bundle.
 const upstream=[originalLearning,...originalLearning.extensions].find(entry=>entry.sha256===m.sha256);
 // Reuse the existing exact receipt-PK replacement exception only when these
 // bytes match the immutable reviewed 006. No new destructive SQL is allowed.
 learningPolicy.validate(upstream?.file??m.file,sql);
 assert.doesNotMatch(sql,/SECURITY\s+DEFINER|ALTER\s+DATABASE|(?:GRANT|REVOKE).*ON\s+DATABASE/i);
 return sql;
}
async function managedSnapshot(db){
 const {rows:[value]}=await db.query(`SELECT
  (SELECT jsonb_agg(jsonb_build_array(n.nspname,pg_get_userbyid(n.nspowner),n.nspacl::text) ORDER BY n.nspname) FROM pg_namespace n WHERE n.nspname=ANY($1::text[])) AS schemas,
  (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[])) AS relations,
  (SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[])) AS functions,
  (SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype,d.defaclacl::text) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname=ANY($1::text[])) AS defaults,
  (SELECT datacl::text FROM pg_database WHERE datname=current_database()) AS database_acl`,[managed]);
 return value;
}
async function bootstrap({ClientCtor=Client,env=process.env}={}){
 const secrets=environment(env),baseline=reviewed(manifest.baseline),security=reviewed(manifest.security),
  learning=manifest.learning.map(m=>({...m,sql:reviewed(m)})),hosted=reviewed(manifest.hosted);
 const endpoint=supabaseDatabaseConnection(profile);
 const connection=password=>({host:endpoint.host,port:profile.databasePort,database:profile.databaseName,
  user:endpoint.operatorUser,password,ssl:{ca:secrets.ca,rejectUnauthorized:true,servername:endpoint.host},
  options:'-c search_path=pg_catalog,epdg,pg_temp',connectionTimeoutMillis:10000,statement_timeout:30000});
 const db=new ClientCtor(connection(secrets.adminPassword));await db.connect();let added=false;
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-supabase-synthetic-bootstrap-v1',0))");
  const {rows:[identity]}=await db.query(`SELECT current_database() AS db,current_user AS role,inet_server_port() AS port,
   (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,r.rolsuper,r.rolcreaterole,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`);
  assert.deepEqual(identity,{db:'postgres',role:'postgres',port:5432,tls:true,rolsuper:false,rolcreaterole:true,rolbypassrls:true},'Managed operator identity');
  const before=await managedSnapshot(db);
  const exists=(await db.query("SELECT to_regclass('hosted_practice.identity') IS NOT NULL AS present")).rows[0].present;
  if(exists){
   const {rows:[record]}=await db.query('SELECT instance_id::text,project_id::text,environment_id::text,service_id::text,supabase_project_ref,supabase_organization_id,database_host,baseline_sha256,isolation_sha256,schema_sha256 FROM hosted_practice.identity');
   assert.deepEqual(record,{instance_id:profile.instanceId,project_id:profile.projectId,environment_id:profile.environmentId,service_id:profile.serviceId,
    supabase_project_ref:profile.supabaseProjectRef,supabase_organization_id:profile.supabaseOrganizationId,database_host:profile.databaseHost,
    baseline_sha256:profile.baselineSha256,isolation_sha256:profile.isolationSha256,schema_sha256:manifest.hosted.sha256},'Existing provider binding');
   const ledger=(await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version')).rows;
   assert.deepEqual(ledger,manifest.learning.map(({version,sha256})=>({version,sha256})),'Existing applied SQL ledger');
  }else{
   const namespaces=(await db.query('SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])',[manifest.appSchemas])).rows;
   assert.equal(namespaces.length,0,'All seven application namespaces must be absent');
   assert.equal((await db.query("SELECT rolname FROM pg_roles WHERE rolname='epdg_synthetic_app'")).rows.length,0,'Never repurpose an existing login');
   await db.query("SELECT set_config('epdg.bootstrap_app_password',$1,true)",[secrets.appPassword]);
   await db.query("DO $$ BEGIN EXECUTE format('CREATE ROLE epdg_synthetic_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',current_setting('epdg.bootstrap_app_password')); END $$");
   await db.query(baseline);
   await db.query('INSERT INTO synthetic_meta.identity(instance_id,provider,supabase_project_ref,baseline_sha256,isolation_sha256) VALUES($1,$2,$3,$4,$5)',
    [profile.instanceId,'supabase',profile.supabaseProjectRef,profile.baselineSha256,profile.isolationSha256]);
   await db.query(security);await db.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',[manifest.security.version,manifest.security.sha256]);
   for(const m of learning){await db.query(m.sql);await db.query('INSERT INTO synthetic_learning.schema_migrations(version,sha256) VALUES($1,$2)',[m.version,m.sha256]);}
   await db.query(hosted);
   await db.query('INSERT INTO hosted_practice.identity(instance_id,project_id,environment_id,service_id,supabase_project_ref,supabase_organization_id,database_host,baseline_sha256,isolation_sha256,schema_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [profile.instanceId,profile.projectId,profile.environmentId,profile.serviceId,profile.supabaseProjectRef,profile.supabaseOrganizationId,profile.databaseHost,profile.baselineSha256,profile.isolationSha256,manifest.hosted.sha256]);
   await seed(db,secrets.fixturePassword);added=true;
  }
  assert.deepEqual(await managedSnapshot(db),before,'Managed schemas, objects, global defaults and database ACLs are preserved');
  await db.query('COMMIT');
  const runtime=new ClientCtor({...connection(secrets.appPassword),user:profile.databaseLoginUser});await runtime.connect();
  try{
   await checkSupabaseIdentity(runtime,profile);await checkHostedAccessContract(runtime,profile);
   const users=(await runtime.query('SELECT email,name,password FROM core.users ORDER BY email')).rows;
   assert.deepEqual(users.map(u=>u.email),['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid']);
   for(const user of users){assert.ok(user.name.startsWith('SYNTHETIC '));assert.ok(await bcrypt.compare(secrets.fixturePassword,user.password),'Existing fictional passwords are never reset');}
  }finally{await runtime.end();}
  return {at:new Date().toISOString(),environment:'synthetic-hosted',databaseProvider:'supabase',appliedFreshSchema:added,
   previousRowsOverwritten:false,syntheticAccounts:4,appTables:manifest.appTables,privilegedControlsAvailable:false,
   managedObjectsPreserved:true,tlsVerified:true,runtimeBypassRls:false,externalMail:false,realRecordsCopied:false};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await db.end();}
}
module.exports={bootstrap,environment,managedSnapshot};
if(require.main===module)bootstrap().then(value=>console.log(JSON.stringify(value))).catch(()=>{
 console.error('Supabase synthetic operator job failed its provider, isolation or preservation gate; no credentials logged.');process.exitCode=1;
});
