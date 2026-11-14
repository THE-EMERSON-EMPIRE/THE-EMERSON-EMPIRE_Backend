'use strict';
// Disposable native PostgreSQL verification; no production connection is accepted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const net=require('node:net'),{spawnSync}=require('node:child_process'),{Client}=require('pg');
const core=path.resolve(__dirname,'../..'),backend=path.dirname(core),workspace=path.resolve(backend,'../..');
const secret=()=>crypto.randomBytes(32).toString('base64url');
async function verify(){
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(55436,'127.0.0.1',()=>server.close(resolve));});
 const directory=path.join(backend,'.local-synthetic','portable-learning-'+Date.now());fs.mkdirSync(directory,{recursive:true});
 const pgBin=path.join(workspace,'.tools/postgresql-17.11/pgsql/bin'),exe=name=>path.join(pgBin,name+(process.platform==='win32'?'.exe':''));
 const run=(name,args)=>{const r=spawnSync(exe(name),args,{windowsHide:true,stdio:'ignore',timeout:60000});if(r.status!==0)throw new Error('Disposable PostgreSQL operation failed: '+name);};
 const opPassword=secret(),pw=path.join(directory,'init-password');fs.writeFileSync(pw,opPassword,{mode:0o600});
 run('initdb',['-D',path.join(directory,'pgdata'),'-U','epdg_learning_operator','--pwfile',pw,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);fs.unlinkSync(pw);
 run('pg_ctl',['-D',path.join(directory,'pgdata'),'-l',path.join(directory,'postgres.log'),'-o','-h 127.0.0.1 -p 55436','-w','start']);
 const base={host:'127.0.0.1',port:55436,connectionTimeoutMillis:5000};let operator,db,app;let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++;};
 try{
  operator=new Client({...base,database:'postgres',user:'epdg_learning_operator',password:opPassword});await operator.connect();
  const mp=secret(),rp=secret(),migrator='learning_migrator',runtime='learning_runtime';
  await operator.query(`CREATE ROLE ${migrator} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${mp}'`);
  await operator.query(`CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${rp}'`);
  await operator.query('CREATE ROLE epdg_synthetic_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
  await operator.query(`CREATE DATABASE epdg_learning_review OWNER ${migrator}`);
  db=new Client({...base,database:'epdg_learning_review',user:migrator,password:mp});await db.connect();
  await db.query(fs.readFileSync(path.join(__dirname,'baseline.sql'),'utf8'));
  for(const folder of ['security-migrations','admin-migrations'])await db.query(fs.readFileSync(path.join(core,folder,fs.readdirSync(path.join(core,folder))[0]),'utf8'));
  await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE epdg_learning_review FROM PUBLIC');
  const apply=async(folder,manifestPath,schema)=>{
   const manifest=JSON.parse(fs.readFileSync(path.join(core,manifestPath),'utf8')),sql=fs.readFileSync(path.join(core,folder,manifest.file),'utf8');
   assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),manifest.sha256);
   await db.query('BEGIN');try{
    await db.query("SELECT set_config('epdg.access_runtime_role',$1,true),set_config('epdg.access_migrator_role',$2,true)",[runtime,migrator]);
    const present=(await db.query('SELECT to_regclass($1) IS NOT NULL AS present',[schema+'.schema_migrations'])).rows[0].present;
    const rows=present?(await db.query(`SELECT version,sha256 FROM ${schema}.schema_migrations`)).rows:[];
    if(rows.length){assert.equal(rows.length,1);assert.equal(rows[0].version,manifest.version);assert.equal(rows[0].sha256,manifest.sha256);}
    else{await db.query(sql);await db.query(`INSERT INTO ${schema}.schema_migrations(version,sha256) VALUES($1,$2)`,[manifest.version,manifest.sha256]);}
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}
  };
  await apply('access-migrations','src/security/access-schema-manifest.json','portal_access');
  await apply('account-migrations','src/security/account-schema-manifest.json','portal_accounts');
  // A failure after all DDL, before commit, must leave no half-installed schema.
  await db.query('BEGIN');
  try{
   await db.query("SELECT set_config('epdg.access_runtime_role',$1,true),set_config('epdg.access_migrator_role',$2,true)",[runtime,migrator]);
   await db.query(fs.readFileSync(path.join(core,'portable-learning-migrations/001-portable-learning.sql'),'utf8'));
   await assert.rejects(()=>db.query('SELECT 1/0'),/division by zero/);
  }finally{await db.query('ROLLBACK');}
  check((await db.query("SELECT to_regnamespace('portal_learning') IS NULL AS clean")).rows[0].clean,'Failed education migration rolls back completely');
  await apply('portable-learning-migrations','src/learning/portable-schema-manifest.json','portal_learning');
  await apply('portable-learning-migrations','src/learning/portable-schema-manifest.json','portal_learning');check(true,'Checksummed education migration is idempotent');
  const result=await exercise(db,new Client({...base,database:'epdg_learning_review',user:runtime,password:rp}),check);app=result.app;
  const evidence={status:'passed',checks,host:'127.0.0.1',port:55436,database:'epdg_learning_review',runtimeBypassRls:false,
   migrationSha256:require('../../src/learning/portable-schema-manifest.json').sha256,verifiedAt:new Date().toISOString(),productionChanged:false};
  const out=path.join(workspace,'build-evidence/epdg-phase-two-20261114');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'portable-learning-native.json'),JSON.stringify(evidence,null,2));
  process.stdout.write(JSON.stringify(evidence)+'\n');return evidence;
 }finally{await app?.end();await db?.end();await operator?.end();run('pg_ctl',['-D',path.join(directory,'pgdata'),'-m','fast','-w','stop']);}
}
async function exercise(db,app,check){
 await app.connect();
 try{
  await db.query("INSERT INTO core.branches(id,code,name) VALUES(1,'epdg','SYNTHETIC education tests')");
  for(let id=1;id<=4;id++){
   const email=`education-${id}@epdg.invalid`,name=`SYNTHETIC education ${id}`;
   await db.query('INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,$3,$4,true)',[id,email,name,'synthetic-password-placeholder']);
   await db.query("INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES($1,$2,$3,$4,'intern',true)",[id,email,name,'synthetic-password-placeholder']);
   await db.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,1,'intern')",[id]);
   await db.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)',[id]);
  }
  await db.query("INSERT INTO epdg.companies(id,user_id,company_name,email,is_approved,is_verified) VALUES(1,1,'SYNTHETIC education organization','education-org@epdg.invalid',true,true)");
  const memberships={};for(let id=1;id<=4;id++)memberships[id]=(await db.query('INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES($1,1,true) RETURNING id',[id])).rows[0].id;
  const group=crypto.randomUUID(),other=crypto.randomUUID();
  for(const id of [group,other])await db.query("INSERT INTO portal_access.groups(id,organization_id,kind,name) VALUES($1,1,'program','SYNTHETIC education program')",[id]);
  const owner=(await db.query("INSERT INTO portal_security.role_assignments(user_id,role_code,status) VALUES(1,'founder_owner','active') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO portal_access.scopes(assignment_id,organization_id,scope_type,scope_id,approved_by_user_id,approval_reference) VALUES($1,1,'organization','1',1,'SYNTHETIC offline founder bootstrap')",[owner]);
  for(const [id,role] of [[2,'program_coordinator'],[3,'participant'],[4,'participant']])await app.query("SELECT portal_access.grant_role(1,$1,$2,'group',$3,'SYNTHETIC founder approval')",[id,role,id===4?other:group]);
  const plans={},programs={},enrollments={},items={},sessions={};
  for(const id of [3,4]){
   const hash='0'.repeat(64);plans[id]=(await db.query(`INSERT INTO portal_accounts.provisioning_plans(organization_id,email,name,roles,payload_hash,status,onboarding_status,onboarding_verified_by,onboarding_evidence_ref,created_by,approved_by,approved_revision,approved_hash,user_id,identity_action)
    VALUES(1,$1,'SYNTHETIC verified learner',$2,$3,'provisioned','verified',1,'SYNTHETIC-CRM-EVIDENCE',1,1,1,$3,$4,'reused') RETURNING id`,[`education-${id}@epdg.invalid`,JSON.stringify([{role_code:'participant',scope_type:'group',scope_id:id===3?group:other}]),hash,id])).rows[0].id;
   programs[id]=crypto.randomUUID();enrollments[id]=crypto.randomUUID();items[id]=crypto.randomUUID();
   await db.query("INSERT INTO portal_learning.programs(id,organization_id,access_group_id,title,summary,starts_at,ends_at) VALUES($1,1,$2,'SYNTHETIC course','SYNTHETIC summary',now(),now()+interval '30 days')",[programs[id],id===3?group:other]);
   await db.query('INSERT INTO portal_learning.enrollments(id,program_id,user_id,organization_id,membership_id,onboarding_plan_id,active) VALUES($1,$2,$3,1,$4,$5,true)',[enrollments[id],programs[id],id,memberships[id],plans[id]]);
   await db.query("INSERT INTO portal_learning.items(id,program_id,position,title,kind,description,content) VALUES($1,$2,1,'SYNTHETIC reflection','assignment','SYNTHETIC brief','SYNTHETIC assignment')",[items[id],programs[id]]);
  }
  const lesson=crypto.randomUUID();await db.query("INSERT INTO portal_learning.items(id,program_id,position,title,kind,description,content) VALUES($1,$2,2,'SYNTHETIC lesson','lesson','SYNTHETIC brief','SYNTHETIC lesson')",[lesson,programs[3]]);
  const mapping=crypto.randomUUID();await db.query("INSERT INTO portal_learning.mentor_assignments(id,mentor_user_id,membership_id,enrollment_id,organization_id,active,mentor_label) VALUES($1,2,$2,$3,1,true,'SYNTHETIC Mentor')",[mapping,memberships[2],enrollments[3]]);
  for(let id=1;id<=4;id++){
   sessions[id]=crypto.createHash('sha256').update(secret()).digest('hex');
   await db.query("INSERT INTO portal_security.sessions(user_id,token_hash,credential_version,account_revision,membership_fingerprint,expires_at) SELECT user_id,$2,$3,revision,$3,now()+interval '1 hour' FROM portal_security.account_states WHERE user_id=$1",[id,sessions[id],'0'.repeat(64)]);
  }
  const as=async(id,work)=>{await app.query('BEGIN');try{await app.query("SELECT set_config('portal_learning.session_hash',$1,true)",[sessions[id]??'']);const result=await work();await app.query('COMMIT');return result;}catch(e){await app.query('ROLLBACK');throw e;}};
  check((await app.query('SELECT * FROM portal_learning.enrollments')).rows.length===0,'No session sees no enrollments');
  check((await as(3,()=>app.query('SELECT * FROM portal_learning.enrollments'))).rows.length===1,'Learner sees exactly own enrollment');
  await db.query("UPDATE portal_security.sessions SET expires_at=now()-interval '1 hour',created_at=now()-interval '2 hours' WHERE user_id=4");
  check((await as(4,()=>app.query('SELECT * FROM portal_learning.enrollments'))).rows.length===0,'Expired session cannot bind a database actor');
  await db.query("UPDATE portal_security.sessions SET expires_at=now()+interval '1 hour' WHERE user_id=4");
  check((await as(3,()=>app.query('SELECT id FROM portal_learning.items'))).rows.length===2,'Learner sees only own assigned materials');
  await assert.rejects(()=>as(3,()=>app.query('INSERT INTO portal_learning.assignment_drafts(enrollment_id,program_id,item_id,answer,revision) VALUES($1,$2,$3,$4,1)',[enrollments[4],programs[4],items[4],'forged'])),/row-level security|Assignment required/);check(true,'Cross-user SQL draft rejected');
  const draft=()=>app.query('INSERT INTO portal_learning.assignment_drafts(enrollment_id,program_id,item_id,answer,revision) VALUES($1,$2,$3,$4,1)',[enrollments[3],programs[3],items[3],'SYNTHETIC learner answer']);
  await as(3,draft);check(true,'Own draft saved');
  check((await as(2,()=>app.query('SELECT * FROM portal_learning.assignment_drafts'))).rows.length===0,'Mentor cannot see unpublished learner drafts');
  await as(3,()=>app.query('INSERT INTO portal_learning.assignment_attachments(enrollment_id,program_id,item_id,filename,media_type,bytes) VALUES($1,$2,$3,$4,$5,$6)',[enrollments[3],programs[3],items[3],'fiction.txt','text/plain',Buffer.from('SYNTHETIC evidence')]));
  check((await as(2,()=>app.query('SELECT * FROM portal_learning.assignment_attachments'))).rows.length===0,'Mentor cannot see draft attachments');
  const receipt=(await as(3,()=>app.query('INSERT INTO portal_learning.assignment_receipts(enrollment_id,program_id,item_id,answer,revision) SELECT enrollment_id,program_id,item_id,answer,revision FROM portal_learning.assignment_drafts RETURNING *'))).rows[0];
  check(receipt.revision===2&&receipt.attachments.length===1&&receipt.attempt_number===1,'Submission freezes revision and file manifest');
  await assert.rejects(()=>as(3,()=>app.query("UPDATE portal_learning.assignment_drafts SET answer='mutated',revision=revision+1")),/Submitted attempt is immutable/);check(true,'Submitted attempt is immutable');
  check((await as(4,()=>app.query('SELECT * FROM portal_learning.assignment_receipts'))).rows.length===0,'Other learner cannot read submission');
  check((await as(2,()=>app.query('SELECT * FROM portal_learning.assignment_receipts'))).rows.length===1,'Explicit assigned mentor sees submitted receipt');
  check((await as(2,()=>app.query('SELECT * FROM portal_learning.assignment_attachments'))).rows.length===1,'Assigned mentor sees only frozen submission files');
  await assert.rejects(()=>as(4,()=>app.query('INSERT INTO portal_learning.mentor_review_drafts(assignment_id,receipt_id,comment,revision) VALUES($1,$2,$3,1)',[mapping,receipt.id,'forged'])),/Current mentor review scope required|row-level security/);check(true,'Unassigned reviewer rejected');
  await as(2,()=>app.query('INSERT INTO portal_learning.mentor_review_drafts(assignment_id,receipt_id,comment,revision) VALUES($1,$2,$3,1)',[mapping,receipt.id,'SYNTHETIC mentor feedback']));
  check((await as(3,()=>app.query('SELECT * FROM portal_learning.mentor_review_drafts'))).rows.length===0,'Learner cannot read unpublished mentor draft');
  await as(2,()=>app.query('INSERT INTO portal_learning.mentor_review_feedback(assignment_id,receipt_id,comment,revision) SELECT assignment_id,receipt_id,comment,revision FROM portal_learning.mentor_review_drafts'));
  check((await as(3,()=>app.query('SELECT * FROM portal_learning.mentor_review_feedback'))).rows.length===1,'Learner sees published feedback');
  await as(3,()=>app.query('UPDATE portal_learning.assignment_drafts SET attempt_number=attempt_number+1,previous_receipt_id=$1,revision=revision+1',[receipt.id]));
  check((await as(3,()=>app.query('SELECT attempt_number FROM portal_learning.assignment_drafts'))).rows[0].attempt_number===2,'Feedback permits a new revision with retained history');
  check((await as(3,()=>app.query('SELECT answer,attachments FROM portal_learning.assignment_receipts'))).rows[0].answer===receipt.answer,'Earlier immutable receipt remains unchanged');
  await as(3,()=>app.query('INSERT INTO portal_learning.completions(enrollment_id,program_id,item_id) VALUES($1,$2,$3)',[enrollments[3],programs[3],lesson]));check(true,'Own lesson completion allowed');
  await assert.rejects(()=>as(3,()=>app.query('INSERT INTO portal_learning.completions(enrollment_id,program_id,item_id) VALUES($1,$2,$3)',[enrollments[3],programs[3],items[3]])),/row-level security/);check(true,'Assignment cannot become lesson completion');
  await db.query('UPDATE portal_learning.mentor_assignments SET active=false WHERE id=$1',[mapping]);
  check((await as(2,()=>app.query('SELECT * FROM portal_learning.assignment_receipts'))).rows.length===0,'Mentor revocation immediately removes receipt access');
  check((await as(3,()=>app.query('SELECT * FROM portal_learning.mentor_review_feedback'))).rows.length===1,'Published learner feedback survives mentor revocation');
  await db.query("UPDATE portal_accounts.provisioning_plans SET onboarding_status='required' WHERE id=$1",[plans[3]]);
  check((await as(3,()=>app.query('SELECT * FROM portal_learning.enrollments'))).rows.length===0,'HR hold removes learning access');
  await db.query("UPDATE portal_accounts.provisioning_plans SET onboarding_status='verified' WHERE id=$1",[plans[3]]);
  await db.query('UPDATE portal_security.account_states SET active=false WHERE user_id=3');
  check((await as(3,()=>app.query('SELECT * FROM portal_learning.assignment_receipts'))).rows.length===0,'Disable invalidates database actor and learner access');
  for(const query of ['UPDATE portal_learning.enrollments SET active=true','UPDATE portal_learning.mentor_assignments SET active=true','DELETE FROM portal_learning.assignment_receipts',"UPDATE portal_learning.programs SET title='forged'",'SELECT portal_learning.learner_eligible(null)']){await assert.rejects(()=>app.query(query),/permission denied/);check(true,'Privileged education mutation denied');}
  check((await app.query("SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0]['?column?'],'Restricted runtime has no RLS bypass');
  return {app};
 }catch(error){await app.end();throw error;}
}
if(require.main===module)verify().catch(error=>{process.stderr.write('Portable learning verification failed: '+error.message+'\n');process.exitCode=1;});
module.exports={verify};
