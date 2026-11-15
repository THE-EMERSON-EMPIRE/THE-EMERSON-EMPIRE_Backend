'use strict';
// New disposable loopback cluster; never attaches to an existing database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const net=require('node:net'),{spawnSync}=require('node:child_process');
const {Client}=require('pg');
const core=path.resolve(__dirname,'../..'),backend=path.dirname(core),workspace=path.resolve(backend,'../..');
const manifest=require('../../src/security/access-schema-manifest.json');
const sql=fs.readFileSync(path.join(core,'access-migrations',manifest.file),'utf8');
const roles=['founder_owner','organization_admin','hr_admin','technical_maintainer','program_coordinator','intern_team_lead','content_editor','sales_staff','global_outreach','restricted_viewer','participant'];
const secret=()=>crypto.randomBytes(32).toString('base64url');
async function verify(){
 assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),manifest.sha256);
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(55435,'127.0.0.1',()=>server.close(resolve));});
 const directory=path.join(backend,'.local-synthetic','scoped-access-'+Date.now());fs.mkdirSync(directory,{recursive:true});
 const pgBin=path.join(workspace,'.tools/postgresql-17.11/pgsql/bin'),exe=name=>path.join(pgBin,name+(process.platform==='win32'?'.exe':''));
 const run=(name,args)=>{const result=spawnSync(exe(name),args,{windowsHide:true,stdio:'ignore',timeout:60000});if(result.status!==0)throw new Error('Disposable PostgreSQL operation failed: '+name);};
 const operatorPassword=secret(),pw=path.join(directory,'init-password');fs.writeFileSync(pw,operatorPassword,{mode:0o600});
 run('initdb',['-D',path.join(directory,'pgdata'),'-U','epdg_access_operator','--pwfile',pw,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);fs.unlinkSync(pw);
 run('pg_ctl',['-D',path.join(directory,'pgdata'),'-l',path.join(directory,'postgres.log'),'-o','-h 127.0.0.1 -p 55435','-w','start']);
 const base={host:'127.0.0.1',port:55435,connectionTimeoutMillis:5000};
 const operator=new Client({...base,database:'postgres',user:'epdg_access_operator',password:operatorPassword});await operator.connect();
 const suffix=Date.now().toString(36),database='epdg_access_'+suffix,migrator='access_migrator_'+suffix,runtime='access_runtime_'+suffix;
 const mp=secret(),rp=secret();let db,app;let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++;};
 try{
  const identity=(await operator.query("SELECT current_user='epdg_access_operator' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55435 AS allowed")).rows[0];check(identity.allowed===true,'Local operator boundary');
  await operator.query(`CREATE ROLE ${migrator} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${mp}'`);
  await operator.query(`CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${rp}'`);
  await operator.query('CREATE ROLE epdg_synthetic_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
  await operator.query(`CREATE DATABASE ${database} OWNER ${migrator}`);
  db=new Client({...base,database,user:migrator,password:mp});await db.connect();
  await db.query(fs.readFileSync(path.join(__dirname,'baseline.sql'),'utf8'));
  for(const folder of ['security-migrations','admin-migrations'])await db.query(fs.readFileSync(path.join(core,folder,fs.readdirSync(path.join(core,folder))[0]),'utf8'));
  await db.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE ${database} FROM PUBLIC`);
  const apply=async()=>{await db.query('BEGIN');try{await db.query("SELECT set_config('epdg.access_runtime_role',$1,true),set_config('epdg.access_migrator_role',$2,true)",[runtime,migrator]);await db.query(sql);await db.query('INSERT INTO portal_access.schema_migrations(version,sha256) VALUES($1,$2) ON CONFLICT(version) DO NOTHING',[manifest.version,manifest.sha256]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}};
  // Simulate legacy broad runtime grants and column grants; migration must remove them.
  await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA core,epdg TO ${runtime}; GRANT UPDATE(active) ON portal_security.account_states TO ${runtime}`);
  await apply();await apply();check(true,'Migration replay succeeds');
  const accountManifest=require('../../src/security/account-schema-manifest.json');
  const accountSql=fs.readFileSync(path.join(core,'account-migrations',accountManifest.file),'utf8');
  assert.equal(crypto.createHash('sha256').update(accountSql).digest('hex'),accountManifest.sha256);
  await db.query('BEGIN');await db.query("SELECT set_config('epdg.access_runtime_role',$1,true),set_config('epdg.access_migrator_role',$2,true)",[runtime,migrator]);
  await db.query(accountSql);await db.query('COMMIT');
  await db.query("INSERT INTO core.branches(id,code,name) VALUES(1,'epdg','SYNTHETIC scope tests')");
  for(let id=1;id<=20;id++){
   const email=`role-${id}@epdg.invalid`,name=`SYNTHETIC role ${id}`;
   await db.query('INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,$3,$4,true)',[id,email,name,'synthetic-password-placeholder']);
   await db.query("INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES($1,$2,$3,$4,'intern',true)",[id,email,name,'synthetic-password-placeholder']);
   await db.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,1,'intern')",[id]);
   await db.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)',[id]);
  }
  for(const [id,user] of [[1,18],[2,19]])await db.query("INSERT INTO epdg.companies(id,user_id,company_name,email,is_approved,is_verified) VALUES($1,$2,'SYNTHETIC organization','organization@epdg.invalid',true,true)",[id,user]);
  for(let id=1;id<=20;id++)await db.query('INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES($1,$2,true)',[id,id===20?2:1]);
  const ga=crypto.randomUUID(),gb=crypto.randomUUID(),gc=crypto.randomUUID();
  for(const [id,org] of [[ga,1],[gb,1],[gc,2]])await db.query("INSERT INTO portal_access.groups(id,organization_id,kind,name) VALUES($1,$2,'cohort','SYNTHETIC approved cohort')",[id,org]);
  const ids={};
  for(const kind of ['learning','assignment','portfolio','feedback','progress','team','curriculum','education_handoff','technical_diagnostic','content','commercial','outreach','operational_setting']){
   ids[kind]=crypto.randomUUID();await db.query("INSERT INTO portal_access.resources(id,organization_id,kind,group_id,subject_user_id,title,body,status) VALUES($1,1,$2,$3,$4,'SYNTHETIC resource','SYNTHETIC body',$5)",[ids[kind],kind,ga,['progress','education_handoff','feedback'].includes(kind)?12:null,kind==='learning'?'published':'draft']);
  }
  for(const [label,org,group,subject,founder] of [['other_group',1,gb,12,false],['foreign',2,gc,20,false],['own',1,ga,11,false],['lead_own',1,ga,6,false],['founder',1,ga,null,true]]){
   ids[label]=crypto.randomUUID();await db.query("INSERT INTO portal_access.resources(id,organization_id,kind,group_id,subject_user_id,title,founder_only) VALUES($1,$2,'progress',$3,$4,'SYNTHETIC scoped progress',$5)",[ids[label],org,group,subject,founder]);
  }
  const owner=(await db.query("INSERT INTO portal_security.role_assignments(user_id,role_code,status) VALUES(1,'founder_owner','active') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO portal_access.scopes(assignment_id,organization_id,scope_type,scope_id,approved_by_user_id,approval_reference) VALUES($1,1,'organization','1',1,'SYNTHETIC offline founder bootstrap')",[owner]);
  app=new Client({...base,database,user:runtime,password:rp});await app.connect();
  const grant=(target,role,type,id,actor=1)=>app.query('SELECT portal_access.grant_role($1,$2,$3,$4,$5,$6) AS id',[actor,target,role,type,String(id),'SYNTHETIC authenticated founder approval']);
  for(const [user,type,id] of [[2,'organization',1],[3,'organization',1],[4,'resource',ids.technical_diagnostic],[5,'group',ga],[6,'group',ga],[7,'group',ga],[8,'resource',ids.commercial],[9,'resource',ids.outreach],[10,'resource',ids.commercial],[11,'group',ga]])await grant(user,roles[user-1],type,id);
  await grant(6,'intern_team_lead','self','6');await grant(11,'participant','self','11');
  const same=(await grant(11,'participant','self','11')).rows[0].id;check(typeof same==='string','Repeated approval is idempotent');
  // Reproduce the session lock order used by PortalService. Two requests hold
  // the actor SHARE lock; one waits for its session while the other grants.
  const sid=(await db.query("INSERT INTO portal_security.sessions(user_id,token_hash,credential_version,account_revision,membership_fingerprint,expires_at) SELECT 1,$1,$2,revision,$3,clock_timestamp()+interval '1 hour' FROM portal_security.account_states WHERE user_id=1 RETURNING id",['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)])).rows[0].id;
  const parallel=new Client({...base,database,user:runtime,password:rp});await parallel.connect();
  try{
   await app.query('BEGIN');await app.query('SET LOCAL statement_timeout=3000');await app.query('SELECT user_id FROM portal_security.account_states WHERE user_id=1 FOR SHARE');await app.query('SELECT id FROM portal_security.sessions WHERE id=$1 FOR UPDATE',[sid]);
   await parallel.query('BEGIN');await parallel.query('SET LOCAL statement_timeout=3000');await parallel.query('SELECT user_id FROM portal_security.account_states WHERE user_id=1 FOR SHARE');
   const waiting=parallel.query('SELECT id FROM portal_security.sessions WHERE id=$1 FOR UPDATE',[sid]);
   const first=(await grant(17,'participant','self','17')).rows[0].id;await app.query('COMMIT');await waiting;
   const second=(await parallel.query('SELECT portal_access.grant_role(1,17,$1,$2,$3,$4) AS id',['participant','self','17','SYNTHETIC second approved plan'])).rows[0].id;await parallel.query('COMMIT');
   check(first===second,'Concurrent same-session grants avoid actor lock upgrade and remain idempotent');
   check((await db.query("SELECT count(*)::int AS n FROM portal_access.events WHERE target_user_id=17 AND event='role_granted'")).rows[0].n===1,'Repeated approved plan retains original role audit');
  }finally{await app.query('ROLLBACK');await parallel.query('ROLLBACK');await parallel.end();}
  const can=async(actor,permission,id,type='resource')=>(await app.query('SELECT portal_access.has_permission($1,$2,$3,$4) AS allowed',[actor,permission,type,String(id)])).rows[0].allowed;
  const joined=(await app.query('SELECT c.id FROM core.users c JOIN epdg.users e ON e.id=c.id JOIN core.user_branch_roles b ON b.user_id=c.id JOIN portal_security.account_states st ON st.user_id=c.id WHERE c.id=1')).rows;
  check(joined.length===1,'NOBYPASSRLS runtime reads actual mirrored authentication join');
  check((await app.query('SELECT id FROM epdg.companies WHERE id=1')).rows.length===1,'Runtime reads approved company under existing RLS');
  await app.query('BEGIN');
  check((await app.query("UPDATE epdg.users SET password=password WHERE id=1")).rowCount===1,'Runtime password column update passes existing RLS');
  await app.query('ROLLBACK');
  const visibleOrganizations=(await app.query('SELECT portal_access.visible_organizations(11) AS items')).rows[0].items;
  check(visibleOrganizations.length===1&&visibleOrganizations[0].id===1&&visibleOrganizations[0].name==='SYNTHETIC organization','Company labels are actual approved scoped organizations');
  check((await app.query('SELECT portal_access.visible_organizations(19) AS items')).rows[0].items.length===0,'Unassigned identity sees no organization labels');
  const matrix=[['founder_owner',ids.founder,'resource.read'],['organization_admin',ids.operational_setting,'resource.edit'],['hr_admin',ids.education_handoff,'resource.edit'],['technical_maintainer',ids.technical_diagnostic,'technical.diagnostics'],['program_coordinator',ids.curriculum,'resource.edit'],['intern_team_lead',ids.progress,'resource.review'],['content_editor',ids.content,'resource.edit'],['sales_staff',ids.commercial,'resource.edit'],['global_outreach',ids.outreach,'resource.edit'],['restricted_viewer',ids.commercial,'resource.read'],['participant',ids.own,'resource.read']];
  for(let i=0;i<matrix.length;i++){
   const [role,id,permission]=matrix[i];check(await can(i+1,permission,id),`${role} allowed assigned action`);
   check(!await can(i+1,'resource.read',ids.foreign),`${role} denies other organization`);
   check(await can(i+1,'account.self.read',i+1,'user')&&await can(i+1,'account.self.update',i+1,'user'),`${role} can access its own profile independent of work scope`);
   check(!await can(i+1,'account.self.update',i===0?2:1,'user'),`${role} cannot use self profile permission on another identity`);
   const visible=(await app.query('SELECT id::text FROM portal_access.read_resources($1)',[i+1])).rows.map(row=>row.id);
   check(visible.includes(id)&&!visible.includes(ids.foreign),`${role} SQL read filters rows`);
   await assert.rejects(()=>grant(i+1,'founder_owner','organization','1',i+1),/Approved role assignment/);checks++;
   if(i>0){await assert.rejects(()=>grant(17,'founder_owner','organization','1',i+1),/Founder approval/);checks++;}
  }
  const denials=[[2,'resource.read',ids.founder],[3,'resource.read',ids.commercial],[4,'resource.read',ids.progress],[5,'resource.read',ids.other_group],[6,'resource.read',ids.other_group],[7,'resource.publish',ids.content],[8,'resource.read',ids.outreach],[9,'resource.read',ids.commercial],[10,'resource.edit',ids.commercial],[11,'resource.read',ids.progress]];
  for(const row of denials)check(!await can(...row),'Role-specific denial');
  for(let actor=1;actor<=11;actor++)for(const [permission,allowed] of [['learning.review',[1,2,5,6]],['learning.enroll',[1,2,5]],['learning.curriculum',[1,2,5,7]],['learning.participate',[6,11]]]){
   check(await can(actor,permission,ga,'group')===allowed.includes(actor),'Learning verb allowed only for specified role');
   check(await can(actor,permission,gb,'group')===(allowed.includes(actor)&&[1,2].includes(actor)),'Learning group scope prevents cross-cohort action');
  }
  check(!await can(2,'admin.accounts.approve',1,'organization'),'Org administrator cannot approve privileges');
  check(!await can(3,'admin.accounts.manage_staff',1,'organization'),'HR cannot manage staff');
  check(!await can(3,'admin.accounts.read',2,'user'),'HR cannot inspect administrator account');
  check(await can(11,'account.self.read',11,'self')&&!await can(11,'account.self.read',12,'user'),'Self account cannot cross users');
  for(const query of ['SELECT * FROM portal_access.resources','UPDATE portal_security.account_states SET active=true WHERE user_id=11',"INSERT INTO portal_security.role_assignments(user_id,role_code) VALUES(11,'founder_owner')","UPDATE portal_access.scopes SET active=true","DELETE FROM portal_access.events","UPDATE core.users SET name='forged' WHERE id=11","DELETE FROM epdg.users WHERE id=11","INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES(11,1,'admin')"]){await assert.rejects(()=>app.query(query),/permission denied/);checks++;}
  const secure=(await app.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];check(Object.values(secure).every(value=>value===false),'Runtime no bypass/administrative role');
  const revision=(await app.query('SELECT portal_access.write_resource(7,$1,1,$2) AS revision',[ids.content,'SYNTHETIC revised draft'])).rows[0].revision;check(Number(revision)===2,'Content editor writes draft');
  await assert.rejects(()=>app.query('SELECT portal_access.write_resource(7,$1,1,$2)',[ids.content,'stale']),/Resource change unavailable/);checks++;
  await assert.rejects(()=>app.query('SELECT portal_access.publish_resource(7,$1,2)',[ids.content]),/Publication unavailable/);checks++;
  await app.query('SELECT portal_access.review_resource(5,$1,$2)',[ids.curriculum,'SYNTHETIC scoped review']);checks++;
  await app.query('SELECT portal_access.publish_resource(1,$1,2)',[ids.content]);check(true,'Owner publishes within approved organization');
  await assert.rejects(()=>app.query('SELECT portal_access.write_resource(7,$1,3,$2)',[ids.content,'published edit']),/Resource change unavailable/);checks++;
  const scope=(await db.query("SELECT s.id FROM portal_access.scopes s JOIN portal_security.role_assignments a ON a.id=s.assignment_id WHERE a.user_id=10")).rows[0].id;
  const oldRevision=(await db.query('SELECT revision FROM portal_security.account_states WHERE user_id=10')).rows[0].revision;
  await app.query('SELECT portal_access.revoke_scope(1,$1,$2)',[scope,'SYNTHETIC founder removal']);check(!await can(10,'resource.read',ids.commercial),'Revoked scope immediately denies');
  check((await db.query('SELECT revision FROM portal_security.account_states WHERE user_id=10')).rows[0].revision!==oldRevision,'Revocation advances session-bound account revision');
  await db.query('UPDATE portal_security.memberships SET active=false WHERE user_id=8');check(!await can(8,'resource.read',ids.commercial),'Withdrawn organization membership denies');
  await db.query('UPDATE portal_access.group_memberships SET active=false WHERE user_id=5');check(!await can(5,'resource.read',ids.curriculum),'Withdrawn group membership denies');
  check((await app.query('SELECT portal_access.snapshot(5) AS assignments')).rows[0].assignments.length===0,'Withdrawn group membership changes session-bound snapshot');
  const before=(await db.query('SELECT count(*)::int AS n FROM core.users')).rows[0].n;await apply();check((await db.query('SELECT count(*)::int AS n FROM core.users')).rows[0].n===before,'Migration replay preserves all identity history');
  await db.query('BEGIN');await db.query("SELECT set_config('epdg.access_runtime_role',$1,true),set_config('epdg.access_migrator_role',$2,true)",[runtime,migrator]);await db.query(sql);await db.query('ROLLBACK');check((await db.query('SELECT count(*)::int AS n FROM core.users')).rows[0].n===before,'Failed transaction compensates without data loss');
  const roleChecks=checks;
  await db.query("INSERT INTO portal_accounts.release_control(target_id,approval_ref,enabled,mail_enabled,batch_approval_ref,bound_database,bound_runtime_role,synthetic_only) VALUES('SYNTHETIC-target','SYNTHETIC-release',true,true,'SYNTHETIC-batch',$1,$2,true)",[database,runtime]);
  await db.query('UPDATE portal_security.account_states SET active=false WHERE user_id=16');
  const planRoles=JSON.stringify([{role_code:'participant',scope_type:'self',scope_id:'self'}]);
  for(const bad of [[{x:'participant',y:'self',z:'self'}],[{role_code:null,scope_type:'self',scope_id:'self'}],[{role_code:'participant',scope_type:'user',scope_id:'16'}],[{role_code:'technical_maintainer',scope_type:'resource',scope_id:ids.foreign}]]){
   await assert.rejects(()=>app.query('SELECT portal_accounts.propose(3,1,$1,$2,$3::jsonb)',['role-16@epdg.invalid','SYNTHETIC target',JSON.stringify(bad)]),/Invalid role scope/);checks++;
  }
  let plan=(await app.query('SELECT portal_accounts.propose(3,1,$1,$2,$3::jsonb) AS plan',['role-16@epdg.invalid','SYNTHETIC target',planRoles])).rows[0].plan;
  await assert.rejects(()=>app.query("SELECT portal_accounts.review_plan(3,$1,NULL,'verify_onboarding','SYNTHETIC/CRM-record')",[plan.id]),/Plan changed/);checks++;
  plan=(await app.query("SELECT portal_accounts.review_plan(3,$1,$2,'verify_onboarding','SYNTHETIC/CRM-record') AS plan",[plan.id,plan.revision])).rows[0].plan;
  const hrView=(await app.query('SELECT portal_accounts.management_snapshot(3) AS data')).rows[0].data;
  check(!hrView.plans[0].allowed_actions.includes('approve'),'HR approval action accurately unavailable');
  plan=(await app.query("SELECT portal_accounts.review_plan(1,$1,$2,'approve',NULL) AS plan",[plan.id,plan.revision])).rows[0].plan;
  await assert.rejects(()=>app.query('SELECT portal_accounts.provision(3,$1,NULL,NULL)',[plan.id]),/current founder-approved/);checks++;
  await app.query('SELECT portal_accounts.provision(3,$1,$2,NULL)',[plan.id,plan.revision]);checks++;
  const invitation=(await app.query('SELECT portal_accounts.prepare_invitation(3,16) AS invitation')).rows[0].invitation;
  await app.query('SELECT portal_accounts.dispatch(3,$1,$2,false)',[invitation.id,'d'.repeat(64)]);
  const reused=(await app.query('SELECT portal_accounts.prepare_invitation(3,16) AS invitation')).rows[0].invitation;
  check(!('token_hash' in reused)&&!('credential_hash' in reused),'Reused invitation API omits private hashes');
  const accept=async()=>(await app.query('SELECT portal_accounts.accept_invitation($1,$2) AS accepted',['d'.repeat(64),'$2b$12$'+'a'.repeat(53)])).rows[0].accepted;
  await db.query('UPDATE portal_security.memberships SET active=false WHERE user_id=16');check(!await accept(),'Acceptance denies withdrawn company membership');await db.query('UPDATE portal_security.memberships SET active=true WHERE user_id=16');
  await db.query('UPDATE portal_security.account_states SET active=false WHERE user_id=1');check(!await accept(),'Acceptance denies withdrawn founder approval authority');await db.query('UPDATE portal_security.account_states SET active=true WHERE user_id=1');
  await db.query('UPDATE portal_access.scopes SET active=false WHERE assignment_id IN(SELECT id FROM portal_security.role_assignments WHERE user_id=16)');check(!await accept(),'Acceptance denies missing exact approved scope');await db.query('UPDATE portal_access.scopes SET active=true WHERE assignment_id IN(SELECT id FROM portal_security.role_assignments WHERE user_id=16)');
  await grant(16,'founder_owner','organization','1');
  for(const actor of [2,3]){await assert.rejects(()=>app.query("SELECT portal_accounts.disable($1,16,'access_review')",[actor]),/Disable permission/);checks++;await assert.rejects(()=>app.query('SELECT portal_accounts.prepare_invitation($1,16)',[actor]),/Invitation permission/);checks++;}
  const protectedView=(await app.query('SELECT portal_accounts.management_snapshot(3) AS data')).rows[0].data;
  check(!protectedView.accounts.some(item=>item.id===16)&&!protectedView.plans.some(item=>item.id===plan.id)&&!protectedView.audit.some(item=>item.plan_id===plan.id),'HR snapshot and audit hide a currently privileged target');
  const result={status:'passed',checks,roleChecks,accountSecurityChecks:checks-roleChecks,roles:roles.length,database,host:'127.0.0.1',port:55435,runtimeBypassRls:false,migrationSha256:manifest.sha256,accountMigrationSha256:accountManifest.sha256,verifiedAt:new Date().toISOString(),productionChanged:false};
  const evidence=path.join(workspace,'build-evidence/epdg-phase2-20261114');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'scoped-access-native.json'),JSON.stringify(result,null,2));
  process.stdout.write(JSON.stringify(result)+'\n');
 }finally{await app?.end();await db?.end();await operator.end();run('pg_ctl',['-D',path.join(directory,'pgdata'),'-m','fast','-w','stop']);}
}
if(require.main===module)verify().catch(error=>{process.stderr.write('Scoped access verification failed: '+error.message+'\n');process.exitCode=1;});
module.exports={verify};
