'use strict';
// B-only fictional live acceptance. Never reads human A credentials/sessions.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const C=require('./common.cjs');
const {identityGate}=require('./learning-migrate.cjs');
const origin='http://127.0.0.1:58080',base='http://127.0.0.1:58000';
const program='10000000-0000-4000-8000-000000000003';
async function verify({restart=false}={}){
 const c=C.config();await C.preflight(c);const checks=[],sessions=[];let current='startup',operator,stopped=false;
 let learner,second,mentor,capItem,browserItem,state,first,firstFeedback,firstHistory,firstReview,enrollment;
 const text=Buffer.from('SYNTHETIC original fictional plan. No real participants.\n');
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC fictional practice file\n%%EOF\n');
 const check=async(name,work)=>{current=name;await work();checks.push(name);console.log('PASS '+name);};
 const api=async(path,{session,method='GET',body,headers={},binary=false}={})=>{
  const unsafe=method!=='GET';const form=body instanceof FormData;
  const h={...(unsafe?{Origin:origin,'X-EPDG-Request':'portal',...(!form?{'Content-Type':'application/json'}:{})}:{}),
   ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...headers};
  for(const key of Object.keys(h))if(h[key]===null)delete h[key];
  const r=await fetch(base+path,{method,headers:h,...(body===undefined?{}:{body:form?body:JSON.stringify(body)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  return {status:r.status,data:binary?Buffer.from(await r.arrayBuffer()):await r.json(),headers:r.headers};
 };
 const login=async email=>{const r=await api('/api/auth/login',{method:'POST',body:{email,password:c.fixturePassword}});assert.equal(r.status,200);
  const s={cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf_token,user:r.data.user};sessions.push(s);return s;};
 const path=id=>'/api/learner/assignments/'+id;
 const read=async(id=capItem)=>{const r=await api(path(id)+'/submission',{session:learner});assert.equal(r.status,200);return r.data.submission;};
 const history=async(id=capItem)=>{const r=await api(path(id)+'/attempts',{session:learner});assert.equal(r.status,200);return r.data.attempts;};
 const save=async(id,answer,revision)=>{const r=await api(path(id)+'/draft',{session:learner,method:'POST',body:{answer,expected_revision:revision}});assert.equal(r.status,200);return r.data.submission;};
 const upload=async(id,revision,name='synthetic.txt',bytes=text,type='text/plain')=>{
  const body=new FormData();body.append('expected_revision',String(revision));body.append('file',new Blob([bytes],{type}),name);
  return api(path(id)+'/attachments',{session:learner,method:'POST',body});
 };
 const remove=async(id,file,revision)=>api(path(id)+'/attachments/'+file+'/remove',{session:learner,method:'POST',body:{expected_revision:revision}});
 const submit=async(id,revision)=>{const r=await api(path(id)+'/submit',{session:learner,method:'POST',body:{expected_revision:revision}});assert.equal(r.status,200);return r.data.submission;};
 const start=(id,receipt,revision,session=learner,options={})=>api(path(id)+'/start-revision',{session,method:'POST',body:{expected_receipt_id:receipt,expected_revision:revision},...options});
 const review=async receipt=>{const r=await api('/api/mentor/reviews/'+receipt,{session:mentor});assert.equal(r.status,200);return r.data.review;};
 const publish=async(receipt,comment='SYNTHETIC mentor feedback: Add one fictional example and a clear next step.')=>{
  let r=await review(receipt);const d=await api('/api/mentor/reviews/'+receipt+'/draft',{session:mentor,method:'POST',body:{comment,expected_revision:r.draft?.revision??0}});assert.equal(d.status,200);
  const p=await api('/api/mentor/reviews/'+receipt+'/publish',{session:mentor,method:'POST',body:{expected_revision:d.data.review.draft.revision}});assert.equal(p.status,200);return p.data.review.published;
 };
 const historicalDownload=(item,receipt,file,session=learner)=>api(path(item)+'/attempts/'+receipt+'/attachments/'+file+'/download',{session,binary:true});
 const makeItem=async title=>{const id=C.crypto.randomUUID();await operator.query('BEGIN');
  try{await identityGate(operator,c);await operator.query("SELECT pg_advisory_xact_lock(hashtext('synthetic-revision-qa-fixtures'))");
   await operator.query(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
    SELECT $1,$2,coalesce(max(position),0)+1,$3,'assignment','SYNTHETIC revision practice. Fictional text only.',
    'SYNTHETIC assignment: describe an imaginary plan, then improve it after published mentor feedback.',clock_timestamp()-interval '1 minute'
    FROM synthetic_learning.items WHERE program_id=$2`,[id,program,title]);await operator.query('COMMIT');return id;
  }catch(e){await operator.query('ROLLBACK');throw e;}};
 const control=command=>{const r=spawnSync(process.execPath,[C.path.join(__dirname,'manage.cjs'),command],{env:C.cleanEnv(),cwd:C.core,windowsHide:true,encoding:'utf8',timeout:40000});assert.equal(r.status,0,'Controlled synthetic '+command);};
 try{
  await check('revision routes reject anonymous bearer school and foreign assignment access',async()=>{
   const foreign='30000000-0000-4000-8000-000000000004';
   for(const route of [path(foreign)+'/attempts',path(foreign)+'/attempts/'+C.crypto.randomUUID()+'/attachments/'+C.crypto.randomUUID()+'/download'])assert.equal((await api(route)).status,401);
   learner=await login('learner-b@epdg.invalid');second=await login('learner-b@epdg.invalid');mentor=await login('school-b@epdg.invalid');
   assert.equal((await api(path(foreign)+'/attempts',{session:learner})).status,404);
   assert.equal((await api(path(foreign)+'/attempts',{session:mentor})).status,403);
   assert.equal((await api(path(foreign)+'/attempts',{headers:{Authorization:'Bearer forbidden'}})).status,401);
  });
  await check('guarded B-only fixtures begin at attempt one without published feedback',async()=>{
   operator=await C.client(c,true);capItem=await makeItem('SYNTHETIC Revision Limit QA');
   enrollment=(await operator.query('SELECT id FROM synthetic_learning.enrollments WHERE user_id=$1 AND program_id=$2',[learner.user.id,program])).rows[0].id;
   state=await read();assert.equal(state.attempt_number,1);assert.equal(state.previous_receipt_id,null);assert.equal(state.can_start_revision,false);
   state=await save(capItem,'SYNTHETIC original plan for a fictional workshop.',0);
   let r=await upload(capItem,state.revision);assert.equal(r.status,200);state=r.data.submission;
   r=await upload(capItem,state.revision,'synthetic-removed.pdf',pdf,'application/pdf');assert.equal(r.status,200);state=r.data.submission;
   r=await remove(capItem,state.attachments[1].id,state.revision);assert.equal(r.status,200);state=r.data.submission;
   state=await submit(capItem,state.revision);first=state;assert.equal(first.can_start_revision,false);
   assert.equal((await start(capItem,first.receipt.id,first.revision)).status,409);
  });
  await check('only published latest feedback enables revision and binding selectors are strict',async()=>{
   const d=await api('/api/mentor/reviews/'+first.receipt.id+'/draft',{session:mentor,method:'POST',body:{comment:'SYNTHETIC private suggestion.',expected_revision:0}});assert.equal(d.status,200);
   assert.equal((await start(capItem,first.receipt.id,first.revision)).status,409);
   firstFeedback=await publish(first.receipt.id);state=await read();assert.equal(state.can_start_revision,true);
   firstHistory=(await history())[0];firstReview=await review(first.receipt.id);
   assert.equal(firstHistory.attempt_number,1);assert.deepEqual(firstHistory.attachments,first.attachments);assert.deepEqual(firstHistory.published_feedback,[firstFeedback]);
   assert.equal((await start(capItem,first.receipt.id,first.revision,learner,{headers:{'X-CSRF-Token':null}})).status,403);
   assert.equal((await start(capItem,first.receipt.id,first.revision,learner,{body:{expected_receipt_id:first.receipt.id,expected_revision:first.revision,attempt_number:5}})).status,400);
   assert.equal((await api(path(capItem)+'/attempts?user_id=1',{session:learner})).status,400);
  });
  await check('concurrent exact revision starts create one monotonic copied draft and no inherited files',async()=>{
   const results=await Promise.all([start(capItem,first.receipt.id,first.revision),start(capItem,first.receipt.id,first.revision,second)]);
   assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].data,results[1].data);state=results[0].data.submission;
   assert.equal(state.attempt_number,2);assert.equal(state.revision,first.revision+1);assert.equal(state.previous_receipt_id,first.receipt.id);
   assert.equal(state.answer,first.answer);assert.deepEqual(state.attachments,[]);assert.deepEqual(state.removed_attachments,[]);assert.equal(state.receipt,null);assert.equal(state.can_start_revision,false);
   assert.deepEqual((await history())[0],firstHistory);const f=await api(path(capItem)+'/feedback',{session:learner});assert.equal(f.data.receipt_id,null);assert.deepEqual(f.data.feedback,[]);
  });
  await check('earlier frozen files remain receipt-scoped and cannot be removed restored or reassigned',async()=>{
   const file=first.attachments[0];let r=await historicalDownload(capItem,first.receipt.id,file.id);assert.equal(r.status,200);assert.deepEqual(r.data,text);
   assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-security-policy'),/sandbox/);
   assert.equal((await api(path(capItem)+'/attachments/'+file.id+'/download',{session:learner,binary:true})).status,404);
   assert.equal((await remove(capItem,file.id,state.revision)).status,404);
   const removed=(await operator.query('SELECT id FROM synthetic_learning.assignment_attachments WHERE enrollment_id=$1 AND item_id=$2 AND attempt_number=1 AND removed',[enrollment,capItem])).rows[0].id;
   assert.equal((await historicalDownload(capItem,first.receipt.id,removed)).status,404);
   assert.equal((await api(path(capItem)+'/attachments/'+removed+'/restore',{session:learner,method:'POST',body:{expected_revision:state.revision}})).status,404);
   const app=await C.client(c);try{await assert.rejects(app.query('UPDATE synthetic_learning.assignment_attachments SET removed=true WHERE id=$1',[file.id]),e=>e.code==='23514');}finally{await app.end();}
   assert.deepEqual(await review(first.receipt.id),firstReview);
  });
  await check('an intervening edit makes the earlier start retry stale without altering the attempt chain',async()=>{
   state=await save(capItem,'SYNTHETIC improved plan with one invented example.',state.revision);
   assert.equal((await start(capItem,first.receipt.id,first.revision)).status,409);assert.equal((await read()).attempt_number,2);
  });
  await check('new attempt file quotas are isolated and remain three active six lifetime records',async()=>{
   for(let n=1;n<=3;n++){const r=await upload(capItem,state.revision,'new-'+n+'.txt',Buffer.from('SYNTHETIC '+n));assert.equal(r.status,200);state=r.data.submission;}
   assert.equal((await upload(capItem,state.revision,'too-many.txt')).status,409);
   for(let n=4;n<=6;n++){let r=await remove(capItem,state.attachments[0].id,state.revision);assert.equal(r.status,200);state=r.data.submission;
    r=await upload(capItem,state.revision,'new-'+n+'.txt',Buffer.from('SYNTHETIC '+n));assert.equal(r.status,200);state=r.data.submission;}
   let r=await remove(capItem,state.attachments[0].id,state.revision);assert.equal(r.status,200);state=r.data.submission;
   assert.equal((await upload(capItem,state.revision,'seventh.txt')).status,409);
   const restore=state.removed_attachments[0];r=await api(path(capItem)+'/attachments/'+restore.id+'/restore',{session:learner,method:'POST',body:{expected_revision:state.revision}});assert.equal(r.status,200);state=r.data.submission;
   assert.equal(state.attachments.length,3);assert.equal(state.attachments.length+state.removed_attachments.length,6);
  });
  await check('resubmission creates a distinct frozen receipt with no inherited mentor review',async()=>{
   state=await submit(capItem,state.revision);assert.equal(state.attempt_number,2);assert.notEqual(state.receipt.id,first.receipt.id);assert.equal(state.previous_receipt_id,first.receipt.id);assert.ok(state.revision>first.revision);assert.equal(state.can_start_revision,false);
   const h=await history();assert.equal(h.length,2);assert.deepEqual(h[0],firstHistory);assert.deepEqual(h[1].published_feedback,[]);
   const q=await api('/api/mentor/reviews',{session:mentor});for(const n of [1,2])assert.ok(q.data.reviews.some(r=>r.item_id===capItem&&r.attempt_number===n));
   const r=await review(state.receipt.id);assert.equal(r.attempt_number,2);assert.equal(r.draft,null);assert.equal(r.published,null);
   assert.equal((await start(capItem,state.receipt.id,state.revision)).status,409);
  });
  await check('latest-only feedback gate and five-attempt cap preserve every prior publication',async()=>{
   for(let n=3;n<=5;n++){await publish(state.receipt.id);assert.equal((await start(capItem,first.receipt.id,state.revision)).status,409);
    const r=await start(capItem,state.receipt.id,state.revision);assert.equal(r.status,200);state=r.data.submission;assert.equal(state.attempt_number,n);
    state=await save(capItem,'SYNTHETIC revised fictional plan attempt '+n,state.revision);state=await submit(capItem,state.revision);assert.equal(state.can_start_revision,false);}
   await publish(state.receipt.id);state=await read();assert.equal(state.attempt_number,5);assert.equal(state.can_start_revision,false);
   assert.equal((await start(capItem,state.receipt.id,state.revision)).status,409);const h=await history();assert.deepEqual(h.map(a=>a.attempt_number),[1,2,3,4,5]);assert.deepEqual(h[0],firstHistory);
   for(let i=1;i<h.length;i++)assert.ok(h[i].submission_revision>h[i-1].submission_revision);
  });
  await check('current enrollment withdrawal hides revision history files and mentor reviews',async()=>{
   try{await operator.query('UPDATE synthetic_learning.enrollments SET active=false WHERE id=$1',[enrollment]);
    assert.equal((await api(path(capItem)+'/attempts',{session:learner})).status,404);assert.equal((await historicalDownload(capItem,first.receipt.id,first.attachments[0].id)).status,404);
    assert.equal((await api('/api/mentor/reviews/'+first.receipt.id,{session:mentor})).status,404);
   }finally{await operator.query('UPDATE synthetic_learning.enrollments SET active=true WHERE id=$1',[enrollment]);}
   assert.deepEqual((await history())[0],firstHistory);
  });
  await check('runtime cannot forge receipt or file attempts and published immutable records remain protected',async()=>{
   const app=await C.client(c);try{const grants=(await app.query(`SELECT
    has_column_privilege(current_user,'synthetic_learning.assignment_receipts','attempt_number','INSERT,UPDATE') AS receipt_attempt,
    has_column_privilege(current_user,'synthetic_learning.assignment_receipts','previous_receipt_id','INSERT,UPDATE') AS receipt_parent,
    has_column_privilege(current_user,'synthetic_learning.assignment_attachments','attempt_number','INSERT,UPDATE') AS file_attempt,
    has_column_privilege(current_user,'synthetic_learning.assignment_drafts','attempt_number','UPDATE') AS guarded_start`)).rows[0];
    assert.deepEqual(grants,{receipt_attempt:false,receipt_parent:false,file_attempt:false,guarded_start:true});
    await assert.rejects(app.query('UPDATE synthetic_learning.assignment_drafts SET attempt_number=1,previous_receipt_id=null,revision=revision+1 WHERE enrollment_id=$1 AND item_id=$2',[enrollment,capItem]),e=>e.code==='23514');
    await assert.rejects(app.query('UPDATE synthetic_learning.assignment_receipts SET answer=$2 WHERE id=$1',[first.receipt.id,'SYNTHETIC forbidden']),e=>e.code==='42501');
   }finally{await app.end();}
   const {rows:[tables]}=await operator.query("SELECT count(*)::int AS tables,count(*) FILTER(WHERE relrowsecurity)::int AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='synthetic_learning' AND c.relkind='r'");assert.deepEqual(tables,{tables:15,rls:15});
  });
  await check('fresh B browser practice retains first receipt files and published feedback ready for revision two',async()=>{
   browserItem=await makeItem('SYNTHETIC Revision Practice');let b=await save(browserItem,'SYNTHETIC first plan: organize an imaginary workshop with a fictional team.',0);
   let r=await upload(browserItem,b.revision,'synthetic-original-plan.txt',text);assert.equal(r.status,200);b=r.data.submission;
   b=await submit(browserItem,b.revision);await publish(b.receipt.id);b=await read(browserItem);assert.equal(b.can_start_revision,true);assert.equal(b.attempt_number,1);
  });
  if(restart)await check('attempt chain historical bytes feedback and authenticated sessions survive a full local restart',async()=>{
   const h=await history();await operator.end();operator=undefined;control('stop');stopped=true;control('start');stopped=false;
   assert.deepEqual(await history(),h);assert.deepEqual((await historicalDownload(capItem,first.receipt.id,first.attachments[0].id)).data,text);
   assert.equal((await read(browserItem)).can_start_revision,true);
  });
  const browserState=await read(browserItem);const report={at:new Date().toISOString(),checksPassed:checks.length,checks,fullRuntimeRestartTested:restart,
   capTestItem:capItem,capAttempts:5,browserFixture:{item_id:browserItem,program_id:program,learner:'learner-b@epdg.invalid',mentor:'school-b@epdg.invalid',attempt_number:1,receipt_id:browserState.receipt.id,revision:browserState.revision,can_start_revision:true,attachments:browserState.attachments.map(a=>({id:a.id,filename:a.filename,sha256:a.sha256,size_bytes:a.size_bytes}))},
   learnerAPasswordOrSessionAccessed:false,credentialsPersisted:false,productionTouched:false,privilegedControlsEnabled:false};
  C.fs.writeFileSync(C.path.join(C.state,'revision-verification.receipt.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checksPassed:checks.length,fullRuntimeRestartTested:restart,browserItem,productionTouched:false}));return report;
 }catch(error){C.fs.writeFileSync(C.path.join(C.state,'revision-verify.failure.json'),JSON.stringify({at:new Date().toISOString(),check:current,errorType:error.name,code:error.code},null,2));console.error('Revision verification failed at: '+current);throw error;
 }finally{if(operator)await operator.end();if(stopped)control('start');for(const s of sessions)try{await api('/api/auth/logout',{session:s,method:'POST',body:{}});}catch{}}
}
module.exports={verify};
if(require.main===module)verify({restart:process.argv.includes('--restart')}).catch(()=>{process.exitCode=1;});
