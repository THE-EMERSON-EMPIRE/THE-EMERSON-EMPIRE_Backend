'use strict';
// Explicit local-only, B-only rehearsal. Never reads the human A credential.
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const C=require('./common.cjs');
const F=require('./handoff-fixtures.cjs');
const P=require('./crm-producer.cjs');
const {identityGate}=require('./learning-migrate.cjs');
const {frozenSnapshot}=require('./learning-migration-policy.cjs');
const servicePath='/internal/crm/onboarding-handoffs';
const origin='http://127.0.0.1:58080';
const lock='epdg-synthetic-crm-handoff-v1';
const fingerprint=rows=>C.crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function protectedSnapshot(db){
 const tables=['core.users','epdg.users','core.user_branch_roles','portal_security.memberships','portal_security.account_states','synthetic_learning.enrollments'];
 const rows=[];for(const table of tables){const {rows:[r]}=await db.query(`SELECT count(*)::int AS count,
  encode(sha256(convert_to(coalesce(string_agg(j,'|' ORDER BY j),''),'UTF8')),'hex') AS sha256 FROM (SELECT to_jsonb(t)::text AS j FROM ${table} t) q`);rows.push({table,...r});}return rows;
}
function eventFor(version,decision='cleared',overrides={}){
 const input={actor:{id:F.reviewerId,active:true,hr:true,verifiedByServer:true,synthetic:true},
  application:{id:F.applicationId,person_id:F.personId,program_id:F.crmProgramId,revision:1,access:'hr',synthetic:true},
  decision:{id:C.crypto.randomUUID(),reviewer_id:F.reviewerId,application_revision:1,decision_version:version,decision,
   identity_verified:decision==='cleared',onboarding_complete:decision==='cleared',agreements_complete:decision==='cleared',hr_approved:decision==='cleared',
   withdrawn:decision==='revoked',current:true,policy_version:'synthetic-onboarding-v1',synthetic:true}};
 Object.assign(input.decision,overrides);return P.buildSyntheticCrmEvent(input,{eventId:C.crypto.randomUUID()});
}
async function nextVersion(db){return (await db.query('SELECT coalesce(max(decision_version),0)+1 AS version FROM synthetic_handoff.events WHERE mapping_id=$1',[F.mappingId])).rows[0].version;}
async function sendDecision(decision){
 const c=C.config();await C.preflight(c);assert.equal(c.crmHandoffEnabled,true);
 const db=await C.client(c,true);try{await identityGate(db,c);const raw=eventFor(await nextVersion(db),decision);
  const r=await P.sendSyntheticCrmRequest(raw,{key:c.crmHandoffKey});assert.equal(r.status,200);return r.body;}finally{await db.end();}
}
function rawRequest(raw,headers,requestPath=servicePath){return new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port:58000,path:requestPath,method:'POST',agent:false,headers:{...headers,'Content-Length':raw.length},timeout:5000},res=>{
  const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>16384)req.destroy(new Error('Bounded local response exceeded'));else chunks.push(chunk);});
  res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch{reject(new Error('Invalid local response'));}});
 });req.on('timeout',()=>req.destroy(new Error('Local request timed out')));req.on('error',reject);req.end(raw);
});}
function signRaw(raw,c,overrides={}){
 const timestamp=String(Math.floor(Date.now()/1000)),nonce=C.crypto.randomUUID();
 const signature=C.crypto.createHmac('sha256',Buffer.from(c.crmHandoffKey,'base64url')).update(`EPDG-CRM-HANDOFF-V1\nPOST\n${servicePath}\n${timestamp}\n${nonce}\n${C.crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
 return {'Content-Type':'application/json','X-EPDG-Handoff-Key-Id':'synthetic-local-v1','X-EPDG-Handoff-Timestamp':timestamp,'X-EPDG-Handoff-Nonce':nonce,'X-EPDG-Handoff-Signature':signature,...overrides};
}
async function verify({restart=false}={}){
 const c=C.config();await C.preflight(c);assert.equal(c.crmHandoffEnabled,true);assert.match(c.crmHandoffKey,/^[A-Za-z0-9_-]{43}$/);
 const checks=[],sessions=[];let current='startup',db,learner,mentor,version,accepted,acceptedHeaders,receipt,qaItem,qaRevision,qaAttachment,stopped=false;
 const qaBytes=Buffer.from('SYNTHETIC fictional welcome checklist\n');
 let baselineProtected,baselineFrozen,baselineMail,baselineSessions;
 const check=async(name,fn)=>{current=name;await fn();checks.push(name);console.log('PASS '+name);};
 const api=async(path,{session,method='GET',body,binary=false,headers={}}={})=>{
  const form=body instanceof FormData;const h={...(method!=='GET'?{Origin:origin,'X-EPDG-Request':'portal',...(!form?{'Content-Type':'application/json'}:{})}:{}),
   ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...headers};
  const r=await fetch('http://127.0.0.1:58000'+path,{method,headers:h,...(body===undefined?{}:{body:form?body:JSON.stringify(body)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  return {status:r.status,data:binary?Buffer.from(await r.arrayBuffer()):await r.json(),headers:r.headers};
 };
 const login=async email=>{const r=await api('/api/auth/login',{method:'POST',body:{email,password:c.fixturePassword}});assert.equal(r.status,200);
  const s={cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf_token,user:r.data.user};sessions.push(s);return s;};
 const summary=async()=>{const r=await api('/api/learner/onboarding',{session:learner});assert.equal(r.status,200);assert.equal(r.data.privileged_controls_available,false);return r.data.onboarding;};
 const dashboard=()=>api('/api/learner/dashboard',{session:learner});
 const assignment=id=>'/api/learner/assignments/'+id;
 const send=async raw=>{const r=await P.sendSyntheticCrmRequest(raw,{key:c.crmHandoffKey});assert.equal(r.status,200);return r.body;};
 const mailCount=async()=>{const r=await fetch('http://127.0.0.1:58025/api/v1/messages',{headers:C.mailHeaders(c),signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return (await r.json()).total;};
 const control=command=>{const r=spawnSync(process.execPath,[C.path.join(__dirname,'manage.cjs'),command],{env:C.cleanEnv(),cwd:C.core,windowsHide:true,encoding:'utf8',timeout:40000});assert.equal(r.status,0,'Controlled local '+command);};
 try{
  db=await C.client(c,true);await identityGate(db,c);version=await nextVersion(db);
  baselineProtected=await protectedSnapshot(db);baselineFrozen=await frozenSnapshot(db);baselineMail=await mailCount();
  await check('only existing fictional learner B and mentor B sign in; privileged controls remain closed',async()=>{
   learner=await login(F.learnerEmail);mentor=await login(F.mentorEmail);baselineSessions=(await db.query('SELECT count(*)::int AS n FROM portal_security.sessions')).rows[0].n;
   assert.equal(learner.user.privileged_controls_available,false);assert.deepEqual(learner.user.permissions,[]);
   assert.equal((await api('/api/access/admin',{session:learner})).status,403);
   assert.equal((await api('/api/admin',{session:mentor})).status,503);
   assert.equal((await api('/api/learner/onboarding')).status,401);
   assert.equal((await api('/api/learner/onboarding',{session:mentor})).status,403);
   assert.equal((await api('/api/learner/onboarding?user_id=1',{session:learner})).status,400);
  });
  await check('held clearance hides the dedicated program while existing practice stays available',async()=>{
   if(version===1)assert.equal((await summary()).status,'not_received');
   await send(eventFor(version++,'held'));assert.equal((await summary()).status,'held');
   const r=await dashboard();assert.equal(r.status,200);assert.ok(r.data.programs.length>=1);assert.ok(!r.data.programs.some(p=>p.id===F.programId));
   assert.equal((await api('/api/learner/programs/'+F.programId,{session:learner})).status,404);
   assert.equal((await api(assignment(F.assignmentId)+'/submission',{session:learner})).status,404);
   assert.equal((await api('/api/learner/items/'+F.lessonId+'/complete',{session:learner,method:'POST',body:{}})).status,404);
  });
  await check('unsigned, wrong-key, stale and future transport envelopes are rejected',async()=>{
   const raw=eventFor(version);assert.equal((await rawRequest(raw,{'Content-Type':'application/json'})).status,401);
   assert.equal((await rawRequest(raw,signRaw(raw,c,{'X-EPDG-Handoff-Signature':'0'.repeat(64)}))).status,401);
   assert.equal((await rawRequest(raw,P.signSyntheticCrmRequest(raw,{key:c.crmHandoffKey,timestamp:String(Math.floor(Date.now()/1000)-301)}))).status,401);
   assert.equal((await rawRequest(raw,P.signSyntheticCrmRequest(raw,{key:c.crmHandoffKey,timestamp:String(Math.floor(Date.now()/1000)+31)}))).status,401);
  });
  await check('browser cookies origins bearer fetch and proxy headers cannot call the receiver',async()=>{
   const raw=eventFor(version);for(const headers of [{Origin:origin},{Cookie:learner.cookie},{Authorization:'Bearer forbidden'},{'X-EPDG-Request':'portal'},{'Sec-Fetch-Mode':'cors'},{Forwarded:'for=127.0.0.1'},{'X-Forwarded-For':'127.0.0.1'}])
    assert.equal((await rawRequest(raw,signRaw(raw,c,headers))).status,403);
   assert.equal((await rawRequest(raw,signRaw(raw,c),servicePath+'?scope=other')).status,403);
  });
  await check('strict signed payload rejects unknown identity reviewer fields and incomplete clearance',async()=>{
   const event=JSON.parse(eventFor(version));
   for(const mutate of [e=>{e.clearance.hr_approved=false;},e=>{e.email='fictional@epdg.invalid';},e=>{e.environment='production';}]){
    const e=structuredClone(event);mutate(e);const raw=Buffer.from(JSON.stringify(e));assert.equal((await rawRequest(raw,signRaw(raw,c))).status,400);
   }
   for(const field of ['person_id','application_id','program_id']){const e={...event,[field]:C.crypto.randomUUID()},raw=Buffer.from(JSON.stringify(e));assert.equal((await rawRequest(raw,signRaw(raw,c))).status,404);}
   const duplicate=Buffer.from(JSON.stringify(event).replace('"version":1','"version":1,"version":1'));assert.equal((await rawRequest(duplicate,signRaw(duplicate,c))).status,400);
  });
  await check('a current signed clearance makes only the preconfigured local program available',async()=>{
   accepted=eventFor(version++);acceptedHeaders=P.signSyntheticCrmRequest(accepted,{key:c.crmHandoffKey});const r=await rawRequest(accepted,acceptedHeaders);
   assert.equal(r.status,200);assert.equal(r.body.result,'accepted');assert.equal(r.body.current_status,'ready');
   const s=await summary();assert.equal(s.status,'ready');assert.equal(s.program_id,F.programId);assert.equal(s.program_title,F.title);
   const p=await api('/api/learner/programs/'+F.programId,{session:learner});assert.equal(p.status,200);assert.ok(p.data.program.items.some(i=>i.id===F.lessonId));
   assert.ok((await dashboard()).data.programs.some(p=>p.id===F.programId));
  });
  await check('nonce replay collision and stale decision cannot rewrite append-only state',async()=>{
   assert.equal((await rawRequest(accepted,acceptedHeaders)).status,409);
   const duplicate=await send(accepted);assert.equal(duplicate.result,'duplicate');assert.equal(duplicate.current_status,'ready');
   const e=JSON.parse(accepted);e.decision_id=C.crypto.randomUUID();const altered=Buffer.from(JSON.stringify(e));assert.equal((await rawRequest(altered,signRaw(altered,c))).status,409);
   const stale=eventFor(version-1);assert.equal((await P.sendSyntheticCrmRequest(stale,{key:c.crmHandoffKey})).status,409);
  });
  await check('new fictional lesson draft upload submission and mentor review work after clearance',async()=>{
   qaItem=C.crypto.randomUUID();await db.query('BEGIN');try{await identityGate(db,c);
    await db.query(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
     SELECT $1,$2,coalesce(max(position),0)+1,'SYNTHETIC CRM Handoff QA','assignment','SYNTHETIC handoff rehearsal only.',
     'SYNTHETIC describe a fictional welcome plan after a signed onboarding clearance.',clock_timestamp()+interval '7 days'
     FROM synthetic_learning.items WHERE program_id=$2`,[qaItem,F.programId]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
   let r=await api('/api/learner/items/'+F.lessonId+'/complete',{session:learner,method:'POST',body:{}});assert.equal(r.status,200);
   r=await api(assignment(qaItem)+'/draft',{session:learner,method:'POST',body:{answer:'SYNTHETIC fictional welcome plan after approved practice onboarding.',expected_revision:0}});assert.equal(r.status,200);qaRevision=r.data.submission.revision;
   const form=new FormData();form.append('expected_revision',String(qaRevision));form.append('file',new Blob([qaBytes],{type:'text/plain'}),'synthetic-handoff.txt');
   r=await api(assignment(qaItem)+'/attachments',{session:learner,method:'POST',body:form});assert.equal(r.status,200);qaRevision=r.data.submission.revision;
   qaAttachment=r.data.submission.attachments[0];assert.equal(qaAttachment.filename,'synthetic-handoff.txt');
   assert.equal(qaAttachment.sha256,C.crypto.createHash('sha256').update(qaBytes).digest('hex'));
   r=await api(assignment(qaItem)+'/submit',{session:learner,method:'POST',body:{expected_revision:qaRevision}});assert.equal(r.status,200);receipt=r.data.submission.receipt;qaRevision=r.data.submission.revision;
   r=await api('/api/mentor/reviews/'+receipt.id,{session:mentor});assert.equal(r.status,200);
   r=await api('/api/mentor/reviews/'+receipt.id+'/draft',{session:mentor,method:'POST',body:{comment:'SYNTHETIC improve the fictional welcome checklist.',expected_revision:0}});assert.equal(r.status,200);
   r=await api('/api/mentor/reviews/'+receipt.id+'/publish',{session:mentor,method:'POST',body:{expected_revision:r.data.review.draft.revision}});assert.equal(r.status,200);
   r=await api(assignment(qaItem)+'/attempts/'+receipt.id+'/attachments/'+qaAttachment.id+'/download',{session:learner,binary:true});
   assert.equal(r.status,200);assert.deepEqual(r.data,qaBytes);
  });
  await check('receiver waits for an in-flight shared operation lock before confirming withdrawal',async()=>{
   const reader=await C.client(c);try{await reader.query('BEGIN');await reader.query("SELECT set_config('synthetic_handoff.enabled','on',true)");
    await reader.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[lock]);let completed=false;
    const pending=send(eventFor(version++,'revoked')).then(r=>{completed=true;return r;});
    await new Promise(resolve=>setTimeout(resolve,150));assert.equal(completed,false);await reader.query('COMMIT');assert.equal((await pending).current_status,'withdrawn');
   }finally{await reader.end();}
  });
  await check('withdrawal closes learner files revisions mentor views and future writes',async()=>{
   assert.equal((await summary()).status,'withdrawn');assert.ok(!(await dashboard()).data.programs.some(p=>p.id===F.programId));
   for(const suffix of ['/submission','/attempts','/feedback'])assert.equal((await api(assignment(qaItem)+suffix,{session:learner})).status,404);
   assert.equal((await api('/api/mentor/reviews/'+receipt.id,{session:mentor})).status,404);
   assert.equal((await api(assignment(qaItem)+'/attempts/'+receipt.id+'/attachments/'+qaAttachment.id+'/download',{session:learner,binary:true})).status,404);
   assert.equal((await api('/api/mentor/reviews/'+receipt.id+'/attachments/'+qaAttachment.id+'/download',{session:mentor,binary:true})).status,404);
   assert.ok(!(await api('/api/mentor/reviews',{session:mentor})).data.reviews.some(r=>r.receipt_id===receipt.id));
   assert.equal((await api(assignment(qaItem)+'/start-revision',{session:learner,method:'POST',body:{expected_receipt_id:receipt.id,expected_revision:qaRevision}})).status,404);
   assert.equal((await api('/api/learner/items/'+F.lessonId+'/complete',{session:learner,method:'POST',body:{}})).status,404);
  });
  await check('direct SQL cannot bypass a withdrawal or gain mapping enrollment and mutation privileges',async()=>{
   const app=await C.client(c);try{
    await assert.rejects(app.query('INSERT INTO synthetic_learning.completions(enrollment_id,program_id,item_id) VALUES($1,$2,$3)',[F.enrollmentId,F.programId,F.lessonId]),e=>e.code==='23514');
    await app.query("SELECT set_config('synthetic_handoff.enabled','on',false)");
    await assert.rejects(app.query('INSERT INTO synthetic_learning.assignment_drafts(enrollment_id,program_id,item_id,answer,revision) VALUES($1,$2,$3,$4,1)',[F.enrollmentId,F.programId,F.assignmentId,'SYNTHETIC denied draft']),e=>e.code==='23514');
    for(const sql of ['UPDATE synthetic_handoff.events SET withdrawn=false','DELETE FROM synthetic_handoff.nonces','UPDATE synthetic_handoff.mappings SET reviewer_id=reviewer_id','UPDATE synthetic_learning.enrollments SET active=true'])await assert.rejects(app.query(sql),e=>e.code==='42501');
   }finally{await app.end();}
  });
  await check('an old approval retry acknowledges the current withdrawal without reinstating access',async()=>{
   const r=await send(accepted);assert.equal(r.result,'duplicate');assert.equal(r.current_status,'withdrawn');assert.equal(r.decision_version,version-1);assert.equal((await summary()).status,'withdrawn');
  });
  await check('a different signed reviewer may revoke without changing the fixed learner mapping',async()=>{
   const value=JSON.parse(eventFor(version++,'revoked'));value.reviewer_id='80000000-0000-4000-8000-000000000002';
   const raw=Buffer.from(JSON.stringify(value));const r=await rawRequest(raw,signRaw(raw,c));
   assert.equal(r.status,200);assert.equal(r.body.current_status,'withdrawn');assert.equal(r.body.decision_version,value.decision_version);
   const {rows:[retained]}=await db.query('SELECT reviewer_id FROM synthetic_handoff.events WHERE event_id=$1',[value.event_id]);
   assert.equal(retained.reviewer_id,value.reviewer_id);assert.equal((await summary()).status,'withdrawn');
  });
  await check('a newer clearance restores preserved receipt files and published mentor feedback',async()=>{
   await send(eventFor(version++));assert.equal((await summary()).status,'ready');
   const r=await api(assignment(qaItem)+'/attempts',{session:learner});assert.equal(r.status,200);assert.equal(r.data.attempts[0].receipt_id,receipt.id);
   assert.equal(r.data.attempts[0].published_feedback.length,1);assert.equal(r.data.attempts[0].attachments.length,1);
   assert.equal((await api('/api/mentor/reviews/'+receipt.id,{session:mentor})).status,200);
   const file=await api(assignment(qaItem)+'/attempts/'+receipt.id+'/attachments/'+qaAttachment.id+'/download',{session:learner,binary:true});
   assert.equal(file.status,200);assert.deepEqual(file.data,qaBytes);
  });
  if(restart){
   await db.end();db=null;
   await check('durable event and nonce replay protection survive controlled local restart',async()=>{
    control('stop');stopped=true;control('start');stopped=false;db=await C.client(c,true);await identityGate(db,c);
    const replayHeaders=P.signSyntheticCrmRequest(accepted,{key:c.crmHandoffKey,nonce:acceptedHeaders['X-EPDG-Handoff-Nonce']});
    assert.equal((await rawRequest(accepted,replayHeaders)).status,409);assert.equal((await send(accepted)).current_status,'ready');assert.equal((await summary()).status,'ready');
   });
   await db.end();db=null;
   await check('disabled handoff fails closed for managed learning while ordinary practice stays available',async()=>{
    control('stop');stopped=true;const off=C.config();off.crmHandoffEnabled=false;C.fs.writeFileSync(C.configFile,JSON.stringify(off,null,2));
    try{control('start');stopped=false;assert.equal((await api('/api/learner/onboarding',{session:learner})).status,503);
     const r=await dashboard();assert.equal(r.status,200);assert.ok(r.data.programs.length>=1);assert.ok(!r.data.programs.some(p=>p.id===F.programId));
     assert.equal((await api('/api/learner/programs/'+F.programId,{session:learner})).status,404);assert.equal((await P.sendSyntheticCrmRequest(eventFor(version),{key:c.crmHandoffKey})).status,503);
    }finally{control('stop');stopped=true;const on=C.config();on.crmHandoffEnabled=true;C.fs.writeFileSync(C.configFile,JSON.stringify(on,null,2));control('start');stopped=false;}
    db=await C.client(c,true);await identityGate(db,c);assert.equal((await summary()).status,'ready');
   });
  }
  await check('accounts passwords memberships roles enrollment and all pre-existing immutable evidence are preserved',async()=>{
   assert.deepEqual(await protectedSnapshot(db),baselineProtected);
   const after=await frozenSnapshot(db);for(const row of baselineFrozen)assert.deepEqual(after.find(r=>r.kind===row.kind&&r.id===row.id),row);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM portal_security.sessions')).rows[0].n,baselineSessions);
   assert.equal(await mailCount(),baselineMail);
  });
  await check('final local fixture returns to held with retained history and closed privileged controls',async()=>{
   await send(eventFor(version++,'held'));assert.equal((await summary()).status,'held');assert.ok(!(await dashboard()).data.programs.some(p=>p.id===F.programId));
  });
  const result={at:new Date().toISOString(),passed:checks.length,checks,restartProof:restart,
   preExistingImmutableRows:baselineFrozen.length,preExistingImmutableSha256:fingerprint(baselineFrozen),protectedTables:baselineProtected,
   accountsCreated:0,passwordsChanged:false,rolesChanged:false,realInternRecordsUsed:false,outboundMail:0,productionTouched:false,
   finalStatus:'held',privilegedControlsAvailable:false};
  C.fs.writeFileSync(C.path.join(C.state,'handoff-verification.receipt.json'),JSON.stringify(result,null,2));
  return result;
 }catch(error){console.error('Handoff rehearsal failed at:',current);throw error;}
 finally{
  if(stopped){const restored=C.config();restored.crmHandoffEnabled=true;C.fs.writeFileSync(C.configFile,JSON.stringify(restored,null,2));control('start');}
  for(const session of sessions)try{await api('/api/auth/logout',{session,method:'POST',body:{}});}catch{}
  if(db)await db.end();
 }
}
module.exports={verify,eventFor,sendDecision,protectedSnapshot};
if(require.main===module){const command=process.argv[2];const work=['cleared','held','revoked'].includes(command)?sendDecision(command):verify({restart:process.argv.includes('--restart')});
 work.then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Local synthetic handoff verification failed; inspect the named check without exporting runtime secrets.');process.exitCode=1;});}
