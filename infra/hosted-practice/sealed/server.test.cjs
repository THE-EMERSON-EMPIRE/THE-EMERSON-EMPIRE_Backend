'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validate,createServer,pins}=require('./server.cjs');
test('sealed environment pins exact deployment and refuses every application credential',()=>{
 assert.equal(validate({...pins,PORT:'58000'}),58000);
 for(const name of Object.keys(pins))assert.throws(()=>validate({...pins,[name]:'other'}));
 for(const name of ['DB_PASSWORD','DATABASE_URL','SESSION_CSRF_SECRET','EPDG_HOSTED_PRACTICE_MODE','EPDG_HOSTED_PRACTICE_OPERATOR_PASSWORD','HOSTED_PRACTICE_FIXTURE_PASSWORD'])assert.throws(()=>validate({...pins,[name]:'blocked'}));
 for(const value of ['80','65536','x','58000.5'])assert.throws(()=>validate({...pins,PORT:value}));
});
test('only bounded liveness is200; every method and feature route is503 without reflection',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=(method,path)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,agent:false},res=>{
  let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end();});
 try{
  for(const [method,path]of [['GET','/liveness'],['HEAD','/liveness'],['GET','/health'],['POST','/liveness'],['GET','/liveness?x=1'],['POST','/internal/crm/onboarding-handoffs'],['POST','/api/auth/login'],['GET','/api/learner/onboarding'],['PATCH','/api/admin'],['OPTIONS','/api/auth/login'],['GET','/anything-private']]){
   const r=await request(method,path);assert.equal(r.status,path==='/liveness'&&['GET','HEAD'].includes(method)?200:503);
   assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['access-control-allow-origin'],undefined);assert.equal(r.headers['set-cookie'],undefined);
   if(method!=='HEAD')assert.deepEqual(JSON.parse(r.text),{environment:'synthetic-hosted',sealed:true,ready:false,privileged_controls_available:false});
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});
