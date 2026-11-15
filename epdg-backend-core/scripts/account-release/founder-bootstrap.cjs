'use strict';
// Offline authenticated operator command. Never imported by application startup.
// Private inputs/outputs contain identity evidence. Console output is counts only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg'),bcrypt=require('bcrypt');
const {entries}=require('./migrate.cjs');
const canonical=value=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const reference=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_./-]{7,119}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const id=()=>crypto.randomUUID();
function target(config){
 const keys=['target_id','approval_reference','host','port','database','migrator_role','runtime_role','connection_user','ssl','synthetic_only','backend_commit','portal_origin','sender','reply_to','batch_approval_reference'];
 const out=Object.fromEntries(keys.map(k=>[k,config[k]??null]));
 requireValue(reference(out.target_id)&&reference(out.approval_reference)&&/^[0-9a-f]{40}$/.test(out.backend_commit||''),'Reviewed source and target references required');
 requireValue(typeof out.host==='string'&&positive(out.port)&&typeof out.database==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(out.migrator_role||'')&&/^[a-z_][a-z0-9_]{0,62}$/.test(out.runtime_role||'')&&out.runtime_role!==out.migrator_role,'Explicit database target and separate roles required');
 requireValue(out.synthetic_only===true?out.host==='127.0.0.1'&&out.port===55432&&out.database==='epdg_synthetic':out.ssl===true,'Reviewed TLS target required');
 return out;
}
async function boundary(client,config){
 const expected=target(config);
 const source=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim();
 requireValue(source===expected.backend_commit,'Executing source differs from reviewed revision');
 if(!config.synthetic_only)requireValue(!require('node:child_process').execFileSync('git',['status','--porcelain'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim(),'Production operator source must be a clean reviewed checkout');
 const {rows:[actual]}=await client.query(`SELECT current_database() AS database,current_user AS operator,session_user AS session_operator,
 (SELECT row_to_json(r) FROM (SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1) r) AS runtime`,[expected.runtime_role]);
 requireValue(actual.database===expected.database&&actual.operator===expected.migrator_role&&actual.session_operator===expected.migrator_role,'Authenticated operator target mismatch');
 requireValue(actual.runtime&&!actual.runtime.rolsuper&&!actual.runtime.rolbypassrls&&!actual.runtime.rolcreatedb&&!actual.runtime.rolcreaterole,'Restricted runtime required');
 const migrations=[];
 for(const entry of entries()){
  const rows=(await client.query(`SELECT version,sha256 FROM ${entry.schema}.schema_migrations`)).rows;
  requireValue(rows.length===1&&rows[0].version===entry.manifest.version&&rows[0].sha256===entry.manifest.sha256,'Reviewed complete migration ledger required');
  migrations.push({schema:entry.schema,version:entry.manifest.version,sha256:entry.manifest.sha256});
 }
 const {rows:[release]}=await client.query('SELECT * FROM portal_accounts.release_control WHERE singleton');
 requireValue(release&&release.target_id===expected.target_id&&release.approval_ref===expected.approval_reference&&release.bound_database===expected.database&&release.bound_runtime_role===expected.runtime_role&&release.synthetic_only===expected.synthetic_only,'Operator-owned release binding mismatch');
 return {target:expected,runtime:actual.runtime,migrations,release};
}
async function identitySnapshot(client,email){
 const core=(await client.query("SELECT to_jsonb(u)-'password'-'verification_token' AS row,encode(sha256(convert_to(password,'UTF8')),'hex') AS credential_hash FROM core.users u WHERE lower(btrim(email))=$1 ORDER BY id",[email])).rows;
 const mirror=(await client.query("SELECT to_jsonb(u)-'password'-'verification_token' AS row,encode(sha256(convert_to(password,'UTF8')),'hex') AS credential_hash FROM epdg.users u WHERE lower(btrim(email))=$1 ORDER BY id",[email])).rows;
 const ids=[...new Set([...core,...mirror].map(x=>x.row.id))];
 const get=async(table,sort)=>ids.length?(await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=ANY($1::int[]) ORDER BY ${sort}`,[ids])).rows.map(x=>x.row):[];
 return {core,mirror,states:await get('portal_security.account_states','user_id'),memberships:await get('portal_security.memberships','id'),assignments:await get('portal_security.role_assignments','id'),branches:await get('core.user_branch_roles','id')};
}
async function organizationSnapshot(client){return (await client.query('SELECT to_jsonb(c) AS row FROM epdg.companies c ORDER BY id')).rows.map(r=>r.row);}
async function candidateId(client,kind){
 const sql=kind==='user'?"SELECT greatest(coalesce((SELECT max(id) FROM core.users),0),coalesce((SELECT max(id) FROM epdg.users),0),(SELECT CASE WHEN is_called THEN last_value ELSE last_value-1 END FROM core.users_id_seq))::int+1 AS id":"SELECT greatest(coalesce((SELECT max(id) FROM epdg.companies),0),(SELECT CASE WHEN is_called THEN last_value ELSE last_value-1 END FROM epdg.companies_id_seq))::int+1 AS id";
 return (await client.query(sql)).rows[0].id;
}
async function createPlan(client,config,request,now=new Date()){
 const bound=await boundary(client,config);
 requireValue(request&&typeof request.email==='string'&&request.email===request.email.trim().toLowerCase()&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(request.email)&&request.email.length<=150,'Canonical reviewed individual email required');
 requireValue(typeof request.name==='string'&&request.name.trim()===request.name&&request.name.length>0&&request.name.length<=100,'Reviewed name required');
 requireValue(!config.synthetic_only||(request.email.endsWith('.invalid')&&request.name.startsWith('SYNTHETIC ')),'Synthetic identity boundary required');
 const snapshot=await identitySnapshot(client,request.email),organizations=await organizationSnapshot(client);
 const conflict=(await client.query('SELECT portal_accounts.identity_conflict($1) AS conflict',[request.email])).rows[0].conflict;
 requireValue(!conflict,'Identity conflict requires private reconciliation');
 const exists=snapshot.core.length===1&&snapshot.mirror.length===1;
 requireValue(exists?request.identity_action==='reuse_existing'&&request.user_id===snapshot.core[0].row.id:request.identity_action==='create_missing','Existing identity must be reused; missing identity requires separate creation approval');
 requireValue(!snapshot.states.some(s=>s.active)&&snapshot.assignments.length===0,'Active or previously privileged identity requires separate reconciliation');
 requireValue(!snapshot.memberships.some(m=>!m.active),'Disabled membership requires separate reconciliation');
 const userId=exists?request.user_id:await candidateId(client,'user');
 const organization=request.organization;
 requireValue(organization&&['reuse_existing','create_missing'].includes(organization.action),'Explicit organization decision required');
 let organizationId;
 if(organization.action==='reuse_existing'){
  const row=organizations.find(c=>c.id===organization.id);requireValue(row&&row.is_approved&&!row.deleted_at,'Reviewed approved organization required');organizationId=row.id;
 }else{
  requireValue(organizations.length===0&&typeof organization.name==='string'&&organization.name.trim()===organization.name&&organization.name.length>0&&organization.name.length<=150&&reference(organization.evidence_reference),'Separate first-organization establishment evidence required');
  requireValue(!config.synthetic_only||organization.name.startsWith('SYNTHETIC '),'Synthetic organization boundary required');
  organizationId=await candidateId(client,'organization');
 }
 const founders=(await client.query("SELECT a.id FROM portal_security.role_assignments a JOIN portal_access.scopes s ON s.assignment_id=a.id WHERE s.organization_id=$1 AND a.role_code='founder_owner'",[organizationId])).rows;
 requireValue(founders.length===0&&(await client.query('SELECT 1 FROM portal_bootstrap.approvals WHERE organization_id=$1 OR user_id=$2',[organizationId,userId])).rowCount===0,'One-time founder establishment already exists');
 const branch=(await client.query("SELECT to_jsonb(b) AS row FROM core.branches b WHERE code='epdg'")).rows;
 requireValue(branch.length===1,'Exact existing EPDG branch required');
 const plan={format:'epdg-founder-bootstrap-v1',id:id(),created_at:now.toISOString(),expires_at:new Date(now.getTime()+24*3600e3).toISOString(),...bound,
  identity:{email:request.email,name:request.name,user_id:userId,action:request.identity_action,snapshot},
  organization:{...organization,id:organizationId,owner_user_id:userId,snapshot:organizations},branch:branch[0].row,
  role:{code:'founder_owner',scope_type:'organization',scope_id:String(organizationId)}};
 return {plan,sha256:digest(plan)};
}
function validateApproval(envelope,approval,approvedDigest,now=new Date()){
 requireValue(envelope&&sha(envelope.sha256)&&digest(envelope.plan)===envelope.sha256&&envelope.sha256===approvedDigest,'Separately approved exact plan digest required');
 requireValue(approval&&approval.plan_sha256===envelope.sha256&&reference(approval.approval_reference)&&reference(approval.operator_reference)&&approval.authorize_founder_bootstrap===true,'Immutable explicit operator approval required');
 requireValue(Number.isFinite(Date.parse(approval.expires_at))&&Date.parse(approval.expires_at)>now.getTime()&&Date.parse(approval.expires_at)<=Date.parse(envelope.plan.expires_at)&&Date.parse(envelope.plan.expires_at)>now.getTime(),'Approval expired or exceeds plan lifetime');
 requireValue(envelope.plan.identity.action!=='create_missing'||approval.authorize_identity_creation===true,'Separate missing-identity creation approval required');
 requireValue(envelope.plan.organization.action!=='create_missing'||approval.authorize_organization_creation===true&&approval.organization_evidence_reference===envelope.plan.organization.evidence_reference,'Separate organization establishment approval required');
}
async function applyPlan(client,config,envelope,approval,approvedDigest){
 validateApproval(envelope,approval,approvedDigest);
 const plan=envelope.plan;requireValue(canonical(target(config))===canonical(plan.target),'Target differs from approved plan');
 await client.query('BEGIN');
 try{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-founder-bootstrap:'||$1,0))",[String(plan.organization.id)]);
  const bound=await boundary(client,config);
  requireValue(canonical(bound)===canonical({target:plan.target,runtime:plan.runtime,migrations:plan.migrations,release:plan.release}),'Release, runtime or migration binding changed');
  const prior=(await client.query('SELECT id,plan_hash,approval_hash FROM portal_bootstrap.approvals WHERE organization_id=$1 OR user_id=$2',[plan.organization.id,plan.identity.user_id])).rows;
  if(prior.length){requireValue(prior.length===1&&prior[0].plan_hash===envelope.sha256&&prior[0].approval_hash===digest(approval),'Conflicting immutable approval already exists');await client.query('COMMIT');return {reused:true,approval_id:prior[0].id};}
  // Prevent absent-row identity/company races with ordinary provisioning or operator writes.
  await client.query('LOCK TABLE core.users,epdg.users,epdg.companies,core.user_branch_roles,portal_security.account_states,portal_security.memberships,portal_security.role_assignments,portal_access.scopes IN SHARE ROW EXCLUSIVE MODE');
  requireValue(canonical(await identitySnapshot(client,plan.identity.email))===canonical(plan.identity.snapshot)&&canonical(await organizationSnapshot(client))===canonical(plan.organization.snapshot),'Identity or organization changed since plan review');
  requireValue((await client.query("SELECT 1 FROM portal_security.role_assignments a JOIN portal_access.scopes s ON s.assignment_id=a.id WHERE s.organization_id=$1 AND a.role_code='founder_owner'",[plan.organization.id])).rowCount===0,'Founder scope already exists');
  const user=plan.identity.user_id,org=plan.organization.id;
  if(plan.identity.action==='create_missing'){
   requireValue(await candidateId(client,'user')===user,'Planned stable identity ID changed');
   const unusable=await bcrypt.hash(crypto.randomBytes(48).toString('base64url'),12);
   await client.query('INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,$3,$4,false)',[user,plan.identity.email,plan.identity.name,unusable]);
   await client.query("INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES($1,$2,$3,$4,'admin',false)",[user,plan.identity.email,plan.identity.name,unusable]);
   await client.query("SELECT setval('core.users_id_seq',greatest((SELECT last_value FROM core.users_id_seq),$1),true)",[user]);
  }
  await client.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,false) ON CONFLICT(user_id) DO NOTHING',[user]);
  if(plan.organization.action==='create_missing'){
   requireValue(await candidateId(client,'organization')===org,'Planned organization ID changed');
   // is_approved is the separately recorded establishment approval; email verification remains false.
   await client.query('INSERT INTO epdg.companies(id,user_id,company_name,is_approved,is_verified) VALUES($1,$2,$3,true,false)',[org,user,plan.organization.name]);
   await client.query("SELECT setval('epdg.companies_id_seq',greatest((SELECT last_value FROM epdg.companies_id_seq),$1),true)",[org]);
  }
  const branch=(await client.query("SELECT to_jsonb(b) AS row FROM core.branches b WHERE code='epdg'")).rows;
  requireValue(branch.length===1&&canonical(branch[0].row)===canonical(plan.branch),'Branch changed since review');
  if(!plan.identity.snapshot.branches.some(b=>b.branch_id===plan.branch.id))await client.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,$2,'admin')",[user,plan.branch.id]);
  await client.query('INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES($1,$2,true) ON CONFLICT(user_id,company_id) WHERE company_id IS NOT NULL DO NOTHING',[user,org]);
  const hashRow=async(table,where,values)=>(await client.query(`SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM ${table} t WHERE ${where}`,values)).rows[0].hash;
  const orgHash=await hashRow('epdg.companies','id=$1',[org]),membershipHash=await hashRow('portal_security.memberships','user_id=$1 AND company_id=$2',[user,org]),branchHash=await hashRow('core.user_branch_roles','user_id=$1 AND branch_id=$2',[user,plan.branch.id]);
  await client.query(`INSERT INTO portal_bootstrap.approvals(id,organization_id,user_id,plan_hash,plan_text,approval_hash,approval_text,operator_role,target_id,release_reference,runtime_role,email,identity_action,organization_hash,membership_hash,branch_hash,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,session_user,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[plan.id,org,user,envelope.sha256,canonical(plan),digest(approval),canonical(approval),config.target_id,config.approval_reference,config.runtime_role,plan.identity.email,plan.identity.action,orgHash,membershipHash,branchHash,approval.expires_at]);
  const assignment=(await client.query("INSERT INTO portal_security.role_assignments(user_id,role_code,status) VALUES($1,'founder_owner','pending') RETURNING id",[user])).rows[0].id;
  await client.query("INSERT INTO portal_access.scopes(assignment_id,organization_id,scope_type,scope_id,approved_by_user_id,operator_approval_id,approval_reference,active) VALUES($1,$2,'organization',$3,NULL,$4,$5,false)",[assignment,org,String(org),plan.id,envelope.sha256]);
  await client.query('INSERT INTO portal_bootstrap.invitations(approval_id) VALUES($1)',[plan.id]);
  await client.query("INSERT INTO portal_bootstrap.audit_events(approval_id,event,operator_role) VALUES($1,'prepared',session_user)",[plan.id]);
  await client.query('COMMIT');return {reused:false,approval_id:plan.id};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function sendInvitation(client,config,envelope,approval,approvedDigest,{resend=false,transport}={}){
 validateApproval(envelope,approval,approvedDigest);const plan=envelope.plan;
 requireValue(canonical(target(config))===canonical(plan.target),'Mail target differs from approved plan');
 const mail=require('../../dist/security/accountReleaseConfig.js').accountReleaseConfig();
 requireValue(mail.targetId===config.target_id&&mail.approvalRef===config.approval_reference&&mail.origin===config.portal_origin&&mail.from===config.sender&&mail.replyTo===config.reply_to&&mail.batchApproval===config.batch_approval_reference&&mail.deliveryEnabled,'Runtime mail settings differ from reviewed approval');
 await boundary(client,config);const token=crypto.randomBytes(32).toString('base64url');let invitation;
 await client.query('BEGIN');
 try{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-founder-bootstrap:'||$1,0))",[String(plan.organization.id)]);
  const {rows:[b]}=await client.query('SELECT * FROM portal_bootstrap.approvals WHERE id=$1',[plan.id]);
  requireValue(b&&b.plan_hash===approvedDigest&&b.approval_hash===digest(approval)&&b.operator_role===config.migrator_role,'Persisted approval mismatch');
  const {rows:[r]}=await client.query('SELECT * FROM portal_accounts.release_control WHERE singleton FOR SHARE');
  requireValue(r.enabled&&r.mail_enabled&&r.batch_approval_ref===config.batch_approval_reference&&approval.authorize_invitation_send===true&&approval.batch_approval_reference===r.batch_approval_ref,'Separate exact mail-batch approval required');
  requireValue((await client.query('SELECT portal_bootstrap.current_approval($1) AS current',[plan.id])).rows[0].current,'Founder bootstrap eligibility changed');
  const {rows:[u]}=await client.query('SELECT u.password,s.revision,s.active FROM core.users u JOIN portal_security.account_states s ON s.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u,s',[b.user_id]);
  await client.query('SELECT 1 FROM epdg.users WHERE id=$1 FOR UPDATE',[b.user_id]);
  await client.query('SELECT 1 FROM epdg.companies WHERE id=$1 FOR SHARE',[b.organization_id]);
  await client.query('SELECT 1 FROM portal_security.memberships WHERE user_id=$1 FOR SHARE',[b.user_id]);
  await client.query('SELECT 1 FROM core.user_branch_roles WHERE user_id=$1 FOR SHARE',[b.user_id]);
  await client.query('SELECT 1 FROM portal_security.role_assignments WHERE user_id=$1 FOR SHARE',[b.user_id]);
  await client.query('SELECT 1 FROM portal_access.scopes WHERE operator_approval_id=$1 FOR SHARE',[b.id]);
  requireValue((await client.query('SELECT portal_bootstrap.current_approval($1) AS current',[plan.id])).rows[0].current,'Founder eligibility changed while awaiting locks');
  requireValue(!u.active,'Founder account is already active');
  const {rows:[inv]}=await client.query('SELECT * FROM portal_bootstrap.invitations WHERE approval_id=$1 FOR UPDATE',[plan.id]);
  requireValue(inv&&['prepared','pending'].includes(inv.status),'Invitation unavailable');
  if(inv.status==='pending'&&!resend){await client.query('COMMIT');return {reused:true,delivery_status:inv.delivery_status};}
  requireValue(!inv.sent_at||Date.now()-new Date(inv.sent_at).getTime()>=60000,'Resend cooldown required');
  const attempt=id();invitation=(await client.query("UPDATE portal_bootstrap.invitations SET status='pending',token_hash=$2,credential_hash=$3,account_revision=$4,delivery_status='sending',attempt_id=$5,provider_id=NULL,expires_at=least(clock_timestamp()+interval '24 hours',$6::timestamptz),sent_at=clock_timestamp() WHERE id=$1 RETURNING id,attempt_id",[inv.id,digest(token),digest(u.password),u.revision,attempt,b.expires_at])).rows[0];
  await client.query("INSERT INTO portal_bootstrap.audit_events(approval_id,event,operator_role,attempt_id) VALUES($1,'send_started',session_user,$2)",[plan.id,attempt]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
 let status='unknown',providerId=null;
 try{
  const {sendAccountInvitation}=require('../../dist/security/accountMail.js');
  const result=await sendAccountInvitation(plan.identity.email,token,invitation.attempt_id,transport);status=result.status;providerId=result.providerId;
 }catch{/* Timeout can follow provider acceptance; never claim confirmed delivery. */}
 await client.query('BEGIN');try{
  await client.query('UPDATE portal_bootstrap.invitations SET delivery_status=$3,provider_id=$4 WHERE id=$1 AND attempt_id=$2 AND status=\'pending\'',[invitation.id,invitation.attempt_id,status,providerId]);
  await client.query('INSERT INTO portal_bootstrap.audit_events(approval_id,event,operator_role,attempt_id) VALUES($1,$2,session_user,$3)',[plan.id,status,invitation.attempt_id]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
 return {reused:false,delivery_status:status,delivered_at:null};
}
async function revoke(client,config,envelope,approval,approvedDigest){
 requireValue(envelope&&digest(envelope.plan)===approvedDigest&&envelope.sha256===approvedDigest&&approval.plan_sha256===approvedDigest&&approval.authorize_emergency_disable===true&&reference(approval.approval_reference)&&reference(approval.operator_reference)&&Date.parse(approval.expires_at)>Date.now(),'Fresh exact emergency-disable approval required');
 requireValue(canonical(target(config))===canonical(envelope.plan.target),'Revocation target mismatch');
 await boundary(client,config);await client.query('BEGIN');
 try{
  const plan=envelope.plan;await client.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-founder-bootstrap:'||$1,0))",[String(plan.organization.id)]);
  const {rows:[b]}=await client.query('SELECT * FROM portal_bootstrap.approvals WHERE id=$1',[plan.id]);requireValue(b&&b.plan_hash===approvedDigest,'Persisted approval mismatch');
  await client.query('SELECT 1 FROM portal_security.account_states WHERE user_id=$1 FOR UPDATE',[b.user_id]);
  await client.query("INSERT INTO portal_bootstrap.revocations(approval_id,operator_role,reason) VALUES($1,session_user,'access_review') ON CONFLICT DO NOTHING",[b.id]);
  await client.query('UPDATE portal_security.account_states SET active=false WHERE user_id=$1',[b.user_id]);
  await client.query("UPDATE portal_security.role_assignments SET status='revoked' WHERE user_id=$1 AND role_code='founder_owner'",[b.user_id]);
  await client.query('UPDATE portal_access.scopes SET active=false WHERE operator_approval_id=$1',[b.id]);
  await client.query("UPDATE portal_bootstrap.invitations SET status='revoked' WHERE approval_id=$1 AND status IN('prepared','pending')",[b.id]);
  await client.query("UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=$1 AND revoked_at IS NULL",[b.user_id]);
  await client.query('UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[b.user_id]);
  await client.query("INSERT INTO portal_bootstrap.audit_events(approval_id,event,operator_role) VALUES($1,'revoked',session_user)",[b.id]);await client.query('COMMIT');return {revoked:true};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function main(){
 const [action,configuration,input,approvalFile,output]=process.argv.slice(2);
 requireValue(['--plan','--apply','--send','--resend','--revoke'].includes(action)&&configuration&&input,'Use action, private target JSON and private request/plan JSON; mutation also requires private approval JSON');
 const read=p=>JSON.parse(fs.readFileSync(path.resolve(p),'utf8')),config=read(configuration);target(config);
 requireValue(process.env.EPDG_MIGRATOR_PASSWORD,'Private operator credential required');
 const ca=config.ca_file?fs.readFileSync(path.resolve(config.ca_file),'utf8'):undefined;
 const client=new Client({host:config.host,port:config.port,database:config.database,user:config.connection_user||config.migrator_role,password:process.env.EPDG_MIGRATOR_PASSWORD,ssl:config.ssl?{rejectUnauthorized:true,...(ca?{ca}:{})}:false,statement_timeout:30000});
 await client.connect();try{
  if(action==='--plan'){
   requireValue(approvalFile,'Private plan output path required');await client.query('BEGIN READ ONLY');const result=await createPlan(client,config,read(input));await client.query('COMMIT');
   fs.writeFileSync(path.resolve(approvalFile),canonical(result),{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify({plan_sha256:result.sha256,production_changed:false})+'\n');
  }else{
   requireValue(approvalFile&&process.env.EPDG_FOUNDER_BOOTSTRAP_APPROVED==='1','Explicit operator action approval required');
   const args=[client,config,read(input),read(approvalFile),process.env.EPDG_FOUNDER_APPROVED_PLAN_SHA256];
   const result=action==='--apply'?await applyPlan(...args):action==='--revoke'?await revoke(...args):await sendInvitation(...args,{resend:action==='--resend'});
   if(output)fs.writeFileSync(path.resolve(output),canonical(result),{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify({completed:true,reused:result.reused??false,delivery_status:result.delivery_status??null})+'\n');
  }
 }finally{await client.end();}
}
module.exports={canonical,digest,target,boundary,identitySnapshot,createPlan,validateApproval,applyPlan,sendInvitation,revoke};
if(require.main===module)main().catch(()=>{process.stderr.write('Founder operation stopped; inspect private configuration and approval evidence. No private values are logged.\n');process.exitCode=1;});
