'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');

const api='http://127.0.0.1:58000/api';
const origin='http://127.0.0.1:58080';
async function request(path,{method='GET',body,session,csrf}={}){
  const headers={Origin:origin,'X-EPDG-Request':'portal'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(session?.cookie)headers.Cookie=session.cookie;
  if(csrf)headers['X-CSRF-Token']=csrf;
  const response=await fetch(api+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  let payload={};try{payload=await response.json();}catch{}
  return {status:response.status,headers:response.headers,payload};
}
function expectStatus(result,status){assert.equal(result.status,status,'Unexpected local administrator API status');}
async function login(email,password){
  const result=await request('/auth/login',{method:'POST',body:{email,password}});
  expectStatus(result,200);
  const cookieHeader=result.headers.get('set-cookie');assert.ok(cookieHeader,'Login must set an HttpOnly session cookie');
  assert.match(cookieHeader,/httponly/i);assert.match(cookieHeader,/path=\//i);assert.doesNotMatch(cookieHeader,/domain=/i);
  const cookie=cookieHeader.split(';',1)[0];
  assert.ok(result.payload.csrf_token&&result.payload.user,'Login must return an in-memory CSRF token and server-verified user');
  return {cookie,csrf:result.payload.csrf_token,user:result.payload.user};
}
async function verify(){
  const c=C.config();
  expectStatus(await request('/admin/overview'),401);
  expectStatus(await request('/auth/session'),401);
  const founder=await login('founder-admin@epdg.invalid',c.fixturePassword);
  assert.equal(founder.user.email,'founder-admin@epdg.invalid');
  assert.ok(founder.user.permissions.includes('admin.overview.read'));
  assert.ok(founder.user.portal_roles.includes('founder_admin'));
  const restored=await request('/auth/session',{session:founder});
  expectStatus(restored,200);assert.deepEqual(restored.payload.user.permissions,founder.user.permissions);
  const overview=await request('/admin/overview',{session:founder});expectStatus(overview,200);
  assert.equal(overview.payload.data.environment,'isolated-synthetic');
  assert.equal(overview.payload.data.accounts.total,5);
  assert.equal(overview.payload.data.accounts.active,5);
  const users=await request('/admin/users',{session:founder});expectStatus(users,200);
  const items=users.payload.data.items;assert.equal(items.length,5);
  assert.ok(items.every(user=>user.email.endsWith('@epdg.invalid')&&user.name.startsWith('SYNTHETIC ')));
  assert.ok(!JSON.stringify(users.payload).includes('theemersonempire.info'));
  const roles=await request('/admin/roles',{session:founder});expectStatus(roles,200);
  const founderRole=roles.payload.data.catalog.find(role=>role.code==='founder_admin');
  const webdevRole=roles.payload.data.catalog.find(role=>role.code==='webdev_technical');
  assert.equal(founderRole.requestable,false);assert.deepEqual(webdevRole.permissions,[]);
  assert.ok(roles.payload.data.hr_boundary.includes('Emerson CRM'));
  const readiness=await request('/admin/education-readiness',{session:founder});expectStatus(readiness,200);
  assert.equal(readiness.payload.data.programs.writable,false);
  assert.equal(readiness.payload.data.crm.learner_activation,false);
  const learner=items.find(user=>user.email==='learner-a@epdg.invalid');assert.ok(learner);
  const noCsrf=await request('/admin/role-requests',{method:'POST',body:{target_user_id:learner.id,role_code:'webdev_technical'},session:founder});
  expectStatus(noCsrf,403);
  const requestRole=await request('/admin/role-requests',{method:'POST',body:{target_user_id:learner.id,role_code:'webdev_technical'},session:founder,csrf:founder.csrf});
  expectStatus(requestRole,200);assert.equal(requestRole.payload.data.assignment.status,'pending');
  assert.equal(requestRole.payload.data.permissions_granted,false);
  const selfEscalation=await request('/admin/role-requests',{method:'POST',body:{target_user_id:founder.user.id,role_code:'webdev_technical'},session:founder,csrf:founder.csrf});
  expectStatus(selfEscalation,403);
  const founderGrant=await request('/admin/role-requests',{method:'POST',body:{target_user_id:learner.id,role_code:'founder_admin'},session:founder,csrf:founder.csrf});
  expectStatus(founderGrant,403);
  const learnerSession=await login('learner-a@epdg.invalid',c.fixturePassword);
  assert.deepEqual(learnerSession.user.permissions,[]);
  expectStatus(await request('/admin/overview',{session:learnerSession}),403);
  expectStatus(await request('/admin/users',{session:learnerSession}),403);
  const logout=await request('/auth/logout',{method:'POST',body:{},session:founder,csrf:founder.csrf});
  expectStatus(logout,200);
  expectStatus(await request('/auth/session',{session:founder}),401);
  expectStatus(await request('/admin/overview',{session:founder}),401);
  console.log(JSON.stringify({api:'passed',founderSession:'server-verified',csrf:'enforced',nonAdmin:'denied',syntheticUserIsolation:'passed',webdevRequest:'pending-only',education:'read-only',logout:'revoked'}));
}
verify().catch(error=>{console.error('Local administrator API verification failed:',error.message);process.exit(1);});
