'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{fork}=require('node:child_process');
const http=require('node:http'),{join}=require('node:path'),{gzipSync,deflateSync}=require('node:zlib');
function request(port,path,body,encoding){return new Promise((resolve,reject)=>{
 const headers={Host:'backend.example.invalid','X-Forwarded-Proto':'https'};
 if(body){Object.assign(headers,{'Content-Type':'application/json','Content-Length':body.length,Origin:'https://portal.example.invalid','X-EPDG-Request':'portal'});if(encoding)headers['Content-Encoding']=encoding;}
 const req=http.request({hostname:'127.0.0.1',port,path,method:body?'POST':'GET',headers,agent:false},res=>{
  let text='';res.on('data',value=>{text+=value;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});
 });req.setTimeout(3000,()=>req.destroy(new Error('Unit request timed out')));req.on('error',reject);req.end(body);
});}
function deadline(promise,milliseconds,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));}
test('hosted JSON rejects compressed frames and trailing bytes without a child-process crash', {timeout:15000},async t=>{
 const env={};for(const name of ['SystemRoot','WINDIR','COMSPEC','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[name])env[name]=process.env[name];
 const child=fork(join(__dirname,'fixtures/hosted-compression-child.cjs'),[],{env,stdio:['ignore','pipe','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
 // No uncaught-exception handler is installed in the child: a delayed decoder
 // error must fail this test by terminating that process, never be suppressed.
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',value=>{output=(output+value).slice(-8192);});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 try{
  const ready=await deadline(Promise.race([new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);}),closed.then(()=>{throw new Error('Unit child exited before readiness');})]),5000,'Unit child readiness timed out');
  assert.equal(ready.ready,true);const plain=Buffer.from('{}');
  for(const [encoding,body]of [['gzip',gzipSync(plain)],['gzip',Buffer.concat([gzipSync(plain),Buffer.from('unit-trailing-bytes')])],
   ['deflate',Buffer.concat([deflateSync(plain),Buffer.from('unit-trailing-bytes')])]]){
   const result=await request(ready.port,'/api/auth/login',body,encoding);assert.equal(result.status,415);
   assert.equal(result.body.environment,'synthetic-hosted');assert.equal(result.body.privileged_controls_available,false);
  }
  // Normal JSON is still parsed, then rejected by existing login field checks.
  assert.equal((await request(ready.port,'/api/auth/login',plain)).status,400);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(child.exitCode,null);assert.equal((await request(ready.port,'/health')).status,200);
  child.send('stop');const result=await deadline(closed,3000,'Unit child shutdown timed out');assert.deepEqual(result,{code:0,signal:null});
  assert.doesNotMatch(output,/Z_DATA_ERROR|uncaughtException|Unhandled 'error'/);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill();await deadline(closed,3000,'Unit child cleanup timed out');}
});
