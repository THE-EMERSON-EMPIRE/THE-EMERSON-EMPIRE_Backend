'use strict';
// Supplemental receiver race/rollback checks; no portal login or real CRM data.
const assert=require('node:assert/strict');
const http=require('node:http');
const C=require('./common.cjs');
const F=require('./handoff-fixtures.cjs');
const P=require('./crm-producer.cjs');
const {eventFor}=require('./handoff-verify.cjs');
const {identityGate}=require('./learning-migrate.cjs');
const path='/internal/crm/onboarding-handoffs';
function headers(raw,c){const timestamp=String(Math.floor(Date.now()/1000)),nonce=C.crypto.randomUUID();return {
 'Content-Type':'application/json','X-EPDG-Handoff-Key-Id':'synthetic-local-v1','X-EPDG-Handoff-Timestamp':timestamp,'X-EPDG-Handoff-Nonce':nonce,
 'X-EPDG-Handoff-Signature':C.crypto.createHmac('sha256',Buffer.from(c.crmHandoffKey,'base64url')).update(`EPDG-CRM-HANDOFF-V1\nPOST\n${path}\n${timestamp}\n${nonce}\n${C.crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex')};}
function request(raw,h){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:58000,path,method:'POST',agent:false,headers:{...h,'Content-Length':raw.length},timeout:5000},res=>{
 const chunks=[];let size=0;res.on('data',v=>{size+=v.length;if(size>16384)req.destroy(new Error('Bounded response exceeded'));else chunks.push(v);});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch{reject(new Error('Invalid bounded response'));}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Local request timed out')));req.end(raw);});}
async function verify(){const c=C.config();await C.preflight(c);assert.equal(c.crmHandoffEnabled,true);const db=await C.client(c,true),checks=[];let current='startup';
 const check=async(name,fn)=>{current=name;await fn();checks.push(name);console.log('PASS '+name);};
 const next=async()=> (await db.query('SELECT coalesce(max(decision_version),0)+1 AS n FROM synthetic_handoff.events WHERE mapping_id=$1',[F.mappingId])).rows[0].n;
 const absent=async(raw,h)=>{assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.events WHERE event_id=$1',[JSON.parse(raw).event_id])).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.nonces WHERE nonce=$1',[h['X-EPDG-Handoff-Nonce']])).rows[0].n,0);};
 let accepted;
 try{await identityGate(db,c);
  await check('concurrent different events at one version accept exactly one held decision',async()=>{
   const version=await next(),a=eventFor(version,'held'),b=eventFor(version,'held');const r=await Promise.all([P.sendSyntheticCrmRequest(a,{key:c.crmHandoffKey}),P.sendSyntheticCrmRequest(b,{key:c.crmHandoffKey})]);
   assert.deepEqual(r.map(v=>v.status).sort(),[200,409]);assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.events WHERE mapping_id=$1 AND decision_version=$2',[F.mappingId,version])).rows[0].n,1);
  });
  await check('concurrent exact event retries retain one event and two independent transport nonces',async()=>{
   accepted=eventFor(await next(),'held');const r=await Promise.all([P.sendSyntheticCrmRequest(accepted,{key:c.crmHandoffKey}),P.sendSyntheticCrmRequest(accepted,{key:c.crmHandoffKey})]);
   assert.deepEqual(r.map(v=>v.status),[200,200]);assert.deepEqual(r.map(v=>v.body.result).sort(),['accepted','duplicate']);const id=JSON.parse(accepted).event_id;
   assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.events WHERE event_id=$1',[id])).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.nonces WHERE event_id=$1',[id])).rows[0].n,2);
  });
  await check('reused nonce for another event rolls back without creating an event',async()=>{
   const oldNonce=(await db.query('SELECT nonce FROM synthetic_handoff.nonces WHERE event_id=$1 ORDER BY nonce LIMIT 1',[JSON.parse(accepted).event_id])).rows[0].nonce;
   const raw=eventFor(await next(),'held'),h=P.signSyntheticCrmRequest(raw,{key:c.crmHandoffKey,nonce:oldNonce});assert.equal((await request(raw,h)).status,409);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.events WHERE event_id=$1',[JSON.parse(raw).event_id])).rows[0].n,0);
  });
  await check('decision identity collision atomically rolls back both new event and nonce',async()=>{
   const event=JSON.parse(eventFor(await next(),'held'));event.decision_id=JSON.parse(accepted).decision_id;const raw=Buffer.from(JSON.stringify(event)),h=headers(raw,c);
   assert.equal((await request(raw,h)).status,409);await absent(raw,h);
  });
  await check('fresh transport cannot deliver an expired or future new source decision',async()=>{
   for(const offset of [-301000,60000]){const event=JSON.parse(eventFor(await next(),'held'));event.issued_at=new Date(Date.now()+offset).toISOString();const raw=Buffer.from(JSON.stringify(event)),h=headers(raw,c);
    assert.equal((await request(raw,h)).status,400);await absent(raw,h);}
  });
  await check('oversized signed body is rejected before parsing or ledger mutation',async()=>{
   const raw=Buffer.concat([eventFor(await next(),'held'),Buffer.alloc(8193,32)]),h=headers(raw,c);const before=(await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.events')).rows[0].n;
   assert.equal((await request(raw,h)).status,413);assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.events')).rows[0].n,before);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM synthetic_handoff.nonces WHERE nonce=$1',[h['X-EPDG-Handoff-Nonce']])).rows[0].n,0);
  });
  const latest=(await db.query('SELECT decision,withdrawn FROM synthetic_handoff.events WHERE mapping_id=$1 ORDER BY decision_version DESC LIMIT 1',[F.mappingId])).rows[0];
  assert.deepEqual(latest,{decision:'held',withdrawn:false});
  const result={at:new Date().toISOString(),passed:checks.length,checks,finalStatus:'held',accountsCreated:0,portalLogins:0,realRecordsUsed:false,productionTouched:false};
  C.fs.writeFileSync(C.path.join(C.state,'handoff-edge-verification.receipt.json'),JSON.stringify(result,null,2));return result;
 }catch(error){console.error('Handoff edge rehearsal failed at:',current);throw error;}finally{await db.end();}}
module.exports={verify};
if(require.main===module)verify().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Synthetic receiver edge checks failed; no private values exported.');process.exitCode=1;});
