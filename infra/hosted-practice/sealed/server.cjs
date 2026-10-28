'use strict';
// Temporary, inert deployment for origin assignment. Not a working portal.
// No app/database/auth imports, outgoing requests, body parser or secret reads.
const http=require('node:http');
const pins=Object.freeze({RAILWAY_PROJECT_ID:'c7b825f1-dfce-465d-9070-d85e7a302181',
 RAILWAY_ENVIRONMENT_ID:'003f223c-11f8-4bc9-8e78-0f34fe6bba6b',RAILWAY_SERVICE_ID:'92370910-1f75-421b-9910-c25240572cdf',
 EPDG_HOSTED_PRACTICE_SEALED:'1'});
function validate(env=process.env){
 if(process.versions.node!=='22.23.1'||Object.entries(pins).some(([name,value])=>env[name]!==value))throw Error('Sealed deployment identity unavailable');
 const forbidden=['DB_PASSWORD','DATABASE_URL','DATABASE_PUBLIC_URL','EPDG_HOSTED_PRACTICE_MODE','EPDG_SYNTHETIC_MODE',
  'SESSION_CSRF_SECRET','EPDG_HOSTED_PRACTICE_HANDOFF_KEY','EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD','HOSTED_PRACTICE_APP_PASSWORD',
  'HOSTED_PRACTICE_FIXTURE_PASSWORD','RESEND_API_KEY','SUPABASE_SERVICE_ROLE_KEY','SMTP_PASSWORD'];
 if(forbidden.some(name=>Boolean(env[name])))throw Error('Sealed deployment must not receive application credentials');
 const port=Number(env.PORT??58000);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid sealed port');return port;
}
function createServer(){const server=http.createServer((req,res)=>{
 const live=(req.method==='GET'||req.method==='HEAD')&&req.url==='/liveness';
 const body=JSON.stringify({environment:'synthetic-hosted',sealed:true,ready:false,privileged_controls_available:false});
 res.writeHead(live?200:503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
  'Connection':'close','Content-Length':Buffer.byteLength(body)});
 res.end(req.method==='HEAD'?undefined:body);
 });server.maxHeadersCount=32;server.headersTimeout=5000;server.requestTimeout=5000;server.keepAliveTimeout=1000;return server;}
module.exports={validate,createServer,pins};
if(require.main===module){try{const port=validate();createServer().listen(port,'0.0.0.0',()=>console.log('Sealed hosted readiness listener active; every application route is unavailable.'));}
 catch{console.error('Sealed hosted deployment refused its environment; no configuration values logged.');process.exitCode=1;}}
