'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),bcrypt=require('bcrypt');
process.env.EPDG_REVIEW_PHASE='3';
const fixture=require('./account-release-review.cjs'),bootstrap=require('../account-release/founder-bootstrap.cjs');
async function verify(){
 const c=fixture.load(),env=fixture.environment(c);for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env);
 const operator=await fixture.db(c),runtime=await fixture.db(c,'runtime');let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
 try{
  const userId=920000+Math.floor(Math.random()*10000),orgId=userId,email='existing-founder-'+userId+'@epdg.invalid',oldHash=await bcrypt.hash(crypto.randomBytes(32).toString('base64url'),12);
  await operator.query("INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,'SYNTHETIC retained name',$3,true)",[userId,email,oldHash]);
  await operator.query("INSERT INTO epdg.users(id,email,name,password,is_verified,role) VALUES($1,$2,'SYNTHETIC retained name',$3,true,'intern')",[userId,email,oldHash]);
  await operator.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,false)',[userId]);
  await operator.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,1,'intern')",[userId]);
  await operator.query("INSERT INTO epdg.companies(id,user_id,company_name,is_approved,is_verified) VALUES($1,$2,'SYNTHETIC pre-existing organization',true,false)",[orgId,userId]);
  await operator.query('INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES($1,$2,true)',[userId,orgId]);
  const history=crypto.randomUUID();await operator.query("INSERT INTO portal_access.resources(id,organization_id,kind,subject_user_id,title,body) VALUES($1,$2,'portfolio',$3,'SYNTHETIC prior history','SYNTHETIC retained portfolio')",[history,orgId,userId]);
  const target={...c.founderBootstrap.target,backend_commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim()};
  const input={email,name:'SYNTHETIC requested name must not overwrite history',user_id:userId,identity_action:'reuse_existing',organization:{action:'reuse_existing',id:orgId}};
  await assert.rejects(()=>bootstrap.createPlan(operator,target,{...input,identity_action:'create_missing'}));checks++;
  await operator.query('BEGIN');await operator.query('UPDATE portal_security.account_states SET active=true WHERE user_id=$1',[userId]);await assert.rejects(()=>bootstrap.createPlan(operator,target,input),/Active/);checks++;await operator.query('ROLLBACK');
  const plan=await bootstrap.createPlan(operator,target,input),approval={plan_sha256:plan.sha256,approval_reference:'SYNTHETIC-reuse-approval',operator_reference:'SYNTHETIC-authorized-reviewer',expires_at:plan.plan.expires_at,authorize_founder_bootstrap:true,authorize_invitation_send:true,batch_approval_reference:target.batch_approval_reference};
  await operator.query("UPDATE core.users SET name='SYNTHETIC changed after review' WHERE id=$1",[userId]);
  await assert.rejects(()=>bootstrap.applyPlan(operator,target,plan,approval,plan.sha256),/changed since/);checks++;
  await operator.query("UPDATE core.users SET name='SYNTHETIC retained name' WHERE id=$1",[userId]);
  const applied=await bootstrap.applyPlan(operator,target,plan,approval,plan.sha256);check(!applied.reused,'Existing mirrors reused through exact operator approval');
  const preserved=(await operator.query('SELECT c.name,c.password,e.password AS mirror,b.role_name::text FROM core.users c JOIN epdg.users e ON e.id=c.id JOIN core.user_branch_roles b ON b.user_id=c.id AND b.branch_id=1 WHERE c.id=$1',[userId])).rows[0];
  check(preserved.name==='SYNTHETIC retained name'&&preserved.password===oldHash&&preserved.mirror===oldHash&&preserved.role_name==='intern','Bootstrap preparation preserves names, credentials, branch and history');
  check((await operator.query('SELECT body FROM portal_access.resources WHERE id=$1',[history])).rows[0].body==='SYNTHETIC retained portfolio','Linked history preserved');
  for(const sql of ['INSERT INTO portal_bootstrap.approvals DEFAULT VALUES','UPDATE portal_bootstrap.invitations SET status=\'accepted\'','DELETE FROM portal_bootstrap.audit_events','UPDATE portal_access.scopes SET approved_by_user_id=NULL','SELECT portal_bootstrap.current_approval(NULL)']){await assert.rejects(()=>runtime.query(sql),/permission denied/);checks++;}
  await operator.query('BEGIN');
  await assert.rejects(()=>operator.query("UPDATE portal_access.scopes SET scope_id='1' WHERE operator_approval_id=$1",[plan.plan.id]),/does not match/);checks++;await operator.query('ROLLBACK');
  let token,mode='failed';const transport=async(message)=>{assert.equal(message.to,email);token=message.html.match(/#token=([A-Za-z0-9_-]{43})/)[1];if(mode==='unknown')throw new Error('SYNTHETIC uncertain transport');return mode==='failed'?{error:{message:'SYNTHETIC rejection'}}:{error:null,providerId:'SYNTHETIC-capture'};};
  const failed=await bootstrap.sendInvitation(operator,target,plan,approval,plan.sha256,{transport});check(failed.delivery_status==='failed','Provider failure recorded without activation');
  const newHash=await bcrypt.hash(c.learnerPassword,12);const accept=proof=>runtime.query('SELECT portal_bootstrap.accept_invitation($1,$2) AS accepted',[bootstrap.digest(proof),newHash]);
  check((await accept(token)).rows[0].accepted===false,'Failed delivery cannot activate');const oldToken=token;
  await operator.query("UPDATE portal_bootstrap.invitations SET sent_at=clock_timestamp()-interval '61 seconds' WHERE approval_id=$1",[plan.plan.id]);mode='unknown';
  check((await bootstrap.sendInvitation(operator,target,plan,approval,plan.sha256,{transport,resend:true})).delivery_status==='unknown','Timeout is uncertain rather than accepted/delivered');
  check((await accept(oldToken)).rows[0].accepted===false,'Resend rotates previous proof');
  // Hold the same organization lock after the function reads its old token,
  // rotate under that lock, then release: the proof must be rechecked after wait.
  await operator.query('BEGIN');await operator.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-founder-bootstrap:'||$1,0))",[String(orgId)]);
  const waiting=accept(token);await new Promise(r=>setTimeout(r,150));const rotated=crypto.randomBytes(32).toString('base64url');
  await operator.query('UPDATE portal_bootstrap.invitations SET token_hash=$2 WHERE approval_id=$1',[plan.plan.id,bootstrap.digest(rotated)]);await operator.query('COMMIT');
  check((await waiting).rows[0].accepted===false,'Token rotated while awaiting lock cannot activate');token=rotated;
  check((await accept(token)).rows[0].accepted===true,'Exact current proof confirms email and sets password');
  check((await operator.query('SELECT password FROM core.users WHERE id=$1',[userId])).rows[0].password!==oldHash,'Only successful acceptance replaces previous credential');
  const {PortalService}=require('../../dist/security/PortalService.js'),sessions=new PortalService();const signed=await sessions.login(email,c.learnerPassword,null);
  check(signed.user.id===userId&&signed.user.portal_roles.includes('founder_owner'),'Reused stable identity signs in with approved founder scope');
  const revokeApproval={plan_sha256:plan.sha256,approval_reference:'SYNTHETIC-emergency-disable',operator_reference:'SYNTHETIC-authorized-reviewer',authorize_emergency_disable:true,expires_at:new Date(Date.now()+3600e3).toISOString()};
  await bootstrap.revoke(operator,target,plan,revokeApproval,plan.sha256);
  await assert.rejects(()=>sessions.session(signed.token),e=>e.statusCode===401);checks++;
  check((await operator.query('SELECT active FROM portal_security.account_states WHERE user_id=$1',[userId])).rows[0].active===false,'Explicit emergency disable revokes founder access');
  const evidence={status:'passed',checks,coverage:['existing mirrored identity and history preserved','active identity cannot silently disable','review drift','runtime no bootstrap writes','scope provenance bound','failed/unknown SMTP','resend and lock-wait proof rotation','successful stable-ID login','fresh approved emergency disable'],production_changed:false,verified_at:new Date().toISOString()};
  fs.writeFileSync(path.resolve(__dirname,'../../../../../build-evidence/epdg-phase-three-20261114/bootstrap-existing-native.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await operator.end();await runtime.end();await require('../../dist/db').getPool().end();}
}
if(require.main===module)verify().catch(e=>{process.stderr.write('Existing founder review failed: '+e.message+'\n');process.exitCode=1;});
module.exports={verify};
