'use strict';
// Exact production configuration/cookie/router code, isolated database and
// injected fixed-loopback mail transport. No provider requests or trust-store edits.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict'),crypto=require('node:crypto');
process.env.EPDG_REVIEW_PHASE='3';
const fixture=require('./account-release-review.cjs'),core=path.resolve(__dirname,'../..'),workspace=path.resolve(core,'../../..');
const origin='https://epdg-review.localhost';
const caFile=path.join(workspace,'build-evidence/epdg-phase-three-20261114/frontend/.private-tls/certificate.pem');
function environment(c){
 const env=fixture.environment(c);delete env.EPDG_SYNTHETIC_MODE;delete env.SYNTHETIC_INSTANCE_ID;
 return {...env,NODE_ENV:'production',PORT:'58001',DB_SSL:'true',SUPABASE_DB_CA_CERT:fs.readFileSync(path.join(c.directory,'private-tls/ca.pem'),'utf8'),PORTAL_ORIGIN:origin,FRONTEND_URL:origin,CORS_ORIGINS:origin,
  EPDG_ACCOUNT_PRODUCTION_APPROVED:'1',MAIL_DELIVERY_MODE:'resend',RESEND_API_KEY:'SYNTHETIC-NOT-A-PROVIDER-CREDENTIAL',SMTP_FROM:'noreply@epdg.invalid',PORTAL_SENDER_VERIFIED:'1'};
}
async function serve(){
 const c=fixture.load();assert.ok(c.directory.includes(path.join('.local-synthetic','account-release-')));
 const env=environment(c);for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env);
 const transport=async(message)=>{
  const to=Array.isArray(message.to)?message.to:[message.to];assert.ok(to.length===1&&to[0].endsWith('@epdg.invalid')&&message.from.includes('noreply@epdg.invalid'));
  const result=await require('nodemailer').createTransport({host:'127.0.0.1',port:51025,ignoreTLS:true,secure:false,disableFileAccess:true,disableUrlAccess:true}).sendMail(message);return{error:null,providerId:result.messageId};
 };
 const {PortalService,checkSecuritySchema}=require('../../dist/security/PortalService.js'),{AccountManagementService}=require('../../dist/security/AccountManagementService.js');
 const {checkLearningReadiness}=require('../../dist/learning/LearningService.js');const readiness=async()=>{await checkSecuritySchema();await checkLearningReadiness();};await readiness();
 const connection=(await require('../../dist/db').getPool().query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];assert.equal(connection.ssl,true);
 const service=new PortalService(transport);
 c.httpsApiPid=process.pid;fs.writeFileSync(path.join(core,'../.local-synthetic/phase-three-review.json'),JSON.stringify(c,null,2),{mode:0o600});
 require('../../dist/app.js').createApp({readinessCheck:readiness,portalService:service,accountService:new AccountManagementService(service,transport)}).listen(58001,'127.0.0.1');
}
function request(route,body,session,extra={},method){
 return new Promise((resolve,reject)=>{
  const req=https.request({hostname:'epdg-review.localhost',servername:'epdg-review.localhost',port:443,path:'/api'+route,method:method||(body===undefined?'GET':'POST'),family:4,
   lookup:(_h,_o,cb)=>cb(null,'127.0.0.1',4),ca:fs.readFileSync(caFile),rejectUnauthorized:true,agent:false,
   headers:{Origin:origin,'X-EPDG-Request':'portal',...(body===undefined?{}:{'Content-Type':'application/json'}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...extra}},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString()),headers:res.headers,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});}catch{if(res.statusCode>=400)resolve({status:res.statusCode,body:{message:'Proxy request rejected'},headers:res.headers});else reject(new Error('Expected JSON API response at '+route+'; status '+res.statusCode));}});
   });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
async function verify(){
 const c=fixture.load(),privateFixture=JSON.parse(fs.readFileSync(path.join(c.directory,'browser-review.json'),'utf8'));let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++;};
 const ok=async(...args)=>{const r=await request(...args);assert.equal(r.status,200,args[0]+': '+r.body.message);checks++;return r;};
 const login=async(email,password)=>{const r=await ok('/auth/login',{email,password});const cookie=r.headers['set-cookie'][0];check(cookie.startsWith('__Host-epdg_session=')&&cookie.includes('Secure')&&cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict')&&cookie.includes('Path=/')&&!cookie.includes('Domain='),'Production cookie security');return{cookie:r.cookie,csrf:r.body.csrf_token,user:r.body.user};};
 const operator=await fixture.db(c);
 try{
  const admin=await login(privateFixture.reviewerEmail,privateFixture.reviewerPassword);
  check((await ok('/auth/session',undefined,admin)).body.user.id===1,'HTTPS session restored');
  check((await request('/account/self',{name:'SYNTHETIC wrong csrf'},admin,{'X-CSRF-Token':'wrong'},'PATCH')).status===403,'CSRF required');
  check((await request('/account/self',{name:'SYNTHETIC wrong origin'},admin,{Origin:'https://attacker.invalid'},'PATCH')).status===403,'Wrong origin denied');
  check((await request('/auth/register',{},admin)).status===503,'Public registration remains unavailable');
  let plan=(await ok('/admin/account-plans',{organization_id:1,email:'https-viewer-two-'+Date.now()+'@epdg.invalid',name:'SYNTHETIC second viewer',roles:[{role_code:'restricted_viewer',scope_type:'resource',scope_id:c.resources.content}]},admin)).body.data.plan;
  plan=(await ok(`/admin/account-plans/${plan.id}/approve`,{expected_revision:Number(plan.revision)},admin)).body.data.plan;
  plan=(await ok(`/admin/account-plans/${plan.id}/provision`,{expected_revision:Number(plan.revision)},admin)).body.data.plan;
  const invitation=(await ok(`/admin/accounts/${plan.user_id}/invitations`,{},admin)).body.data.invitation;
  const sent=(await ok(`/admin/invitations/${invitation.id}/send`,{},admin)).body.data.invitation;check(sent.delivery_status==='provider_accepted'&&sent.delivered_at===null,'HTTPS invitation accepted by capture SMTP only');
  const mailToken=async(email,subject)=>{for(let i=0;i<30;i++){const list=await(await fetch('http://127.0.0.1:58025/api/v1/messages')).json();for(const row of list.messages||[]){if(row.Subject!==subject||!row.To?.some(t=>t.Address===email))continue;const detail=await(await fetch('http://127.0.0.1:58025/api/v1/message/'+row.ID)).json();check(detail.HTML.includes(origin),'Mail link binds exact HTTPS origin');return detail.HTML.match(/#token=([A-Za-z0-9_-]{43})/)[1];}await new Promise(r=>setTimeout(r,100));}throw new Error('Capture missing');};
  const token=await mailToken(plan.email,'Your EPDG portal invitation');
  const accepted=await ok('/auth/accept-invitation',{token,password:c.learnerPassword});check(!accepted.cookie&&accepted.body.sign_in_verified===false,'Invitation acceptance is not login');
  check((await request('/auth/accept-invitation',{token,password:c.learnerPassword})).status===400,'HTTPS token is single use');
  const configurations=['organization_admin','hr_admin','technical_maintainer','content_editor','sales_staff','global_outreach','restricted_viewer'];
  for(const role of configurations){const f=privateFixture.roles[role];const session=await login(f.email,f.password);check(session.user.portal_roles.includes(role),'Reviewed configuration '+role);await ok('/portal/workspace',undefined,session);if(!['organization_admin','hr_admin'].includes(role))check((await request('/admin/account-management',undefined,session)).status===403,'Staff cannot administer accounts');await ok('/auth/logout',{},session);check((await request('/auth/session',undefined,session)).status===401,'Logout revokes '+role);}
  const viewer=await login(plan.email,c.learnerPassword);const work=(await ok('/portal/workspace',undefined,viewer)).body.data;
  check(work.resources.length===1&&work.resources[0].id===c.resources.content,'Second viewer has separate explicit resource only');
  check((await request('/portal/resources/'+c.resources.commercial,undefined,viewer)).status===404,'Cross-resource viewer denied');
  await ok('/auth/forgot-password',{email:plan.email});const recovery=await mailToken(plan.email,'EPDG portal password recovery');
  await ok('/auth/reset-password',{token:recovery,password:c.learnerPassword+'TLS'});check((await request('/auth/session',undefined,viewer)).status===401,'Recovery revokes HTTPS session');
  const recovered=await login(plan.email,c.learnerPassword+'TLS');
  await ok(`/admin/accounts/${plan.user_id}/disable`,{reason_code:'access_review'},admin);check((await request('/auth/session',undefined,recovered)).status===401,'Disable revokes HTTPS session');
  await ok('/auth/logout',{},admin);
  // Backend intentionally distrusts proxy headers. Spoofed addresses cannot buy
  // new login quotas through the fixed-origin local proxy; live ingress remains a gate.
  let limited=false;for(let n=0;n<25;n++){const r=await request('/auth/login',{email:'unknown@epdg.invalid',password:'SYNTHETIC invalid password'},undefined,{'X-Forwarded-For':'203.0.113.'+(n+1)});if(r.status===429){limited=true;break;}}
  check(limited,'Forwarded-IP spoofing cannot bypass login rate limit');
  const evidence={status:'passed',checks,configurations:8,production_profile:true,database_tls:true,explicit_fixture_ca:true,tls_validation_bypassed:false,browser_trust_modified:false,live_provider_ingress_tested:false,production_changed:false,verified_at:new Date().toISOString()};
  fs.writeFileSync(path.join(workspace,'build-evidence/epdg-phase-three-20261114/production-profile-https.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence)+'\n');
 }finally{await operator.end();}
}
module.exports={environment,request};
if(require.main===module)({serve,verify}[process.argv[2]]||(()=>{throw new Error('Use serve or verify');}))().catch(e=>{process.stderr.write('Production-profile review failed: '+e.message+'\n');process.exitCode=1;});
