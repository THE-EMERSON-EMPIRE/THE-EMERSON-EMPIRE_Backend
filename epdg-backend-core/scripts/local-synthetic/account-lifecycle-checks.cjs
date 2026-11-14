'use strict';
// Supplemental lifecycle verification only for the isolated Phase Two fixture.
// Injected transports capture .invalid links in memory; no external mail is sent.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),bcrypt=require('bcrypt');
async function verifyAccountLifecycle({operator,runtime,config,founderId=1}){
 const {PortalService}=require('../../dist/security/PortalService.js');
 const {AccountManagementService}=require('../../dist/security/AccountManagementService.js');
 const {hashToken}=require('../../dist/security/primitives.js');
 const sessions=new PortalService();let checks=0;const coverage=[];
 const check=(value,message)=>{assert.ok(value,message);checks++;};
 const denied=async(action,status,message)=>{await assert.rejects(action,error=>error.status===status||error.statusCode===status,message);checks++;};
 const boundary=(await runtime.query('SELECT current_database() AS db,current_user AS role')).rows[0];
 assert.equal(boundary.db,'epdg_synthetic');assert.equal(boundary.role,'epdg_synthetic_app');
 assert.equal(process.env.EPDG_SYNTHETIC_MODE,'1');
 const migrations=[];
 for(const [schema,manifestPath] of [['portal_access','../../src/security/access-schema-manifest.json'],['portal_accounts','../../src/security/account-schema-manifest.json'],['portal_learning','../../src/learning/portable-schema-manifest.json']]){
  const manifest=require(manifestPath);const applied=(await operator.query(`SELECT version,sha256 FROM ${schema}.schema_migrations WHERE version=$1`,[manifest.version])).rows;
  check(applied.length===1&&applied[0].sha256===manifest.sha256,'Lifecycle fixture ledger matches '+schema+' reviewed checksum');
  migrations.push({schema,version:manifest.version,sha256:manifest.sha256});
 }
 const admin=await sessions.login('reviewer@epdg.invalid',config.reviewerPassword,null);
 assert.equal(admin.user.id,founderId);
 const prefix='lifecycle-'+crypto.randomBytes(4).toString('hex');
 const captures=[];let mode='accepted';
 const transport=async(message,options)=>{
  assert.ok(message.to.endsWith('.invalid'));assert.ok(options.idempotencyKey.startsWith('epdg-invitation/'));
  const token=message.html.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];assert.ok(token);
  captures.push({email:message.to,token,key:options.idempotencyKey});
  if(mode==='unknown')throw new Error('SYNTHETIC timeout after possible acceptance');
  return mode==='failed'?{error:{message:'SYNTHETIC transport rejection'}}:{error:null,providerId:'SYNTHETIC-'+captures.length};
 };
 const service=new AccountManagementService(sessions,transport);
 const lastToken=()=>captures.at(-1).token;
 const roles=[{role_code:'participant',scope_type:'self',scope_id:'self'},{role_code:'participant',scope_type:'group',scope_id:config.groupId}];
 async function approved(label){
  let {plan}=await service.propose(admin.token,{organization_id:1,email:prefix+'-'+label+'@epdg.invalid',name:'SYNTHETIC lifecycle '+label,roles});
  ({plan}=await service.review(admin.token,plan.id,'verify_onboarding',{expected_revision:Number(plan.revision),evidence_ref:'SYNTHETIC-CRM/'+prefix+'/'+label}));
  ({plan}=await service.review(admin.token,plan.id,'approve',{expected_revision:Number(plan.revision)}));
  return plan;
 }
 async function prepared(label){
  const approvedPlan=await approved(label);const {plan}=await service.provision(admin.token,approvedPlan.id,Number(approvedPlan.revision));
  check(plan.identity_action==='created','New synthetic identity created once');
  const repeated=await service.provision(admin.token,approvedPlan.id,Number(approvedPlan.revision));
  check(repeated.plan.user_id===plan.user_id,'Provision replay preserves stable user ID');
  const audits=(await operator.query("SELECT count(*)::int AS n FROM portal_accounts.audit_events WHERE plan_id=$1 AND event='account_created'",[plan.id])).rows[0].n;
  check(audits===1,'Provision replay does not duplicate creation event');
  const {invitation}=await service.prepare(admin.token,plan.user_id);return{plan,invitation};
 }
 const password=config.learnerPassword;
 const expired=await prepared('expired');await service.send(admin.token,expired.invitation.id);const expiredToken=lastToken();
 await operator.query("UPDATE portal_accounts.invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.invitation.id]);
 await denied(()=>service.accept(expiredToken,password),400,'Expired invitation cannot activate');coverage.push('expired invitation');
 const revoked=await prepared('revoked');await service.send(admin.token,revoked.invitation.id);const revokedToken=lastToken();
 await service.disable(admin.token,revoked.plan.user_id,'access_review');
 await denied(()=>service.accept(revokedToken,password),400,'Disabled invitation cannot activate');
 check((await operator.query('SELECT status FROM portal_accounts.invitations WHERE id=$1',[revoked.invitation.id])).rows[0].status==='revoked','Disable records invitation revocation');coverage.push('revoked invitation');
 const rotate=await prepared('rotate');await service.send(admin.token,rotate.invitation.id);const oldToken=lastToken(),oldKey=captures.at(-1).key;
 const countBefore=captures.length;const noRetry=await service.send(admin.token,rotate.invitation.id);
 check(noRetry.reused&&captures.length===countBefore,'Repeated send is idempotent and does not send mail');
 await denied(()=>service.send(admin.token,rotate.invitation.id,true),429,'Explicit resend cooldown enforced');
 await operator.query("UPDATE portal_accounts.invitations SET sent_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",[rotate.invitation.id]);
 await service.send(admin.token,rotate.invitation.id,true);const newToken=lastToken();
 check(newToken!==oldToken&&captures.at(-1).key!==oldKey,'Explicit resend rotates token and transport idempotency key');
 await denied(()=>service.accept(oldToken,password),400,'Old resend token denied');
 const accepted=await service.accept(newToken,password);check(accepted.activated&&accepted.sign_in_verified===false,'Activation does not claim a successful sign-in');
 await denied(()=>service.accept(newToken,password),400,'Consumed invitation cannot replay');
 let session=await sessions.login(rotate.plan.email,password,null);check(session.user.id===rotate.plan.user_id,'Accepted user signs in with stable ID');
 await operator.query("UPDATE portal_security.sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[hashToken(session.token)]);
 await denied(()=>sessions.session(session.token),401,'Absolute expiry denies an actual session');
 session=await sessions.login(rotate.plan.email,password,null);
 await operator.query("UPDATE portal_security.sessions SET last_seen_at=clock_timestamp()-interval '2 days' WHERE token_hash=$1",[hashToken(session.token)]);
 await denied(()=>sessions.session(session.token),401,'Idle expiry denies an actual session');
 session=await sessions.login(rotate.plan.email,password,null);await service.disable(admin.token,rotate.plan.user_id,'access_review');
 await denied(()=>sessions.session(session.token),401,'Account disable revokes actual session');
 await denied(()=>sessions.login(rotate.plan.email,password,null),401,'Disabled account cannot sign in');coverage.push('resend rotation, replay, real session absolute/idle expiry and disable');
 const failed=await prepared('failed');mode='failed';const failedSend=await service.send(admin.token,failed.invitation.id);const failedToken=lastToken();
 check(failedSend.invitation.delivery_status==='failed'&&failedSend.invitation.delivered_at===null,'Provider rejection is recorded without delivery claim');
 await denied(()=>service.accept(failedToken,password),400,'Explicitly rejected delivery cannot activate');
 check((await operator.query('SELECT last_error_code FROM portal_accounts.invitations WHERE id=$1',[failed.invitation.id])).rows[0].last_error_code==='provider_rejected','Rejection diagnostic is safe fixed code');
 await operator.query("UPDATE portal_accounts.invitations SET sent_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",[failed.invitation.id]);mode='accepted';await service.send(admin.token,failed.invitation.id,true);
 await denied(()=>service.accept(failedToken,password),400,'Failed attempt token remains invalid after explicit resend');
 check((await service.accept(lastToken(),password)).accepted,'Explicit successful resend can activate');coverage.push('injected provider rejection and explicit recovery');
 const uncertain=await prepared('unknown');mode='unknown';const uncertainSend=await service.send(admin.token,uncertain.invitation.id);const uncertainToken=lastToken();
 check(uncertainSend.invitation.delivery_status==='unknown'&&uncertainSend.invitation.delivered_at===null,'Timeout stays unknown without delivery claim');
 const uncertainCount=captures.length;check((await service.send(admin.token,uncertain.invitation.id)).reused&&captures.length===uncertainCount,'Unknown delivery is not automatically retried');
 check((await service.accept(uncertainToken,password)).accepted,'Possession can confirm an invitation whose transport acknowledgement was uncertain');coverage.push('injected uncertain delivery without duplicate send');
 mode='accepted';
 const existingId=Number((await operator.query('SELECT greatest(coalesce(max(id),0)+1,800001) AS id FROM core.users')).rows[0].id);
 const existingEmail=prefix+'-existing@epdg.invalid',oldPassword=await bcrypt.hash(config.learnerPassword+'old',12);
 await operator.query("INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,'SYNTHETIC preserved existing identity',$3,true)",[existingId,existingEmail,oldPassword]);
 await operator.query("INSERT INTO epdg.users(id,email,name,password,is_verified,role) VALUES($1,$2,'SYNTHETIC preserved existing identity',$3,true,'intern')",[existingId,existingEmail,oldPassword]);
 await operator.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,1,'intern');",[existingId]);
 await operator.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,false)',[existingId]);
 const historic=crypto.randomUUID();await operator.query("INSERT INTO portal_access.resources(id,organization_id,kind,subject_user_id,title,body) VALUES($1,1,'portfolio',$2,'SYNTHETIC retained portfolio','SYNTHETIC immutable history marker')",[historic,existingId]);
 const existingPlan=await approved('existing');const reused=(await service.provision(admin.token,existingPlan.id,Number(existingPlan.revision))).plan;
 check(reused.user_id===existingId&&reused.identity_action==='reused','Existing identity is reused rather than duplicated');
 const identity=(await operator.query('SELECT c.id,c.name,c.password,e.password AS mirror_password FROM core.users c JOIN epdg.users e ON e.id=c.id WHERE c.id=$1',[existingId])).rows[0];
 check(identity.name==='SYNTHETIC preserved existing identity'&&identity.password===oldPassword&&identity.mirror_password===oldPassword,'Reconciliation preserves existing name and both password hashes');
 check((await operator.query('SELECT body,subject_user_id FROM portal_access.resources WHERE id=$1',[historic])).rows[0].body==='SYNTHETIC immutable history marker','Reconciliation preserves existing linked history');
 check((await operator.query('SELECT count(*)::int AS n FROM core.users WHERE lower(email)=$1',[existingEmail])).rows[0].n===1,'Reconciliation keeps one canonical user');
 const conflictEmail=prefix+'-conflict@epdg.invalid',conflictId=existingId+1;
 await operator.query("INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,'SYNTHETIC unpaired identity',$3,true)",[conflictId,conflictEmail,oldPassword]);
 const conflict=(await service.propose(admin.token,{organization_id:1,email:conflictEmail,name:'SYNTHETIC conflict',roles})).plan;
 check(conflict.status==='blocked'&&Boolean(conflict.conflict_code),'Unpaired identity becomes blocked reconciliation');
 await denied(()=>service.provision(admin.token,conflict.id,Number(conflict.revision)),409,'Conflicting identity is never duplicated or automatically merged');
 check((await operator.query('SELECT count(*)::int AS n FROM epdg.users WHERE id=$1',[conflictId])).rows[0].n===0,'Conflict does not manufacture missing mirror');coverage.push('provision replay, existing identity and history preservation, duplicate/mirror conflict');
 // Historical whitespace is tested in a rollback-only operator transaction.
 // Relaxing the synthetic CHECK is never committed and never admits real mail.
 await operator.query('BEGIN');
 try{
  await operator.query('ALTER TABLE core.users DROP CONSTRAINT synthetic_email_only; ALTER TABLE epdg.users DROP CONSTRAINT synthetic_email_only');
  const normalized=prefix+'-normalized@epdg.invalid';
  await operator.query("INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,'SYNTHETIC whitespace identity',$3,true)",[existingId+10,' '+normalized.toUpperCase()+' ',oldPassword]);
  await operator.query("INSERT INTO epdg.users(id,email,name,password,is_verified,role) VALUES($1,$2,'SYNTHETIC whitespace mirror',$3,true,'intern')",[existingId+10,normalized,oldPassword]);
  check((await operator.query('SELECT portal_accounts.identity_conflict($1) AS code',[normalized])).rows[0].code===null,'Single historical whitespace/case pair resolves to the same identity');
  await operator.query("INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,'SYNTHETIC normalized duplicate',$3,true)",[existingId+11,normalized,oldPassword]);
  check((await operator.query('SELECT portal_accounts.identity_conflict($1) AS code',[normalized])).rows[0].code==='duplicate_email','Whitespace/case duplicate is blocked rather than silently duplicated');
  await operator.query('DELETE FROM core.users WHERE id=$1',[existingId+11]);
  await operator.query('UPDATE epdg.users SET id=$1 WHERE id=$2',[existingId+12,existingId+10]);
  check((await operator.query('SELECT portal_accounts.identity_conflict($1) AS code',[normalized])).rows[0].code==='identity_mirror_conflict','Different stable mirror IDs require manual reconciliation');
  await operator.query('UPDATE epdg.users SET id=$1 WHERE id=$2',[existingId+10,existingId+12]);
  await operator.query('UPDATE core.users SET deleted_at=clock_timestamp() WHERE id=$1',[existingId+10]);
  check((await operator.query('SELECT portal_accounts.identity_conflict($1) AS code',[normalized])).rows[0].code==='inactive_or_rejected_identity','Deleted historical identity cannot be silently revived');
 }finally{await operator.query('ROLLBACK');}
 coverage.push('normalized whitespace/case duplicate, mismatched mirror ID and deleted identity');
 const secondAdmin=await sessions.login('reviewer@epdg.invalid',config.reviewerPassword,null);
 try{
  const input={organization_id:1,email:prefix+'-concurrent@epdg.invalid',name:'SYNTHETIC concurrent lifecycle',roles};
  const proposed=await Promise.all([service.propose(admin.token,input),service.propose(secondAdmin.token,input)]);
  check(proposed[0].plan.id===proposed[1].plan.id,'Concurrent separate-session proposals preserve one plan');
  let concurrent=proposed[0].plan;
  ({plan:concurrent}=await service.review(admin.token,concurrent.id,'verify_onboarding',{expected_revision:Number(concurrent.revision),evidence_ref:'SYNTHETIC-CRM/'+prefix+'/concurrent'}));
  ({plan:concurrent}=await service.review(admin.token,concurrent.id,'approve',{expected_revision:Number(concurrent.revision)}));
  const provisioned=await Promise.all([service.provision(admin.token,concurrent.id,Number(concurrent.revision)),service.provision(secondAdmin.token,concurrent.id,Number(concurrent.revision))]);
  check(provisioned[0].plan.user_id===provisioned[1].plan.user_id,'Concurrent approved provision preserves one stable user');
  check((await operator.query("SELECT count(*)::int AS n FROM portal_accounts.audit_events WHERE plan_id=$1 AND event='account_created'",[concurrent.id])).rows[0].n===1,'Concurrent provision records creation once');
  check((await operator.query('SELECT count(*)::int AS n FROM core.users WHERE lower(btrim(email))=$1',[input.email])).rows[0].n===1,'Concurrent provisioning cannot duplicate identity');
  const concurrentInvite=(await service.prepare(admin.token,provisioned[0].plan.user_id)).invitation;
  const beforeSend=captures.length;
  const sends=await Promise.all([service.send(admin.token,concurrentInvite.id),service.send(secondAdmin.token,concurrentInvite.id)]);
  check(captures.length===beforeSend+1&&sends.filter(result=>result.reused).length===1,'Concurrent dispatch sends once and reports reuse once');
  const concurrentToken=lastToken();
  const acceptances=await Promise.allSettled([service.accept(concurrentToken,password),service.accept(concurrentToken,password)]);
  check(acceptances.filter(result=>result.status==='fulfilled').length===1,'Concurrent acceptance activates exactly once');
  check(acceptances.filter(result=>result.status==='rejected'&&result.reason.statusCode===400).length===1,'Second concurrent acceptance is a consumed-token rejection');
  check((await operator.query("SELECT count(*)::int AS n FROM portal_accounts.audit_events WHERE invitation_id=$1 AND event='invitation_accepted_and_account_activated'",[concurrentInvite.id])).rows[0].n===1,'Concurrent acceptance has one activation audit');
  const priorName=(await sessions.session(admin.token)).user.name;
  try{
   const updated=await Promise.all([service.profile(admin.token,'SYNTHETIC concurrent profile one'),service.profile(admin.token,'SYNTHETIC concurrent profile two')]);
   check(updated.length===2&&updated.every(value=>value.id===founderId),'Concurrent same-session profile writes complete without lock upgrade deadlock');
   const profile=(await operator.query('SELECT c.name,e.name AS mirror FROM core.users c JOIN epdg.users e ON e.id=c.id WHERE c.id=$1',[founderId])).rows[0];
   check(profile.name===profile.mirror&&['SYNTHETIC concurrent profile one','SYNTHETIC concurrent profile two'].includes(profile.name),'Concurrent profile writes preserve mirrored names');
  }finally{await service.profile(admin.token,priorName);}
 }finally{await sessions.logout(secondAdmin.token);}
 coverage.push('concurrent separate-session propose/provision/send/accept and same-session profile writes');
 await sessions.logout(admin.token);
 return{checks,coverage,migrations};
}
module.exports={verifyAccountLifecycle};
if(require.main===module)(async()=>{
 const fixture=require('./account-release-review.cjs'),config=fixture.load();Object.assign(process.env,fixture.environment(config));
 const operator=await fixture.db(config),runtime=await fixture.db(config,'runtime');
 try{
  const result=await verifyAccountLifecycle({operator,runtime,config});
  const fs=require('node:fs'),path=require('node:path'),workspace=path.resolve(__dirname,'../../../../..');
  const evidence={status:'passed',...result,verified_at:new Date().toISOString(),production_changed:false};
  fs.writeFileSync(path.join(workspace,'build-evidence/epdg-phase2-20261114/account-lifecycle-native.json'),JSON.stringify(evidence,null,2));
  process.stdout.write(JSON.stringify(evidence)+'\n');
 }
 finally{await operator.end();await runtime.end();await require('../../dist/db').getPool().end();}
})().catch(error=>{process.stderr.write('Synthetic lifecycle verification failed: '+error.message+'\n');process.exitCode=1;});
