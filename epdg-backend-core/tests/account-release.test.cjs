'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const {accountReleaseConfig,assertAccountRelease}=require('../dist/security/accountReleaseConfig.js');
const local=()=>({...runtimeEnv({instanceId:crypto.randomUUID(),appPassword:'fixture',jwtSecret:'j'.repeat(48),certificateSecret:'c'.repeat(48),csrfSecret:'s'.repeat(48)}),EPDG_ACCOUNT_MANAGEMENT_ENABLED:'1',EPDG_ACCOUNT_TARGET_ID:'SYNTHETIC-reviewed-target',EPDG_ACCOUNT_RELEASE_APPROVAL:'SYNTHETIC-release-reference',EPDG_INVITATION_DELIVERY_ENABLED:'1',EPDG_INVITATION_BATCH_APPROVAL:'SYNTHETIC-batch-reference',PORTAL_MAIL_REPLY_TO:'support@epdg.invalid'});
async function usingEnv(env,work){const old={...process.env};for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);try{return await work();}finally{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,old);}}
test('portable release and mail flags fail closed independently',()=>{
 const env=local();assert.equal(accountReleaseConfig(env).deliveryEnabled,true);
 for(const change of [{EPDG_ACCOUNT_MANAGEMENT_ENABLED:'0'},{EPDG_ACCOUNT_TARGET_ID:''},{EPDG_ACCOUNT_RELEASE_APPROVAL:''},{EPDG_HOSTED_PRACTICE_MODE:'1'},{EPDG_INVITATION_REVIEW_MODE:'1'},{EPDG_NEON_ADMIN_STAGING_MODE:'1'},{DB_HOST:'external.invalid'},{PORTAL_MAIL_REPLY_TO:'person@example.com'},{EPDG_INVITATION_BATCH_APPROVAL:''},{RESEND_API_KEY:'forbidden'}])assert.throws(()=>accountReleaseConfig({...env,...change}));
 assert.equal(accountReleaseConfig({...env,EPDG_INVITATION_DELIVERY_ENABLED:'0',PORTAL_MAIL_REPLY_TO:'',EPDG_INVITATION_BATCH_APPROVAL:''}).deliveryEnabled,false);
});
test('production-capable configuration requires reviewed HTTPS TLS target and sender',()=>{
 const env={...local(),EPDG_SYNTHETIC_MODE:'',NODE_ENV:'production',DB_SSL:'true',EPDG_ACCOUNT_PRODUCTION_APPROVED:'1',PORTAL_ORIGIN:'https://portal.example.invalid',SMTP_FROM:'portal@example.invalid',PORTAL_MAIL_REPLY_TO:'support@example.invalid',MAIL_DELIVERY_MODE:'resend',PORTAL_SENDER_VERIFIED:'1',RESEND_API_KEY:'synthetic-injected-adapter-only'};
 assert.equal(accountReleaseConfig(env).synthetic,false);
 for(const change of [{EPDG_ACCOUNT_PRODUCTION_APPROVED:''},{DB_SSL:'false'},{PORTAL_ORIGIN:'http://portal.example.invalid'},{SMTP_FROM:'unreviewed'},{PORTAL_MAIL_REPLY_TO:''},{PORTAL_SENDER_VERIFIED:''},{MAIL_DELIVERY_MODE:'smtp'},{RESEND_API_KEY:''}])assert.throws(()=>accountReleaseConfig({...env,...change}));
});
test('environment approval cannot replace persisted target-bound database approval',async()=>usingEnv(local(),async()=>{
 await assert.rejects(()=>assertAccountRelease({query:async()=>({rows:[{allowed:false}]})}),/not authorized/);
 let args;await assertAccountRelease({query:async(_sql,values)=>{args=values;return{rows:[{allowed:true}]};}},true);
 assert.equal(args[2],true);assert.equal(args[3],'SYNTHETIC-batch-reference');
}));
test('invitation transport uses reply-to, fragment token and provider idempotency without claiming delivery',async()=>usingEnv(local(),async()=>{
 const {sendAccountInvitation}=require('../dist/security/accountMail.js');const token=crypto.randomBytes(32).toString('base64url'),attempt=crypto.randomUUID();let message,options;
 const accepted=await sendAccountInvitation('recipient@epdg.invalid',token,attempt,async(m,o)=>{message=m;options=o;return{error:null,providerId:'synthetic-provider-id'};});
 assert.equal(accepted.status,'provider_accepted');assert.equal(message.replyTo,'support@epdg.invalid');assert.match(message.html,/#token=/);assert.ok(message.html.includes(token));assert.equal(options.idempotencyKey,'epdg-invitation/'+attempt);assert.equal('delivered_at'in accepted,false);
 assert.equal((await sendAccountInvitation('recipient@epdg.invalid',token,attempt,async()=>({error:{message:'rejected'}}))).status,'failed');
 await assert.rejects(()=>sendAccountInvitation('recipient@example.com',token,attempt,async()=>{throw new Error('must not send');}),/unavailable/);
}));
test('release routes reject forged fields, authorization headers, missing CSRF and unrelated multipart still reaches portal guard',async()=>usingEnv(local(),async()=>{
 const express=require('express'),{createAccountManagementRouter}=require('../dist/security/accountManagementRoutes.js'),{csrfToken}=require('../dist/security/primitives.js');
 const app=express();app.use(express.json());let calls=0;
 app.use(createAccountManagementRouter({profile:async()=>{calls++;return{};}}));app.use((_req,res)=>res.status(418).json({downstream:true}));app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const base='http://127.0.0.1:'+server.address().port,raw=crypto.randomBytes(32).toString('base64url');
  const cookieName=require('../dist/security/config.js').portalConfig().cookieName;
  const headers={Origin:'http://127.0.0.1:58080','X-EPDG-Request':'portal','Content-Type':'application/json',Cookie:cookieName+'='+raw,'X-CSRF-Token':csrfToken(raw)};
  assert.equal((await fetch(base+'/account/self',{method:'PATCH',headers,body:JSON.stringify({name:'SYNTHETIC test',roles:['founder_owner']})})).status,400);
  assert.equal((await fetch(base+'/account/self',{method:'PATCH',headers:{...headers,'X-CSRF-Token':'wrong'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/account/self',{method:'PATCH',headers:{...headers,Authorization:'Bearer forged'},body:'{}'})).status,401);
  assert.equal(calls,0);
  const form=new FormData();form.set('file',new Blob(['SYNTHETIC evidence']),'evidence.txt');
  assert.equal((await fetch(base+'/learner/assignments/'+crypto.randomUUID()+'/attachments',{method:'POST',headers:{Origin:headers.Origin},body:form})).status,418);
 }finally{await new Promise(r=>server.close(r));}
}));
