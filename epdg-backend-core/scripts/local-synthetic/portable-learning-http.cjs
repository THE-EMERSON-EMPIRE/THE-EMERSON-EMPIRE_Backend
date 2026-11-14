'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),bcrypt=require('bcrypt');
/** Called only by the isolated master review runner; fixtures never use real identities. */
async function verifyPortableLearning({operator,runtime,founderId,organizationId,config,baseUrl}){
 const boundary=(await operator.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port")).rows[0];
 assert.equal(boundary.db,'epdg_synthetic');assert.equal(boundary.host,'127.0.0.1');assert.equal(boundary.port,55432);
 const origin=config.origin??config.portalOrigin??'http://127.0.0.1:58080';
 const password='SYNTHETIC-Learning-Review-2026!';const hashed=await bcrypt.hash(password,12);
 const ids={learnerA:900001,learnerB:900002,mentor:900003},emails={learnerA:'phase2-learner-a@epdg.invalid',learnerB:'phase2-learner-b@epdg.invalid',mentor:'phase2-mentor@epdg.invalid'};
 const memberships={},sessions={},groups={learnerA:crypto.randomUUID(),learnerB:crypto.randomUUID()},plans={},programs={},enrollments={},items={};let checks=0;
 const check=(value,message)=>{assert.ok(value,message);checks++;};
 for(const [label,id] of Object.entries(ids)){
  await operator.query('INSERT INTO core.users(id,email,name,password,is_verified) VALUES($1,$2,$3,$4,true)',[id,emails[label],'SYNTHETIC '+label,hashed]);
  await operator.query("INSERT INTO epdg.users(id,email,name,password,role,is_verified) VALUES($1,$2,$3,$4,'intern',true)",[id,emails[label],'SYNTHETIC '+label,hashed]);
  await operator.query("INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) SELECT $1,id,'intern' FROM core.branches WHERE code='epdg'",[id]);
  await operator.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)',[id]);
  memberships[label]=(await operator.query('INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES($1,$2,true) RETURNING id',[id,organizationId])).rows[0].id;
 }
 for(const id of Object.values(groups))await operator.query("INSERT INTO portal_access.groups(id,organization_id,kind,name) VALUES($1,$2,'program','SYNTHETIC release curriculum')",[id,organizationId]);
 for(const label of ['learnerA','learnerB','mentor'])await runtime.query("SELECT portal_access.grant_role($1,$2,$3,'group',$4,'SYNTHETIC founder education approval')",[founderId,ids[label],label==='mentor'?'program_coordinator':'participant',groups[label==='mentor'?'learnerA':label]]);
 for(const label of ['learnerA','learnerB']){
  const hash='0'.repeat(64);plans[label]=(await operator.query(`INSERT INTO portal_accounts.provisioning_plans(organization_id,email,name,roles,payload_hash,status,onboarding_status,onboarding_verified_by,onboarding_evidence_ref,created_by,approved_by,approved_revision,approved_hash,user_id,identity_action)
   VALUES($1,$2,$3,$4,$5,'provisioned','verified',$6,'SYNTHETIC-CRM-EVIDENCE',$6,$6,1,$5,$7,'reused') RETURNING id`,[organizationId,emails[label],'SYNTHETIC '+label,JSON.stringify([{role_code:'participant',scope_type:'group',scope_id:groups[label]}]),hash,founderId,ids[label]])).rows[0].id;
  programs[label]=crypto.randomUUID();enrollments[label]=crypto.randomUUID();items[label]=crypto.randomUUID();
  await operator.query("INSERT INTO portal_learning.programs(id,organization_id,access_group_id,title,summary,starts_at,ends_at) VALUES($1,$2,$3,'SYNTHETIC Professional Communication','Practice clear communication and reflect on feedback.',now(),now()+interval '30 days')",[programs[label],organizationId,groups[label]]);
  await operator.query('INSERT INTO portal_learning.enrollments(id,program_id,user_id,organization_id,membership_id,onboarding_plan_id,active) VALUES($1,$2,$3,$4,$5,$6,true)',[enrollments[label],programs[label],ids[label],organizationId,memberships[label],plans[label]]);
  await operator.query("INSERT INTO portal_learning.items(id,program_id,position,title,kind,description,content) VALUES($1,$2,1,'SYNTHETIC Reflection','assignment','Describe an imagined deadline change.','Write a fictional plan, save your response and submit it for feedback.')",[items[label],programs[label]]);
 }
 const lesson=crypto.randomUUID();await operator.query("INSERT INTO portal_learning.items(id,program_id,position,title,kind,description,content) VALUES($1,$2,2,'SYNTHETIC Clear Communication','lesson','A short communication practice.','Choose an audience, explain the change and invite questions.')",[lesson,programs.learnerA]);
 const mapping=crypto.randomUUID();await operator.query("INSERT INTO portal_learning.mentor_assignments(id,mentor_user_id,membership_id,enrollment_id,organization_id,active,mentor_label) VALUES($1,$2,$3,$4,$5,true,'SYNTHETIC Mentor')",[mapping,ids.mentor,memberships.mentor,enrollments.learnerA,organizationId]);
 const request=async(label,path,body,expected=200)=>{
  const headers={'X-EPDG-Request':'portal',Origin:origin};const session=sessions[label];if(session){headers.Cookie=session.cookie;headers['X-CSRF-Token']=session.csrf;}
  if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(baseUrl.replace(/\/$/,'')+'/api'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,`${path}: ${data.message??'unexpected status'}`);checks++;return {response,data};
 };
 for(const label of Object.keys(ids)){
  const {response,data}=await request(label,'/auth/login',{email:emails[label],password});
  sessions[label]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:data.csrf_token};
  check(data.user.portal_roles.includes(label==='mentor'?'program_coordinator':'participant'),'Canonical education role reaches session');
 }
 const dashboard=(await request('learnerA','/learner/dashboard')).data;
 check(dashboard.programs.length===1&&dashboard.programs[0].id===programs.learnerA,'Portable learner dashboard is assigned-only');
 check((await request('learnerA','/learner/onboarding')).data.onboarding.status==='ready','Specific approved HR plan enables onboarding');
 await request('learnerA',`/learner/programs/${programs.learnerB}`,undefined,404);
 await request('learnerB',`/learner/assignments/${items.learnerA}/submission`,undefined,404);
 let state=(await request('learnerA',`/learner/assignments/${items.learnerA}/draft`,{answer:'SYNTHETIC I would explain the change and confirm the next step.',expected_revision:0})).data.submission;
 check(state.state==='draft'&&state.revision===1,'Portable draft saved');
 await request('learnerA',`/learner/assignments/${items.learnerA}/draft`,{answer:'stale',expected_revision:0},409);
 state=(await request('learnerA',`/learner/assignments/${items.learnerA}/submit`,{expected_revision:state.revision})).data.submission;
 check(state.state==='submitted'&&state.receipt.id,'Portable submitted receipt generated');
 const receipt=state.receipt.id;
 check((await request('mentor','/mentor/reviews')).data.reviews.some(row=>row.receipt_id===receipt),'Mapped mentor receives actual submitted work');
 await request('learnerB',`/mentor/reviews/${receipt}`,undefined,403);
 await request('mentor',`/mentor/reviews/${receipt}/draft`,{comment:'SYNTHETIC Clear plan. Add a review date in your next revision.',expected_revision:0});
 await request('mentor',`/mentor/reviews/${receipt}/publish`,{expected_revision:1});
 check((await request('learnerA',`/learner/assignments/${items.learnerA}/feedback`)).data.feedback.length===1,'Published mentor feedback reaches learner');
 state=(await request('learnerA',`/learner/assignments/${items.learnerA}/start-revision`,{expected_receipt_id:receipt,expected_revision:1})).data.submission;
 check(state.attempt_number===2&&state.previous_receipt_id===receipt,'Revision retains prior receipt');
 check((await request('learnerA',`/learner/assignments/${items.learnerA}/attempts`)).data.attempts.length===1,'Prior submission remains available');
 await request('learnerA',`/learner/items/${lesson}/complete`,{});
 await operator.query('UPDATE portal_learning.mentor_assignments SET active=false WHERE id=$1',[mapping]);
 await request('mentor',`/mentor/reviews/${receipt}`,undefined,404);
 const history=(await request('learnerA',`/learner/assignments/${items.learnerA}/attempts`)).data.attempts;
 check(history.some(attempt=>attempt.receipt_id===receipt&&attempt.published_feedback.length===1),'Historical feedback survives mapping removal');
 await operator.query('UPDATE portal_learning.mentor_assignments SET active=true WHERE id=$1',[mapping]);
 await operator.query("UPDATE portal_accounts.provisioning_plans SET onboarding_status='required' WHERE id=$1",[plans.learnerA]);
 check((await request('learnerA','/learner/dashboard')).data.programs.length===0,'HR hold closes portable program data');
 await operator.query("UPDATE portal_accounts.provisioning_plans SET onboarding_status='verified' WHERE id=$1",[plans.learnerA]);
 return {checks,fixture:{ids,emails,password,programs,items,lesson,receipt,mapping,plans,origin}};
}
module.exports={verifyPortableLearning};
