'use strict';
// Dedicated disposable cluster, least-privilege runtime and Mailpit. Never reads
// production configuration, attaches to an existing cluster, or sends real mail.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process'),{Client}=require('pg'),bcrypt=require('bcrypt');
const {runtimeEnv}=require('./common.cjs');
const {applyMigrations}=require('../account-release/migrate.cjs');
const core=path.resolve(__dirname,'../..'),backend=path.dirname(core),workspace=path.resolve(backend,'../..');
const stateFile=path.join(backend,'.local-synthetic/account-release-review.json');
const pgBin=path.join(workspace,'.tools/postgresql-17.11/pgsql/bin'),mailBin=path.join(workspace,'.tools/mailpit-v1.31.6/mailpit.exe');
const exe=name=>path.join(pgBin,name+(process.platform==='win32'?'.exe':'')),secret=()=>crypto.randomBytes(32).toString('base64url');
const load=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const environment=c=>({...runtimeEnv(c),EPDG_ACCOUNT_MANAGEMENT_ENABLED:'1',EPDG_ACCOUNT_TARGET_ID:'SYNTHETIC-phase-two-target',EPDG_ACCOUNT_RELEASE_APPROVAL:'SYNTHETIC-release-approval',EPDG_INVITATION_DELIVERY_ENABLED:'1',EPDG_INVITATION_BATCH_APPROVAL:'SYNTHETIC-mail-batch',PORTAL_MAIL_REPLY_TO:'support@epdg.invalid'});
function useEnvironment(c){const env=environment(c);for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);}
function run(binary,args){const r=spawnSync(binary,args,{windowsHide:true,stdio:'ignore',timeout:60000});if(r.status!==0)throw new Error('Fixture operation failed: '+path.basename(binary));}
function background(binary,args,env,log){const fd=fs.openSync(log,'a');const child=spawn(binary,args,{windowsHide:true,detached:true,env,stdio:['ignore',fd,fd]});child.unref();fs.closeSync(fd);return child.pid;}
async function free(port){await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});}
async function db(c,role='operator',database='epdg_synthetic'){
 const user=role==='bootstrap'?'epdg_fixture_bootstrap':role==='runtime'?'epdg_synthetic_app':'epdg_review_operator';
 const password=role==='bootstrap'?c.bootstrapPassword:role==='runtime'?c.appPassword:c.adminPassword;
 const client=new Client({host:'127.0.0.1',port:55432,user,password,database,connectionTimeoutMillis:5000,statement_timeout:15000});await client.connect();return client;
}
async function ready(url){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Fixture readiness failed; inspect private logs');}
async function setup(){
 if(fs.existsSync(stateFile))throw new Error('A Phase Two fixture already exists; inspect its state rather than replacing it');
 for(const p of [55432,51025,58025,58000])await free(p);
 const directory=path.join(backend,'.local-synthetic','account-release-'+Date.now());fs.mkdirSync(directory,{recursive:true});
 const c={instanceId:crypto.randomUUID(),directory,bootstrapPassword:secret(),adminPassword:secret(),appPassword:secret(),jwtSecret:secret(),certificateSecret:secret(),csrfSecret:secret(),reviewerPassword:secret(),learnerPassword:secret(),origin:'http://127.0.0.1:58080'};
 const pw=path.join(directory,'init-password');fs.writeFileSync(pw,c.bootstrapPassword,{mode:0o600});
 run(exe('initdb'),['-D',path.join(directory,'pgdata'),'-U','epdg_fixture_bootstrap','--pwfile',pw,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);fs.unlinkSync(pw);
 run(exe('pg_ctl'),['-D',path.join(directory,'pgdata'),'-l',path.join(directory,'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start']);
 fs.writeFileSync(stateFile,JSON.stringify(c,null,2),{mode:0o600});
 const bootstrap=await db(c,'bootstrap','postgres');
 try{
  await bootstrap.query(`CREATE ROLE epdg_review_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${c.adminPassword}'`);
  await bootstrap.query(`CREATE ROLE epdg_synthetic_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${c.appPassword}'`);
  await bootstrap.query('CREATE DATABASE epdg_synthetic OWNER epdg_review_operator');
  c.failureDatabase='epdg_failure_'+Date.now();await bootstrap.query(`CREATE DATABASE ${c.failureDatabase} OWNER epdg_review_operator`);
 }finally{await bootstrap.end();}
 const failure=await db(c,'operator',c.failureDatabase);
 try{
  await failure.query(fs.readFileSync(path.join(__dirname,'baseline.sql'),'utf8'));
  for(const [manifestFile,folder] of [['schema-manifest.json','security-migrations'],['admin-schema-manifest.json','admin-migrations']]){
   const m=JSON.parse(fs.readFileSync(path.join(core,'src/security',manifestFile),'utf8'));
   await failure.query(fs.readFileSync(path.join(core,folder,m.file),'utf8'));
   await failure.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',[m.version,m.sha256]);
  }
  await failure.query('CREATE SCHEMA portal_learning');
  await assert.rejects(()=>applyMigrations(failure,{runtimeRole:'epdg_synthetic_app',migratorRole:'epdg_review_operator'}),/Unrecorded portable schema/);
  const rolledBack=(await failure.query("SELECT to_regnamespace('portal_access') IS NULL AND to_regnamespace('portal_accounts') IS NULL AS complete")).rows[0];
  assert.equal(rolledBack.complete,true);c.migrationFailureRecoveryPassed=true;
 }finally{await failure.end();}
 const operator=await db(c);
 try{
  await operator.query(fs.readFileSync(path.join(__dirname,'baseline.sql'),'utf8'));
  await operator.query(fs.readFileSync(path.join(__dirname,'isolation.sql'),'utf8'));
  for(const [manifestFile,folder] of [['schema-manifest.json','security-migrations'],['admin-schema-manifest.json','admin-migrations']]){
   const m=JSON.parse(fs.readFileSync(path.join(core,'src/security',manifestFile),'utf8')),sql=fs.readFileSync(path.join(core,folder,m.file),'utf8');
   assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),m.sha256);await operator.query(sql);
   await operator.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',[m.version,m.sha256]);
  }
  await operator.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE epdg_synthetic FROM PUBLIC');
  const options={runtimeRole:'epdg_synthetic_app',migratorRole:'epdg_review_operator'};
  c.migrations=await applyMigrations(operator,options);assert.ok((await applyMigrations(operator,options)).every(x=>x.status==='verified'));
  await operator.query("INSERT INTO core.branches(id,code,name) VALUES(1,'epdg','SYNTHETIC education')");
  const hash=await bcrypt.hash(c.reviewerPassword,12);
  await operator.query("INSERT INTO core.users(id,email,name,password,is_verified) VALUES(1,'reviewer@epdg.invalid','SYNTHETIC founder reviewer',$1,true)",[hash]);
  await operator.query("INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES(1,'reviewer@epdg.invalid','SYNTHETIC founder reviewer',$1,'admin',true)",[hash]);
  await operator.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES(1,1,'admin'); INSERT INTO portal_security.account_states(user_id,active) VALUES(1,true)");
  await operator.query("INSERT INTO epdg.companies(id,user_id,company_name,email,is_approved,is_verified) VALUES(1,1,'SYNTHETIC review organization','organization@epdg.invalid',true,true)");
  await operator.query('INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES(1,1,true)');
  const assignment=(await operator.query("INSERT INTO portal_security.role_assignments(user_id,role_code,status) VALUES(1,'founder_owner','active') RETURNING id")).rows[0].id;
  await operator.query("INSERT INTO portal_access.scopes(assignment_id,organization_id,scope_type,scope_id,approved_by_user_id,approval_reference) VALUES($1,1,'organization','1',1,'SYNTHETIC offline founder bootstrap')",[assignment]);
  await operator.query("INSERT INTO portal_accounts.release_control(singleton,target_id,approval_ref,enabled,mail_enabled,batch_approval_ref,bound_database,bound_runtime_role,synthetic_only) VALUES(true,'SYNTHETIC-phase-two-target','SYNTHETIC-release-approval',true,true,'SYNTHETIC-mail-batch','epdg_synthetic','epdg_synthetic_app',true)");
  c.groupId=crypto.randomUUID();await operator.query("INSERT INTO portal_access.groups(id,organization_id,kind,name) VALUES($1,1,'cohort','SYNTHETIC review cohort')",[c.groupId]);
  c.resources={};for(const kind of ['technical_diagnostic','curriculum','progress','content','commercial','outreach','learning','team']){
   const id=crypto.randomUUID();c.resources[kind]=id;await operator.query("INSERT INTO portal_access.resources(id,organization_id,kind,group_id,title,body,status) VALUES($1,1,$2,$3,$4,'SYNTHETIC review content','draft')",[id,kind,c.groupId,'SYNTHETIC '+kind]);
  }
 }finally{await operator.end();}
 fs.writeFileSync(stateFile,JSON.stringify(c,null,2),{mode:0o600});
 c.mailPid=background(mailBin,['--smtp','127.0.0.1:51025','--listen','127.0.0.1:58025','--database',path.join(directory,'mail.db')],process.env,path.join(directory,'mailpit.log'));await ready('http://127.0.0.1:58025/readyz');
 c.apiPid=background(process.execPath,[__filename,'serve'],environment(c),path.join(directory,'api.log'));
 fs.writeFileSync(stateFile,JSON.stringify(c,null,2),{mode:0o600});await ready('http://127.0.0.1:58000/health');
 process.stdout.write('Phase Two native fixture ready; private configuration is .local-synthetic/account-release-review.json\n');
}
async function serve(){const c=load();useEnvironment(c);const {checkSecuritySchema}=require('../../dist/security/PortalService.js');const {checkLearningReadiness}=require('../../dist/learning/LearningService.js');const readiness=async()=>{await checkSecuritySchema();await checkLearningReadiness();};await readiness();require('../../dist/app.js').createApp({readinessCheck:readiness}).listen(58000,'127.0.0.1');}
async function verify(){
 const c=load();useEnvironment(c);let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
 const origin=c.origin,base='http://127.0.0.1:58000/api';let localAddress='127.0.0.2';
 const localFetch=(url,options)=>new Promise((resolve,reject)=>{const req=require('node:http').request(url,{...options,localAddress,agent:false},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>{const value=res.headers[name];return Array.isArray(value)?value[0]:value;}},json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(options.body);});
 const request=async(route,body,session,extra={},method)=>{const response=await localFetch(base+route,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:origin,'X-EPDG-Request':'portal',...(body===undefined?{}:{'Content-Type':'application/json'}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await response.json();}catch{throw new Error('Non-JSON response at '+route);}return{status:response.status,body:data,cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 const ok=async(route,body,session,extra={},method)=>{const r=await request(route,body,session,extra,method);assert.equal(r.status,200,route+': '+r.body.message);checks++;return r;};
 const login=async(email,password)=>{const r=await ok('/auth/login',{email,password});check(r.body.environment==='portal-release-candidate','Explicit release environment');return{cookie:r.cookie,csrf:r.body.csrf_token,user:r.body.user};};
 async function mailToken(email,subject='Your EPDG portal invitation'){
  const list=await(await fetch('http://127.0.0.1:58025/api/v1/messages')).json();for(const row of list.messages||[]){if(row.Subject!==subject||!row.To?.some(t=>t.Address===email))continue;const detail=await(await fetch('http://127.0.0.1:58025/api/v1/message/'+row.ID)).json();const token=detail.HTML.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];if(token)return token;}throw new Error('Reserved invitation was not captured');
 }
 const admin=await login('reviewer@epdg.invalid',c.reviewerPassword),operator=await db(c),runtime=await db(c,'runtime');
 const fixtures={};
 try{
  const roles=['founder_owner','organization_admin','hr_admin','technical_maintainer','program_coordinator','intern_team_lead','content_editor','sales_staff','global_outreach','restricted_viewer','participant'];
  const roleScopes=role=>role==='restricted_viewer'?[{role_code:role,scope_type:'resource',scope_id:c.resources.commercial}]:['founder_owner','organization_admin','hr_admin'].includes(role)?[{role_code:role,scope_type:'organization',scope_id:'1'}]:['participant','intern_team_lead'].includes(role)?[{role_code:role,scope_type:'self',scope_id:'self'},{role_code:role,scope_type:'group',scope_id:c.groupId}]:[{role_code:role,scope_type:'group',scope_id:c.groupId}];
  async function provision(label,role='participant',session=admin){
   let p=(await ok('/admin/account-plans',{organization_id:1,email:label+'@epdg.invalid',name:'SYNTHETIC '+label,roles:roleScopes(role)},session)).body.data.plan;
   if(p.onboarding_status==='required')p=(await ok(`/admin/account-plans/${p.id}/verify-onboarding`,{expected_revision:Number(p.revision),evidence_ref:'SYNTHETIC-CRM-review/'+label},admin)).body.data.plan;
   p=(await ok(`/admin/account-plans/${p.id}/approve`,{expected_revision:Number(p.revision)},admin)).body.data.plan;
   p=(await ok(`/admin/account-plans/${p.id}/provision`,{expected_revision:Number(p.revision)},session)).body.data.plan;
   check(p.identity_action==='created','New identity creation recorded');return p;
  }
  for(const role of roles){
   localAddress='127.0.0.'+(roles.indexOf(role)+3);
   const plan=await provision('role-'+role,role);const invitation=(await ok(`/admin/accounts/${plan.user_id}/invitations`,{},admin)).body.data.invitation;
   const sent=(await ok(`/admin/invitations/${invitation.id}/send`,{},admin)).body.data;
   check(sent.invitation.delivery_status==='provider_accepted'&&sent.invitation.delivered_at===null,'SMTP acceptance is not actual delivery');
   const token=await mailToken(plan.email);check(!JSON.stringify(sent).includes(token),'Invitation secret absent from admin API');
   check((await request('/auth/login',{email:plan.email,password:c.learnerPassword})).status===401,'Inactive identity cannot sign in');
   const accepted=await ok('/auth/accept-invitation',{token,password:c.learnerPassword});check(!accepted.cookie&&accepted.body.sign_in_verified===false,'Acceptance has no session or verified login');
   const session=await login(plan.email,c.learnerPassword);check(session.user.portal_roles.includes(role),'Canonical '+role+' can log in');
   check((await ok('/auth/session',undefined,session)).body.user.id===plan.user_id,'Stable session identity');
   await ok('/portal/workspace',undefined,session);
   const profile=(await ok('/account/self',{name:'SYNTHETIC '+role+' profile'},session,{},'PATCH')).body.data;
   check(profile.id===plan.user_id,'Every role can update its own safe profile fields');
   check((await request('/account/self',{name:'SYNTHETIC forged',roles:['founder_owner']},session,{},'PATCH')).status===400,'Role field cannot be changed through profile');
   fixtures[role]={plan,invitation,session};
  }
  localAddress='127.0.0.20';
  const participant=fixtures.participant.session,hr=fixtures.hr_admin.session,org=fixtures.organization_admin.session;
  check((await request('/admin/account-management',undefined,participant)).status===403,'Participant cannot read account records');
  check((await request(`/admin/accounts/${fixtures.founder_owner.plan.user_id}/disable`,{reason_code:'access_review'},hr)).status===403,'HR cannot disable founder');
  check((await request(`/admin/accounts/${fixtures.founder_owner.plan.user_id}/disable`,{reason_code:'access_review'},org)).status===403,'Organization admin cannot disable founder');
  check((await request(`/admin/accounts/1/disable`,{reason_code:'access_review'},admin)).status===403,'Self disabling denied');
  const held=(await ok('/admin/account-plans',{organization_id:1,email:'held@epdg.invalid',name:'SYNTHETIC held',roles:roleScopes('participant')},hr)).body.data.plan;
  check((await request(`/admin/account-plans/${held.id}/approve`,{expected_revision:Number(held.revision)},admin)).status===409,'Unverified HR evidence blocks approval');
  check((await request(`/admin/account-plans/${held.id}/approve`,{expected_revision:Number(held.revision)},hr)).status===403,'HR cannot approve its plan');
  const list=(await ok('/admin/account-management',undefined,hr)).body.data;
  check(list.plans.every(p=>!p.allowed_actions.includes('approve')),'Server actions omit unauthorized approval');
  check(!list.accounts.some(a=>a.id===fixtures.founder_owner.plan.user_id),'HR cannot inspect founder records');
  check((await request('/admin/account-plans',{organization_id:1,email:'csrf@epdg.invalid',name:'SYNTHETIC csrf',roles:roleScopes('participant')},admin,{'X-CSRF-Token':'bad'})).status===403,'CSRF rejection');
  check((await request('/admin/account-plans',{organization_id:1,email:'origin@epdg.invalid',name:'SYNTHETIC origin',roles:roleScopes('participant')},admin,{Origin:'https://foreign.invalid'})).status===403,'Origin rejection');
  const parallelInput={organization_id:1,email:'parallel@epdg.invalid',name:'SYNTHETIC parallel',roles:roleScopes('participant')};
  const parallel=await Promise.all([ok('/admin/account-plans',parallelInput,admin),ok('/admin/account-plans',parallelInput,admin)]);check(parallel[0].body.data.plan.id===parallel[1].body.data.plan.id,'Concurrent proposal is idempotent');
  const again=(await ok(`/admin/accounts/${fixtures.participant.plan.user_id}/invitations`,{},admin)).body.data.invitation;check(!('token_hash' in again)&&!('credential_hash'in again),'Existing invitation never exposes hashes');
  check((await request('/auth/accept-invitation',{token:await mailToken(fixtures.participant.plan.email),password:c.learnerPassword})).status===400,'Accepted token cannot replay');
  await ok('/auth/forgot-password',{email:fixtures.participant.plan.email});const recovery=await mailToken(fixtures.participant.plan.email,'EPDG portal password recovery');
  await ok('/auth/reset-password',{token:recovery,password:c.learnerPassword+'X'});check((await request('/auth/session',undefined,participant)).status===401,'Recovery revokes session');
  const reset=await login(fixtures.participant.plan.email,c.learnerPassword+'X');await ok('/auth/logout',{},reset);check((await request('/auth/session',undefined,reset)).status===401,'Logout revokes session');
  const protection=(await runtime.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user")).rows[0];check(Object.values(protection).every(v=>v===false),'Runtime has no database administration or bypass');
  for(const sql of ["UPDATE portal_security.account_states SET active=true WHERE user_id=1","UPDATE core.users SET name='SYNTHETIC forged' WHERE id=1","DELETE FROM portal_accounts.audit_events","INSERT INTO portal_security.role_assignments(user_id,role_code) VALUES(1,'founder_owner')"]){await assert.rejects(()=>runtime.query(sql),/permission denied/);checks++;}
  const lifecycle=await require('./account-lifecycle-checks.cjs').verifyAccountLifecycle({operator,runtime,config:c,founderId:1});checks+=lifecycle.checks;
  const learning=await require('./portable-learning-http.cjs').verifyPortableLearning({operator,runtime,founderId:1,organizationId:1,config:c,baseUrl:'http://127.0.0.1:58000'});checks+=learning.checks;
  const browserPlan=await provision('browser-review');const browserInv=(await ok(`/admin/accounts/${browserPlan.user_id}/invitations`,{},admin)).body.data.invitation;await ok(`/admin/invitations/${browserInv.id}/send`,{},admin);
  const browser={reviewerEmail:'reviewer@epdg.invalid',reviewerPassword:c.reviewerPassword,participantEmail:browserPlan.email,participantPassword:c.learnerPassword,acceptanceUrl:origin+'/accept-invitation#token='+await mailToken(browserPlan.email),learning:learning.fixture,roles:Object.fromEntries(Object.entries(fixtures).map(([role,f])=>[role,{email:f.plan.email,password:role==='participant'?c.learnerPassword+'X':c.learnerPassword,userId:f.plan.user_id}]))};
  fs.writeFileSync(path.join(c.directory,'browser-review.json'),JSON.stringify(browser,null,2),{mode:0o600});
  const evidence={status:'passed',checks,verified_at:new Date().toISOString(),migrations:require('../account-release/migrate.cjs').entries().map(({schema,manifest})=>({schema,...manifest})),migration_failure_recovery:c.migrationFailureRecoveryPassed===true,coverage:['all eleven canonical roles actual HTTP login/session/workspace','persisted founder approval','verified HR gate','real PostgreSQL restricted runtime','Mailpit SMTP','provider acceptance vs delivery','CSRF/origin','recovery/logout','portable learning submission/revision/mentor feedback','migration ledger idempotence',...lifecycle.coverage],production_changed:false};
  fs.writeFileSync(path.join(workspace,'build-evidence/epdg-account-release-native-20261114.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await operator.end();await runtime.end();await require('../../dist/db').getPool().end();}
}
module.exports={environment,db,load};
if(require.main===module)({setup,serve,verify}[process.argv[2]]||(()=>{throw new Error('Use setup, serve, or verify');}))().catch(error=>{process.stderr.write('Account release review failed: '+error.message+'\n');process.exitCode=1;});
