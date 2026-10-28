'use strict';
// Disposable loopback process only; public unit configuration and no database.
const {X509Certificate}=require('node:crypto'),{rootCertificates}=require('node:tls');
const profile=require('../../dist/hosted-practice/profile.json');
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
Object.assign(profile,{version:1,enabled:true,projectId:id(1),environmentId:id(2),serviceId:id(3),databaseServiceId:id(4),instanceId:id(5),
 databaseHost:'unit-db.railway.internal',databasePort:5432,databaseName:'epdg_synthetic',databaseUser:'epdg_synthetic_app',
 frontendOrigin:'https://portal.example.invalid',frontendOrigins:['https://portal.example.invalid'],
 backendOrigin:'https://backend.example.invalid',crmOrigin:'https://crm.example.invalid',loginAlias:'admin@theemersonempire.info',
 baselineSha256:'a'.repeat(64),isolationSha256:'b'.repeat(64)});
const ca=rootCertificates.find(value=>{const cert=new X509Certificate(value);return cert.ca&&Date.parse(cert.validFrom)<=Date.now()&&Date.parse(cert.validTo)>Date.now();});
Object.assign(process.env,{NODE_ENV:'production',EPDG_HOSTED_PRACTICE_MODE:'1',RAILWAY_PROJECT_ID:profile.projectId,
 RAILWAY_ENVIRONMENT_ID:profile.environmentId,RAILWAY_SERVICE_ID:profile.serviceId,DB_HOST:profile.databaseHost,DB_PORT:'5432',
 DB_NAME:profile.databaseName,DB_USER:profile.databaseUser,DB_SSL:'true',DB_PASSWORD:'unit-db-only-'.repeat(4),
 SESSION_CSRF_SECRET:'unit-csrf-only-'.repeat(4),HOSTED_PRACTICE_DB_CA_CERT:ca,HOSTED_PRACTICE_INSTANCE_ID:profile.instanceId,
 PORTAL_ORIGIN:profile.frontendOrigin,FRONTEND_URL:profile.frontendOrigin,CORS_ORIGINS:profile.frontendOrigin,
 EPDG_HOSTED_PRACTICE_LOGIN_ALIAS:profile.loginAlias,MAIL_DELIVERY_MODE:'database-capture',SMTP_FROM:'EPDG Synthetic <no-reply@epdg.invalid>'});
const db=require('../../dist/db/index.js');db.getPool=()=>{throw new Error('Unit child must never access a database');};
const {createHostedPracticeApp}=require('../../dist/hosted-practice/app.js');
const server=createHostedPracticeApp({readinessCheck:async()=>{}}).listen(0,'127.0.0.1',()=>process.send({ready:true,port:server.address().port}));
server.requestTimeout=3000;
const stop=()=>server.close(()=>process.exit(0));
process.once('message',message=>{if(message==='stop')stop();});process.once('disconnect',stop);
