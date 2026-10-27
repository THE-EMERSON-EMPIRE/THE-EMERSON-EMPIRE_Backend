'use strict';
// Explicit operator JOB only. Never imported or called by application startup.
// Applies reviewed schema definitions to a verified empty, separate database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const bcrypt=require('bcrypt');
const core=path.resolve(__dirname,'../..');
const operator=require('../../../scripts/hosted-practice/operator-profile.json');
const profile=require('../../src/hosted-practice/profile.json');
const security=require('../../src/security/schema-manifest.json');
const learning=require('../../src/learning/schema-manifest.json');
const hosted=require('../../src/hosted-practice/schema-manifest.json');
const fixtures=require('../local-synthetic/learning-fixtures.cjs');
const F=require('../local-synthetic/handoff-fixtures.cjs');
const {normalizeHostedPracticeCa}=require('../../dist/hosted-practice/tls.js');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=()=>{throw new Error('Hosted bootstrap identity or reviewed source is unavailable');};
function reviewed(directory,m){
 const sql=fs.readFileSync(path.join(core,directory,m.file),'utf8');
 assert.match(m.sha256,/^[a-f0-9]{64}$/);assert.equal(hash(sql),m.sha256,'Reviewed migration checksum');return sql;
}
function environment(env=process.env){
 const exact={EPDG_HOSTED_PRACTICE_BOOTSTRAP:'1',RAILWAY_PROJECT_ID:operator.projectId,
  RAILWAY_ENVIRONMENT_ID:operator.environmentId,RAILWAY_SERVICE_ID:operator.bootstrapServiceId};
 if(operator.version!==1||Object.entries(exact).some(([key,value])=>env[key]!==value))fail();
 for(const key of ['EPDG_SYNTHETIC_MODE','EPDG_HOSTED_PRACTICE_MODE','DATABASE_URL','DB_PASSWORD','RESEND_API_KEY','SUPABASE_SERVICE_ROLE_KEY','SMTP_PASSWORD'])if(env[key])fail();
 const secret=name=>{const value=env[name];if(typeof value!=='string'||value.length<32)fail();return value;};
 const ca=normalizeHostedPracticeCa(env.HOSTED_PRACTICE_DB_CA_CERT);
 if(profile.projectId!==operator.projectId||profile.environmentId!==operator.environmentId||profile.serviceId!==operator.appServiceId||
  profile.databaseServiceId!==operator.databaseServiceId||profile.databaseHost!==operator.databaseHost||profile.databaseName!==operator.databaseName||
  operator.databasePort!==5432||profile.databasePort!==5432||profile.isolationSha256!==hosted.sha256||
  ![operator.projectId,operator.environmentId,operator.bootstrapServiceId,operator.appServiceId,operator.databaseServiceId,profile.instanceId].every(v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v??'')))fail();
 const adminPassword=secret('EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD'),appPassword=secret('HOSTED_PRACTICE_APP_PASSWORD'),fixturePassword=secret('HOSTED_PRACTICE_FIXTURE_PASSWORD');
 if(Buffer.byteLength(fixturePassword,'utf8')>72)fail();
 if(new Set([adminPassword,appPassword,fixturePassword]).size!==3)fail();
 return {adminPassword,appPassword,fixturePassword,ca};
}
async function seed(db,password){
 const {createDualWriteUser}=require('../../dist/utils/coreIdentity.js');
 const encoded=await bcrypt.hash(password,12),users={};
 await db.query("INSERT INTO core.branches(code,name) VALUES('epdg','EPDG Hosted Synthetic Practice')");
 for(const suffix of ['a','b']){
  const schoolUser=await createDualWriteUser(db,{email:`school-${suffix}@epdg.invalid`,name:`SYNTHETIC Institution ${suffix.toUpperCase()}`,hashedPassword:encoded,role:'school',isVerified:true});
  const {rows:[school]}=await db.query('INSERT INTO epdg.schools(user_id,school_name,email,is_approved,is_verified) VALUES($1,$2,$3,true,true) RETURNING id',
   [schoolUser.id,`SYNTHETIC Institution ${suffix.toUpperCase()}`,`school-${suffix}@epdg.invalid`]);
  const learner=await createDualWriteUser(db,{email:`learner-${suffix}@epdg.invalid`,name:`SYNTHETIC Learner ${suffix.toUpperCase()}`,hashedPassword:encoded,role:'intern',isVerified:true});
  await db.query('INSERT INTO epdg.intern_profiles(user_id,school_id,is_approved) VALUES($1,$2,true)',[learner.id,school.id]);
  users[`school-${suffix}@epdg.invalid`]={...schoolUser,schoolId:school.id};users[`learner-${suffix}@epdg.invalid`]={...learner,schoolId:school.id};
  for(const user of [schoolUser,learner]){
   await db.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)',[user.id]);
   const {rows:[membership]}=await db.query('INSERT INTO portal_security.memberships(user_id,school_id,active) VALUES($1,$2,true) RETURNING id',[user.id,school.id]);
   users[user.email??(user.id===learner.id?`learner-${suffix}@epdg.invalid`:`school-${suffix}@epdg.invalid`)].membershipId=membership.id;
  }
 }
 const programs=[...fixtures.programs,{id:F.programId,enrollmentId:F.enrollmentId,learner:F.learnerEmail,school:F.mentorEmail,title:F.title,summary:F.summary,
  items:F.items,resource:F.resource,startsAt:F.startsAt,endsAt:F.endsAt}];
 for(const [index,program]of programs.entries()){
  const learner=users[program.learner],mentor=users[program.school],starts=program.startsAt??'2026-10-27T00:00:00.000Z',ends=program.endsAt??'2026-11-10T00:00:00.000Z';
  await db.query('INSERT INTO synthetic_learning.programs(id,school_id,title,summary,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',[program.id,learner.schoolId,program.title,program.summary,starts,ends]);
  await db.query('INSERT INTO synthetic_learning.enrollments(id,program_id,user_id,school_id,membership_id,active) VALUES($1,$2,$3,$4,$5,true)',[program.enrollmentId,program.id,learner.id,learner.schoolId,learner.membershipId]);
  for(const [position,item]of program.items.entries())await db.query('INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [item.id,program.id,position+1,item.title,item.kind,item.description,item.content,new Date(Date.parse(starts)+item.day*86400000)]);
  const r=program.resource;await db.query('INSERT INTO synthetic_learning.resources(id,program_id,title,description,body) VALUES($1,$2,$3,$4,$5)',[r.id,program.id,r.title,r.description,r.body]);
  if(program.feedback){const f=program.feedback;await db.query('INSERT INTO synthetic_learning.feedback(id,enrollment_id,title,comment,mentor_label) VALUES($1,$2,$3,$4,$5)',[f.id,program.enrollmentId,f.title,f.comment,f.mentorLabel]);}
  await db.query('INSERT INTO synthetic_learning.mentor_assignments(id,mentor_user_id,membership_id,enrollment_id,school_id,active,mentor_label) VALUES($1,$2,$3,$4,$5,true,$6)',
   [program.id===F.programId?F.mentorAssignmentId:fixtures.id('6',index+1),mentor.id,mentor.membershipId,program.enrollmentId,learner.schoolId,program.school==='school-a@epdg.invalid'?'SYNTHETIC Mentor A':'SYNTHETIC Mentor B']);
 }
 await db.query('INSERT INTO synthetic_handoff.mappings(id,person_id,application_id,crm_program_id,reviewer_id,user_id,enrollment_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [F.mappingId,F.personId,F.applicationId,F.crmProgramId,F.reviewerId,users[F.learnerEmail].id,F.enrollmentId]);
}
async function bootstrap(){
 const secrets=environment();const baseline=fs.readFileSync(path.join(core,'scripts/local-synthetic/baseline.sql'),'utf8');
 assert.equal(hash(baseline),profile.baselineSha256);
 const sqlSecurity=reviewed('security-migrations',security),sqlLearning=[learning,...learning.extensions].map(m=>({...m,sql:reviewed('learning-migrations',m)})),sqlHosted=reviewed('hosted-practice-migrations',hosted);
 const migrationPolicy=require('../local-synthetic/learning-migration-policy.cjs');
 const {validateNonDestructiveMigrationSql}=require('../../dist/db/migrationSafety.js');
 validateNonDestructiveMigrationSql(security.file,sqlSecurity);validateNonDestructiveMigrationSql(hosted.file,sqlHosted);
 for(const m of sqlLearning)migrationPolicy.validate(m.file,m.sql);
 const db=new Client({host:operator.databaseHost,port:operator.databasePort,database:operator.databaseName,user:'postgres',password:secrets.adminPassword,
  ssl:{ca:secrets.ca,rejectUnauthorized:true,servername:operator.databaseHost},connectionTimeoutMillis:10000,statement_timeout:30000});
 await db.connect();let added=false;
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-hosted-practice-bootstrap-v1',0))");
  const {rows:[identity]}=await db.query("SELECT current_database() AS db,current_user AS role,inet_server_port() AS port,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls");
  assert.deepEqual(identity,{db:'epdg_synthetic',role:'postgres',port:5432,tls:true});
  const exists=(await db.query("SELECT to_regclass('hosted_practice.identity') IS NOT NULL AS present")).rows[0].present;
  if(exists){
   const {rows:[record]}=await db.query('SELECT instance_id::text,project_id::text,environment_id::text,service_id::text,database_service_id::text,database_host,baseline_sha256,isolation_sha256,schema_sha256 FROM hosted_practice.identity');
   assert.deepEqual(record,{instance_id:profile.instanceId,project_id:operator.projectId,environment_id:operator.environmentId,service_id:operator.appServiceId,database_service_id:operator.databaseServiceId,
    database_host:operator.databaseHost,baseline_sha256:profile.baselineSha256,isolation_sha256:profile.isolationSha256,schema_sha256:hosted.sha256});
   const ledger=(await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version')).rows;
   assert.deepEqual(ledger,[learning,...learning.extensions].map(({version,sha256})=>({version,sha256})));
  }else{
   const {rows:[empty]}=await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'");
   assert.equal(empty.n,0,'Only a brand-new empty database may be bootstrapped');
   const roles=(await db.query("SELECT rolname FROM pg_roles WHERE rolname IN ('epdg_synthetic_operator','epdg_synthetic_app')")).rows;assert.equal(roles.length,0,'Never repurpose pre-existing roles');
   await db.query('CREATE ROLE epdg_synthetic_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT');
   await db.query("SELECT set_config('epdg.bootstrap_app_password',$1,true)",[secrets.appPassword]);
   await db.query("DO $$ BEGIN EXECUTE format('CREATE ROLE epdg_synthetic_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',current_setting('epdg.bootstrap_app_password')); END $$");
   await db.query('ALTER DATABASE epdg_synthetic OWNER TO epdg_synthetic_operator');
   await db.query('REVOKE ALL ON DATABASE epdg_synthetic FROM PUBLIC; GRANT CONNECT ON DATABASE epdg_synthetic TO epdg_synthetic_app');
   await db.query('SET LOCAL ROLE epdg_synthetic_operator');
   await db.query(baseline);
   const {rows:[tables]}=await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('core','epdg','public','private')");assert.equal(tables.n,50);
   await db.query('CREATE SCHEMA synthetic_meta; REVOKE ALL ON SCHEMA synthetic_meta FROM PUBLIC; CREATE TABLE synthetic_meta.identity(instance_id uuid PRIMARY KEY,baseline_sha256 text NOT NULL,isolation_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())');
   await db.query('INSERT INTO synthetic_meta.identity(instance_id,baseline_sha256,isolation_sha256) VALUES($1,$2,$3)',[profile.instanceId,profile.baselineSha256,profile.isolationSha256]);
   await db.query(sqlSecurity);await db.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',[security.version,security.sha256]);
   for(const m of sqlLearning){await db.query(m.sql);await db.query('INSERT INTO synthetic_learning.schema_migrations(version,sha256) VALUES($1,$2)',[m.version,m.sha256]);}
   await db.query(sqlHosted);
   await db.query('INSERT INTO hosted_practice.identity(instance_id,project_id,environment_id,service_id,database_service_id,database_host,baseline_sha256,isolation_sha256,schema_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [profile.instanceId,operator.projectId,operator.environmentId,operator.appServiceId,operator.databaseServiceId,operator.databaseHost,profile.baselineSha256,profile.isolationSha256,hosted.sha256]);
   await seed(db,secrets.fixturePassword);added=true;
  }
  await db.query('COMMIT');
  const runtime=new Client({host:operator.databaseHost,port:5432,database:operator.databaseName,user:'epdg_synthetic_app',password:secrets.appPassword,
   ssl:{ca:secrets.ca,rejectUnauthorized:true,servername:operator.databaseHost},connectionTimeoutMillis:10000});
  await runtime.connect();try{
   const role=(await runtime.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,(SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships FROM pg_roles r WHERE rolname=current_user")).rows[0];
   assert.deepEqual(role,{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,memberships:0});
   const users=(await runtime.query('SELECT email,name,password FROM core.users ORDER BY email')).rows;
   assert.deepEqual(users.map(u=>u.email),['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid']);
   for(const user of users){assert.ok(user.name.startsWith('SYNTHETIC '));assert.ok(await bcrypt.compare(secrets.fixturePassword,user.password),'Existing fixture credentials are retained, never reset');}
  }finally{await runtime.end();}
  return {at:new Date().toISOString(),environment:'synthetic-hosted',appliedFreshSchema:added,previousRowsOverwritten:false,syntheticAccounts:4,
   programMappings:4,crmManagedMappings:1,...(added?{initialSeedStatus:'not_received'}:{}),privilegedControlsAvailable:false,tlsVerified:true,runtimeBypassRls:false,externalMail:false,realRecordsCopied:false};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await db.end();}
}
module.exports={bootstrap,environment};
if(require.main===module)bootstrap().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Hosted practice operator job failed its isolated identity, schema or preservation gate; no credentials logged.');process.exitCode=1;});
