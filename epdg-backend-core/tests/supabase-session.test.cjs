'use strict';
// Injected clients and public fake error material only. No network or provider IO.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {initializeSupabaseSession,initializeSupabasePool}=require('../dist/db/supabase-session.js');
const privateSentinel='Unit-private-session-error-not-a-real-secret';
const rawError=()=>Object.assign(new Error(privateSentinel),{detail:privateSentinel,query:privateSentinel,
 params:[privateSentinel],cause:new Error(privateSentinel)});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function safe(error){
 assert.equal(error.statusCode??error.status,503);
 assert.ok(![String(error),error.stack,JSON.stringify(error)].join('\n').includes(privateSentinel));
 assert.equal(Object.hasOwn(error,'cause'),false);return true;
}
class FakeClient{
 constructor(options={}){this.options=options;this.settings={search_path:'public',read_only:'off',statement_timeout:'0'};
  this.queries=[];this.releases=[];this.initializations=0;
  this.release=error=>{this.releases.push(error);if(options.releaseFailure)throw rawError();};}
 query(sql,valuesOrCallback,maybeCallback){
  const callback=typeof valuesOrCallback==='function'?valuesOrCallback:maybeCallback;
  const run=async()=>{
   this.queries.push(sql);
   if(this.options.gate&&this.queries.length===1)await this.options.gate.promise;
   if(this.options.queryFailure)throw rawError();
   if(/^SET SESSION search_path TO /i.test(sql)){this.settings.search_path=sql.split(/ TO /i)[1];return {rows:[]};}
   if(/^SET SESSION default_transaction_read_only TO /i.test(sql)){this.settings.read_only=sql.split(/ TO /i)[1];return {rows:[]};}
   if(/^SET SESSION statement_timeout TO /i.test(sql)){this.settings.statement_timeout=Number(sql.split(/ TO /i)[1])/1000+'s';return {rows:[]};}
   if(sql.includes("current_setting('search_path')")){
    this.initializations++;return {rows:this.options.rows??[{...this.settings,...this.options.readback}]};
   }
   assert.equal(sql,'SELECT public_synthetic_application_work');
   assert.ok(this.initializations>0,'Application SQL cannot precede verified initialization');return {rows:[{value:7}]};
  };
  const promise=run();if(callback){void promise.then(result=>callback(null,result),error=>callback(error));return;}
  return promise;
 }
}
class FakePool{
 constructor(client,options={}){this.client=client;this.options=options;this.acquires=0;}
 connect(callback){
  this.acquires++;if(this.options.acquireThrows)throw rawError();
  const promise=this.options.acquireRejects?Promise.reject(rawError()):Promise.resolve(this.client);
  if(callback){void promise.then(client=>callback(null,client,client.release),error=>callback(error));return;}
  return promise;
 }
 query(sql,callback){
  this.connect((error,client,release)=>{if(error){callback(error);return;}
   client.query(sql,(queryError,result)=>{release();callback(queryError,result);});});
 }
}
const callbackConnect=pool=>new Promise((resolve,reject)=>{pool.connect((error,client,release)=>error?reject(error):resolve({client,release}));});
const poolQuery=pool=>new Promise((resolve,reject)=>{pool.query('SELECT public_synthetic_application_work',(error,result)=>error?reject(error):resolve(result));});

test('explicit Supabase session initialization corrects ignored startup options before readback',async()=>{
 const client=new FakeClient();await initializeSupabaseSession(client);
 assert.deepEqual(client.settings,{search_path:'pg_catalog,epdg,pg_temp',read_only:'off',statement_timeout:'15s'});
 assert.equal(client.initializations,1);assert.equal(client.queries.length,4);
 assert.ok(client.queries.slice(0,3).every(sql=>sql.startsWith('SET SESSION ')));
 assert.ok(client.queries[3].includes("current_setting('search_path')"));
});

test('operator and recovery options explicitly select only reviewed timeouts and read-only state',async()=>{
 for(const options of [{readOnly:true,statementTimeoutMs:10000},{readOnly:false,statementTimeoutMs:30000},{readOnly:true,statementTimeoutMs:15000}]){
  const client=new FakeClient();await initializeSupabaseSession(client,options);
  assert.equal(client.settings.search_path,'pg_catalog,epdg,pg_temp');
  assert.equal(client.settings.read_only,options.readOnly?'on':'off');
  assert.equal(client.settings.statement_timeout,options.statementTimeoutMs/1000+'s');
 }
});

test('invalid options, SET failure and every strict readback drift fail safely',async()=>{
 for(const options of [{readOnly:'on'},{readOnly:1},{statementTimeoutMs:0},{statementTimeoutMs:15001},{statementTimeoutMs:privateSentinel}]){
  const client=new FakeClient();await assert.rejects(initializeSupabaseSession(client,options),safe);assert.equal(client.queries.length,0);
 }
 for(const options of [{queryFailure:true},{rows:[]},{rows:[{},{}]},{readback:{search_path:'public,epdg'}},
  {readback:{search_path:null}},{readback:{read_only:'on'}},{readback:{statement_timeout:'0'}}])
  await assert.rejects(initializeSupabaseSession(new FakeClient(options)),safe);
});

test('promise checkout withholds the client until asynchronous initialization and readback complete',async()=>{
 const gate=deferred(),client=new FakeClient({gate}),pool=new FakePool(client);initializeSupabasePool(pool);
 let exposed=false;const pending=pool.connect().then(value=>{exposed=true;return value;});
 await turn();assert.equal(exposed,false);assert.equal(client.initializations,0);
 assert.ok(!client.queries.includes('SELECT public_synthetic_application_work'));
 gate.resolve();assert.equal(await pending,client);assert.equal(client.initializations,1);
 client.release();assert.deepEqual(client.releases,[undefined]);
});

test('callback checkout and Pool.query callback style wait for the same verified session gate',async()=>{
 for(const queryStyle of [false,true]){
  const gate=deferred(),client=new FakeClient({gate}),pool=new FakePool(client);initializeSupabasePool(pool);
  let exposed=false;const pending=(queryStyle?poolQuery(pool):callbackConnect(pool)).then(value=>{exposed=true;return value;});
  await turn();assert.equal(exposed,false);assert.equal(client.initializations,0);
  assert.ok(!client.queries.includes('SELECT public_synthetic_application_work'));gate.resolve();
  const result=await pending;assert.equal(client.initializations,1);
  if(queryStyle){assert.deepEqual(result.rows,[{value:7}]);assert.deepEqual(client.releases,[undefined]);}
  else{assert.equal(result.client,client);assert.equal(typeof result.release,'function');result.release();assert.deepEqual(client.releases,[undefined]);}
 }
});

test('a reused pooled client is explicitly initialized and verified on every checkout',async()=>{
 const client=new FakeClient(),pool=new FakePool(client);initializeSupabasePool(pool);
 const first=await pool.connect();first.release();client.settings={search_path:'public',read_only:'on',statement_timeout:'0'};
 const second=await callbackConnect(pool);assert.equal(second.client,client);
 assert.deepEqual(client.settings,{search_path:'pg_catalog,epdg,pg_temp',read_only:'off',statement_timeout:'15s'});
 assert.equal(client.initializations,2);assert.equal(pool.acquires,2);second.release();assert.equal(client.releases.length,2);
});

test('failed initialization destroys the checkout without exposing a client or raw cleanup error',async()=>{
 for(const callback of [false,true])for(const releaseFailure of [false,true]){
  const client=new FakeClient({queryFailure:true,releaseFailure}),pool=new FakePool(client);initializeSupabasePool(pool);
  await assert.rejects(callback?callbackConnect(pool):pool.connect(),safe);
  assert.deepEqual(client.releases,[true]);assert.equal(client.initializations,0);
  assert.ok(!client.queries.includes('SELECT public_synthetic_application_work'));
 }
 const client=new FakeClient({readback:{search_path:'public'}}),pool=new FakePool(client);initializeSupabasePool(pool);
 await assert.rejects(poolQuery(pool),safe);assert.deepEqual(client.releases,[true]);
 assert.ok(!client.queries.includes('SELECT public_synthetic_application_work'));
});

test('native acquire rejection or synchronous failure is sanitized for both checkout overloads',async()=>{
 for(const callback of [false,true])for(const options of [{acquireRejects:true},{acquireThrows:true}]){
  const client=new FakeClient(),pool=new FakePool(client,options);initializeSupabasePool(pool);
  const attempt=async()=>callback?callbackConnect(pool):pool.connect();await assert.rejects(attempt(),safe);
  assert.equal(client.queries.length,0);assert.equal(client.releases.length,0);
 }
});
