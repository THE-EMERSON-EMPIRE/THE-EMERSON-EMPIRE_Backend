'use strict';
// Dedicated, disposable local PostgreSQL + Mailpit fixture. Never connects to an
// existing database or reads production environment files. No automatic teardown.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const net=require('node:net');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const bcrypt=require('bcrypt');
const {runtimeEnv}=require('./common.cjs');
const core=path.resolve(__dirname,'../..');
const backend=path.dirname(core);
const workspace=path.resolve(backend,'../..');
const stateFile=path.join(backend,'.local-synthetic','invitation-review.json');
const pgBin=process.env.EPDG_REVIEW_PG_BIN||path.join(workspace,'.tools/postgresql-17.11/pgsql/bin');
const mailBin=process.env.EPDG_REVIEW_MAILPIT||path.join(workspace,'.tools/mailpit-v1.31.6/mailpit.exe');
const exe=name=>path.join(pgBin,name+(process.platform==='win32'?'.exe':''));
const secret=()=>crypto.randomBytes(32).toString('base64url');
const load=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const environment=c=>({...runtimeEnv(c),EPDG_ADMIN_STAGING_MODE:'1',EPDG_INVITATION_REVIEW_MODE:'1'});
function run(binary,args){const r=spawnSync(binary,args,{windowsHide:true,stdio:'ignore',timeout:60000});if(r.status!==0)throw new Error('Local fixture process failed: '+path.basename(binary));}
function background(binary,args,env,log){const fd=fs.openSync(log,'a');const child=spawn(binary,args,{windowsHide:true,detached:true,env,stdio:['ignore',fd,fd]});child.unref();fs.closeSync(fd);return child.pid;}
async function free(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(new Error('Fixture port is already in use: '+port)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
async function db(c,database='epdg_synthetic'){const client=new Client({host:'127.0.0.1',port:55432,user:'epdg_review_operator',password:c.adminPassword,database,connectionTimeoutMillis:5000});await client.connect();return client;}
async function ready(url){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Local fixture did not start');}
async function setup(){
  if(fs.existsSync(stateFile))throw new Error('Review fixture already exists; use verify or inspect its private state file');
  for(const port of [55432,51025,58025,58000])await free(port);
  const directory=path.join(backend,'.local-synthetic','invitation-'+Date.now());fs.mkdirSync(directory,{recursive:true});
  const c={instanceId:crypto.randomUUID(),appPassword:secret(),adminPassword:secret(),jwtSecret:secret(),certificateSecret:secret(),csrfSecret:secret(),reviewerPassword:secret(),learnerPassword:secret(),directory};
  const pw=path.join(directory,'init-password');fs.writeFileSync(pw,c.adminPassword,{mode:0o600});
  run(exe('initdb'),['-D',path.join(directory,'pgdata'),'-U','epdg_review_operator','--pwfile',pw,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);fs.unlinkSync(pw);
  run(exe('pg_ctl'),['-D',path.join(directory,'pgdata'),'-l',path.join(directory,'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start']);
  let client=await db(c,'postgres');
  await client.query('CREATE DATABASE epdg_synthetic');
  await client.query(`CREATE ROLE epdg_synthetic_app LOGIN BYPASSRLS PASSWORD '${c.appPassword}'`);await client.end();
  client=await db(c);
  try{
    await client.query(fs.readFileSync(path.join(__dirname,'baseline.sql'),'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname,'isolation.sql'),'utf8'));
    await client.query('CREATE SCHEMA synthetic_meta');
    for(const [manifestFile,folder,ledger] of [['schema-manifest.json','security-migrations','portal_security'],['admin-schema-manifest.json','admin-migrations','portal_security'],['invitation-schema-manifest.json','invitation-review-migrations','portal_invitation_review']]){
      const m=require(path.join(core,'src/security',manifestFile));const sql=fs.readFileSync(path.join(core,folder,m.file),'utf8');
      assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),m.sha256);await client.query(sql);
      // Verify migration reruns preserve schema and records, then pin the ledger.
      await client.query(sql);await client.query(`INSERT INTO ${ledger}.schema_migrations(version,sha256) VALUES($1,$2)`,[m.version,m.sha256]);
    }
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE epdg_synthetic FROM PUBLIC;
      GRANT USAGE ON SCHEMA core,epdg,portal_security TO epdg_synthetic_app;
      GRANT SELECT ON ALL TABLES IN SCHEMA core,epdg,portal_security TO epdg_synthetic_app;
      GRANT UPDATE(password) ON core.users,epdg.users TO epdg_synthetic_app;
      GRANT UPDATE(revision) ON portal_security.account_states TO epdg_synthetic_app;
      GRANT INSERT,UPDATE ON portal_security.sessions,portal_security.recovery_tokens TO epdg_synthetic_app;
      GRANT INSERT ON portal_security.audit_events,portal_security.role_assignments,portal_security.admin_events TO epdg_synthetic_app;`);
    await client.query("INSERT INTO core.branches(id,code,name) VALUES(1,'epdg','SYNTHETIC education')");
    const password=await bcrypt.hash(c.reviewerPassword,12);
    for(const [id,label,role,active] of [[1,'reviewer','admin',true],[2,'learner-a','intern',false],[3,'learner-b','intern',true],[4,'school','school',true],[5,'held','intern',false],[6,'expired','intern',false],[7,'browser','intern',false]]){
      const email=label+'@epdg.invalid',name='SYNTHETIC '+label;
      await client.query('INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,$3,$4,true)',[id,email,name,password]);
      await client.query('INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES($1,$2,$3,$4,$5,true)',[id,email,name,password,role]);
      await client.query('INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,1,$2)',[id,role]);
      await client.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,$2)',[id,active]);
    }
    await client.query("INSERT INTO epdg.schools(id,user_id,school_name,email,is_approved,is_verified) VALUES(1,4,'SYNTHETIC school','school@epdg.invalid',true,true)");
    await client.query("INSERT INTO epdg.admins(user_id) VALUES(1); INSERT INTO portal_security.role_assignments(user_id,role_code,status) VALUES(1,'founder_admin','active')");
    for(const id of [2,3,5,6,7]){
      await client.query('INSERT INTO epdg.intern_profiles(user_id,school_id,is_approved) VALUES($1,1,true)',[id]);
      await client.query('INSERT INTO portal_security.memberships(user_id,school_id,active) VALUES($1,1,true)',[id]);
      await client.query("INSERT INTO portal_invitation_review.candidates(user_id,verified_onboarding,enabled,approval_reference) VALUES($1,$2,true,'SYNTHETIC verified fixture handoff')",[id,id!==5]);
    }
  }finally{await client.end();}
  fs.writeFileSync(stateFile,JSON.stringify(c,null,2),{mode:0o600});
  c.mailPid=background(mailBin,['--smtp','127.0.0.1:51025','--listen','127.0.0.1:58025','--database',path.join(directory,'mail.db')],process.env,path.join(directory,'mailpit.log'));
  await ready('http://127.0.0.1:58025/readyz');
  c.apiPid=background(process.execPath,[__filename,'serve'],environment(c),path.join(directory,'api.log'));
  fs.writeFileSync(stateFile,JSON.stringify(c,null,2),{mode:0o600});
  await ready('http://127.0.0.1:58000/health');
  process.stdout.write('Local synthetic review API and Mailpit ready; private fixture details saved in .local-synthetic/invitation-review.json\n');
}
async function serve(){
  const c=load();const reviewEnv=environment(c);for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,reviewEnv);
  const {checkSecuritySchema}=require('../../dist/security/PortalService.js');await checkSecuritySchema();
  const {createApp}=require('../../dist/app.js');createApp({readinessCheck:checkSecuritySchema}).listen(58000,'127.0.0.1');
}
async function verify(){
  const c=load();let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++;};
  const origin='http://127.0.0.1:58080';const base='http://127.0.0.1:58000/api';
  async function request(route,body,session,extra={}){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'X-EPDG-Request':'portal',...(body===undefined?{}:{'Content-Type':'application/json'}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  async function login(email,password){const r=await request('/auth/login',{email,password});check(r.status===200,'Login must succeed');return{cookie:r.cookie,csrf:r.body.csrf_token};}
  async function mailToken(email,subject){for(let i=0;i<30;i++){const list=await (await fetch('http://127.0.0.1:58025/api/v1/messages')).json();for(const row of list.messages||[]){if(row.Subject!==subject||!row.To?.some(t=>t.Address===email))continue;const detail=await(await fetch('http://127.0.0.1:58025/api/v1/message/'+row.ID)).json();const token=detail.HTML.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];if(token)return token;}await new Promise(r=>setTimeout(r,100));}throw new Error('Synthetic email was not captured');}
  const admin=await login('reviewer@epdg.invalid',c.reviewerPassword);
  const learner=await login('learner-b@epdg.invalid',c.reviewerPassword);
  check((await request('/admin/invitations',undefined,learner)).status===403,'Participant cannot list other accounts');
  check((await request('/admin/invitations',{user_id:2,role_code:'founder_owner'},admin)).status===403,'No privileged self-selection');
  check((await request('/admin/invitations',{user_id:5,role_code:'participant'},admin)).status===409,'Unverified onboarding is denied');
  check((await request('/admin/invitations',{user_id:2,role_code:'participant'},admin,{'X-CSRF-Token':'wrong'})).status===403,'CSRF rejected');
  check((await request('/admin/invitations',{user_id:2,role_code:'participant'},admin,{Origin:'https://wrong.invalid'})).status===403,'Origin rejected');
  const parallel=await Promise.all([1,2].map(()=>request('/admin/invitations',{user_id:2,role_code:'participant'},admin)));
  check(parallel.every(r=>r.status===200),'Concurrent issuance succeeds idempotently');
  check(parallel[0].body.data.invitation.id===parallel[1].body.data.invitation.id,'Single invitation record reused');
  const token=await mailToken('learner-a@epdg.invalid','EPDG portal invitation');
  check(!JSON.stringify(parallel).includes(token),'Token absent from API responses');
  check((await request('/auth/login',{email:'learner-a@epdg.invalid',password:c.reviewerPassword})).status===401,'Inactive account cannot login');
  const accepted=await request('/auth/accept-invitation',{token,password:c.learnerPassword});check(accepted.status===200&&!accepted.cookie,'Acceptance confirms email without auto-login');
  check((await request('/auth/accept-invitation',{token,password:c.learnerPassword})).status===400,'Token cannot replay');
  check((await request('/auth/accept-invitation',{token:'x'.repeat(43),password:c.learnerPassword})).status===400,'Unknown token rejected');
  const active=await login('learner-a@epdg.invalid',c.learnerPassword);
  check((await request('/admin/invitations',{user_id:2,role_code:'participant'},admin)).body.data.reused,'Accepted identity remains idempotent');
  check((await request('/auth/session',undefined,active)).body.user.id===2,'Stable identity retained');
  check((await request('/admin/users',undefined,active)).status===403,'Participant cannot access HR/admin records');
  check((await request('/auth/forgot-password',{email:'learner-a@epdg.invalid'})).status===200,'Recovery request supported');
  const recovery=await mailToken('learner-a@epdg.invalid','EPDG portal password recovery');
  check((await request('/auth/reset-password',{token:recovery,password:c.learnerPassword+'X'})).status===200,'Recovery token accepted');
  check((await request('/auth/session',undefined,active)).status===401,'Recovery revokes old session');
  const reset=await login('learner-a@epdg.invalid',c.learnerPassword+'X');
  check((await request('/auth/logout',{},reset)).status===200,'Logout succeeds');
  check((await request('/auth/session',undefined,reset)).status===401,'Logged-out session denied');
  const expired=await request('/admin/invitations',{user_id:6,role_code:'participant'},admin);check(expired.status===200,'Expiry fixture issued');
  const expiredToken=await mailToken('expired@epdg.invalid','EPDG portal invitation');
  const client=await db(c);
  try{
    await client.query("UPDATE portal_invitation_review.invitations SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE user_id=6");
    check((await request('/auth/accept-invitation',{token:expiredToken,password:c.learnerPassword})).status===400,'Expired token rejected');
    const resend=await request('/admin/invitations/'+expired.body.data.invitation.id+'/resend',{},admin);check(resend.status===200,'Expired invitation can resend');
    const rows=(await client.query('SELECT count(*)::int AS count FROM core.users')).rows;check(rows[0].count===7,'No duplicate identity created');
    const protection=(await client.query("SELECT has_column_privilege('epdg_synthetic_app','portal_security.account_states','active','UPDATE') AS admin,has_any_column_privilege('epdg_synthetic_app','portal_invitation_review.candidates','INSERT,UPDATE') AS approves,has_table_privilege('epdg_synthetic_app','portal_invitation_review.events','UPDATE,DELETE') AS edits_audit")).rows[0];
    check(!protection.admin&&!protection.approves&&!protection.edits_audit,'Runtime cannot activate directly, invent onboarding approval, or edit audit');
  }finally{await client.end();}
  const browser=await request('/admin/invitations',{user_id:7,role_code:'participant'},admin);check(browser.status===200,'Browser fixture ready');
  const browserToken=await mailToken('browser@epdg.invalid','EPDG portal invitation');
  fs.writeFileSync(path.join(c.directory,'browser-review.json'),JSON.stringify({reviewerEmail:'reviewer@epdg.invalid',reviewerPassword:c.reviewerPassword,participantEmail:'browser@epdg.invalid',participantPassword:c.learnerPassword,acceptanceUrl:origin+'/accept-invitation#token='+browserToken},null,2),{mode:0o600});
  const evidence={status:'passed',checks,verified_at:new Date().toISOString(),coverage:['native PostgreSQL migrations twice','Mailpit SMTP delivery','concurrent idempotence','email confirmation','invitation replay and expiry','role escalation denial','onboarding approval denial','stable identity','login/logout','recovery and session revocation','CSRF/origin denial','runtime privilege checks'],production_changed:false};
  fs.writeFileSync(path.join(workspace,'build-evidence/epdg-invitation-native-20261114.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
}
async function edges(){
  const c=load();const reviewEnv=environment(c);for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,reviewEnv);
  const offset=Number(process.argv[3]||0);if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid fixture offset');
  const id=n=>n+offset;const email=n=>'edge-'+id(n)+'@epdg.invalid';
  const {PortalService}=require('../../dist/security/PortalService.js');
  const {InvitationService}=require('../../dist/security/InvitationService.js');
  const {deliverEmail}=require('../../dist/utils/mailDelivery.js');
  const {getPool}=require('../../dist/db/index.js');
  const sessions=new PortalService();const login=await sessions.login('reviewer@epdg.invalid',c.reviewerPassword,null);
  const tokens=new Map();
  const capture=message=>{tokens.set(message.to,message.html.match(/#token=([A-Za-z0-9_-]{43})/)[1]);};
  const service=new InvitationService(sessions,async message=>{capture(message);return deliverEmail(message);});
  const fail=new InvitationService(sessions,async message=>{capture(message);return{error:{message:'SYNTHETIC provider failure'}};});
  const operator=await db(c);let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++;};
  try{
    for(const id of [8,9,10,11,12].map(n=>n+offset)){
      const hash=await bcrypt.hash(secret(),12);const email='edge-'+id+'@epdg.invalid';
      await operator.query('INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,$3,$4,true)',[id,email,'SYNTHETIC edge '+id,hash]);
      await operator.query("INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES($1,$2,$3,$4,'intern',true)",[id,email,'SYNTHETIC edge '+id,hash]);
      await operator.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES($1,1,'intern')",[id]);
      await operator.query('INSERT INTO portal_security.account_states(user_id) VALUES($1)',[id]);
      await operator.query('INSERT INTO epdg.intern_profiles(user_id,school_id,is_approved) VALUES($1,1,true)',[id]);
      await operator.query('INSERT INTO portal_security.memberships(user_id,school_id,active) VALUES($1,1,true)',[id]);
      await operator.query("INSERT INTO portal_invitation_review.candidates(user_id,verified_onboarding,enabled,approval_reference) VALUES($1,true,true,'SYNTHETIC edge fixture approval')",[id]);
    }
    await service.invite(login.token,id(8),'participant');const concurrentToken=tokens.get(email(8));
    const concurrent=await Promise.allSettled([service.accept(concurrentToken,c.learnerPassword),service.accept(concurrentToken,c.learnerPassword)]);
    check(concurrent.filter(r=>r.status==='fulfilled').length===1,'Concurrent accept grants exactly once');
    await service.invite(login.token,id(9),'participant');
    await operator.query('UPDATE core.users SET password=$1 WHERE id=$2',[await bcrypt.hash(secret(),12),id(9)]);
    await assert.rejects(()=>service.accept(tokens.get(email(9)),c.learnerPassword),/Invalid or expired/);checks++;
    await service.invite(login.token,id(10),'participant');await operator.query('UPDATE portal_security.account_states SET revision=revision+1 WHERE user_id=$1',[id(10)]);
    await assert.rejects(()=>service.accept(tokens.get(email(10)),c.learnerPassword),/Invalid or expired/);checks++;
    const failed=await fail.invite(login.token,id(11),'participant');const failedToken=tokens.get(email(11));
    check(failed.invitation.delivery_status==='failed','Provider failure recorded separately from generation');
    await assert.rejects(()=>service.accept(failedToken,c.learnerPassword),/Invalid or expired/);checks++;
    await operator.query("UPDATE portal_invitation_review.invitations SET created_at=clock_timestamp()-interval '2 minutes' WHERE user_id=$1",[id(11)]);
    const resent=await service.resend(login.token,failed.invitation.id);check(resent.invitation.delivery_status==='sent','Explicit resend succeeds');
    await assert.rejects(()=>service.accept(failedToken,c.learnerPassword),/Invalid or expired/);checks++;
    const replacement=tokens.get(email(11));check(replacement!==failedToken,'Resend rotates token');await service.accept(replacement,c.learnerPassword);checks++;
    await service.invite(login.token,id(12),'participant');await operator.query('UPDATE portal_invitation_review.candidates SET enabled=false WHERE user_id=$1',[id(12)]);
    await assert.rejects(()=>service.accept(tokens.get(email(12)),c.learnerPassword),/Invalid or expired/);checks++;
    const nullResult=await operator.query('SELECT portal_invitation_review.accept(NULL,NULL) AS accepted');check(nullResult.rows[0].accepted===false,'NULL inputs fail closed');
    const roles=await operator.query('SELECT count(*)::int AS total FROM portal_security.role_assignments');check(roles.rows[0].total===1,'Invitations create no role assignments');
    const disabling=await sessions.login(email(8),c.learnerPassword,null);await sessions.requestRecovery(email(8));
    const stopped=spawnSync(process.execPath,[__filename,'disable',String(id(8))],{windowsHide:true,encoding:'utf8'});check(stopped.status===0,'Authenticated operator disables participant');
    await assert.rejects(()=>sessions.session(disabling.token),/Authentication required/);checks++;
    await assert.rejects(()=>sessions.login(email(8),c.learnerPassword,null),/Invalid email or password/);checks++;
    const revoked=await operator.query('SELECT count(*)::int AS total FROM portal_security.recovery_tokens WHERE user_id=$1 AND revoked_at IS NULL',[id(8)]);check(revoked.rows[0].total===0,'Disable revokes recovery');
    const blocked=spawnSync(process.execPath,[__filename,'disable','1'],{windowsHide:true,encoding:'utf8'});check(blocked.status!==0,'CLI cannot target reviewer/privileged account');
    const pending=spawnSync(process.execPath,[__filename,'disable',String(id(10))],{windowsHide:true,encoding:'utf8'});check(pending.status===0,'Pending candidate can be disabled');
    const status=await operator.query("SELECT status FROM portal_invitation_review.invitations WHERE user_id=$1",[id(10)]);check(status.rows.every(row=>row.status==='revoked'),'Disable revokes pending invitation');
    const audit=await operator.query("SELECT count(*)::int AS total FROM portal_invitation_review.operator_events WHERE event='access_disabled' AND user_id=ANY($1::integer[])",[[id(8),id(10)]]);check(audit.rows[0].total===2,'Operator action audit retained');
    const evidence={status:'passed',checks,verified_at:new Date().toISOString(),coverage:['concurrent one-time acceptance','credential binding','account revision binding','delivery failure tracking','failed-token rejection','explicit resend token rotation','approval withdrawal','NULL proof/password rejection','no role grants','authenticated bounded operator disable','disabled sessions/recovery/invitations','operator audit'],production_changed:false};
    fs.writeFileSync(path.join(workspace,'build-evidence/epdg-invitation-native-edges-20261114.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
  }finally{await operator.end();await getPool().end();}
}
async function disable(){
  const target=Number(process.argv[3]);if(!Number.isSafeInteger(target)||target<1)throw new Error('A reviewed stable synthetic participant id is required');
  const c=load();require('../../dist/security/invitationPolicy.js').requireInvitationReview(environment(c));
  const operator=await db(c);
  try{
    await operator.query('BEGIN');
    const identity=(await operator.query("SELECT current_user='epdg_review_operator' AND current_database()='epdg_synthetic' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55432 AS allowed")).rows[0];
    if(identity.allowed!==true)throw new Error('Local operator boundary did not match');
    const candidate=(await operator.query(`SELECT cu.id FROM core.users cu JOIN epdg.users eu ON eu.id=cu.id
      JOIN portal_security.account_states st ON st.user_id=cu.id JOIN portal_invitation_review.candidates c ON c.user_id=cu.id
      JOIN core.user_branch_roles r ON r.user_id=cu.id JOIN core.branches b ON b.id=r.branch_id AND b.code='epdg'
      WHERE cu.id=$1 AND cu.email LIKE '%@epdg.invalid' AND cu.name LIKE 'SYNTHETIC %' AND cu.email=eu.email
        AND r.role_name::text='intern' AND NOT EXISTS(SELECT 1 FROM portal_security.role_assignments a WHERE a.user_id=cu.id AND a.status='active')
      FOR UPDATE OF st,c`,[target])).rows;
    if(candidate.length!==1)throw new Error('Reviewed synthetic participant was not found');
    await operator.query('UPDATE portal_invitation_review.candidates SET enabled=false WHERE user_id=$1',[target]);
    await operator.query('UPDATE portal_security.account_states SET active=false WHERE user_id=$1',[target]);
    await operator.query("UPDATE portal_invitation_review.invitations SET status='revoked' WHERE user_id=$1 AND status='pending'",[target]);
    await operator.query("UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=$1 AND revoked_at IS NULL",[target]);
    await operator.query('UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[target]);
    await operator.query("INSERT INTO portal_invitation_review.operator_events(user_id,event,operator_role) VALUES($1,'access_disabled',current_user)",[target]);
    await operator.query('COMMIT');process.stdout.write('Reviewed synthetic participant access disabled and audited.\n');
  }catch(error){await operator.query('ROLLBACK');throw error;}finally{await operator.end();}
}
({setup,serve,verify,edges,disable}[process.argv[2]]||(()=>{throw new Error('Use setup, verify, edges, serve, or disable <stable-user-id>');}))().catch(error=>{process.stderr.write('Invitation review failed: '+error.message+'\n');process.exitCode=1;});
