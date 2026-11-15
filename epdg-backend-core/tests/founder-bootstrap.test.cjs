'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {canonical,digest,target,validateApproval,applyPlan,sendInvitation}=require('../scripts/account-release/founder-bootstrap.cjs');
const now=new Date('2026-01-01T12:00:00Z');
const config=()=>({target_id:'SYNTHETIC-target',approval_reference:'SYNTHETIC-release',host:'127.0.0.1',port:55432,database:'epdg_synthetic',migrator_role:'fixture_operator',runtime_role:'fixture_runtime',synthetic_only:true,ssl:false,backend_commit:'a'.repeat(40)});
function fixture(){
 const plan={target:target(config()),expires_at:'2026-01-02T12:00:00Z',identity:{action:'create_missing'},organization:{action:'create_missing',evidence_reference:'SYNTHETIC-establishment'}};
 const envelope={plan,sha256:digest(plan)};
 const approval={plan_sha256:envelope.sha256,approval_reference:'SYNTHETIC-founder-approval',operator_reference:'SYNTHETIC-operator',authorize_founder_bootstrap:true,authorize_identity_creation:true,authorize_organization_creation:true,organization_evidence_reference:plan.organization.evidence_reference,expires_at:'2026-01-02T11:00:00Z'};
 return {envelope,approval};
}
test('canonical plan digest is stable across key order and sensitive to array order',()=>{
 assert.equal(canonical({z:{b:2,a:1},a:[{d:4,c:3},null]}),canonical({a:[{c:3,d:4},null],z:{a:1,b:2}}));
 assert.notEqual(digest({a:[1,2]}),digest({a:[2,1]}));
});
test('approval binds the complete reviewed plan including source and target',()=>{
 const {envelope,approval}=fixture();validateApproval(envelope,approval,envelope.sha256,now);
 for(const change of [p=>p.target.backend_commit='b'.repeat(40),p=>p.target.database='wrong_database',p=>p.identity.user_id=123]){
  const altered=structuredClone(envelope);change(altered.plan);
  assert.throws(()=>validateApproval(altered,approval,envelope.sha256,now),/exact plan digest/);
 }
 assert.throws(()=>validateApproval(envelope,approval,'f'.repeat(64),now),/exact plan digest/);
 const altered=structuredClone(envelope);altered.plan.target.database='wrong_database';altered.sha256=digest(altered.plan);
 assert.throws(()=>validateApproval(altered,approval,altered.sha256,now),/explicit operator approval/);
});
test('founder, identity and organization establishment approvals remain separate',()=>{
 for(const field of ['authorize_founder_bootstrap','authorize_identity_creation','authorize_organization_creation']){
  const {envelope,approval}=fixture();delete approval[field];assert.throws(()=>validateApproval(envelope,approval,envelope.sha256,now));
 }
 for(const change of [{operator_reference:''},{organization_evidence_reference:'SYNTHETIC-wrong'},{authorize_founder_bootstrap:'true'}]){
  const {envelope,approval}=fixture();Object.assign(approval,change);assert.throws(()=>validateApproval(envelope,approval,envelope.sha256,now));
 }
 const {envelope,approval}=fixture();envelope.plan.identity.action='reuse_existing';envelope.plan.organization.action='reuse_existing';envelope.sha256=digest(envelope.plan);approval.plan_sha256=envelope.sha256;delete approval.authorize_identity_creation;delete approval.authorize_organization_creation;validateApproval(envelope,approval,envelope.sha256,now);
});
test('expired, malformed and overlong approval lifetimes are rejected',()=>{
 for(const expires_at of ['2026-01-01T11:59:59Z','2026-01-01T12:00:00Z','2026-01-02T12:00:01Z','invalid']){
  const {envelope,approval}=fixture();approval.expires_at=expires_at;assert.throws(()=>validateApproval(envelope,approval,envelope.sha256,now),/expired/);
 }
});
test('operator target rejects shared roles and synthetic boundary or TLS drift',()=>{
 for(const change of [{runtime_role:'fixture_operator'},{host:'remote.invalid'},{database:'production'},{port:5432},{backend_commit:'main'},{migrator_role:'bad;role'},{synthetic_only:false,ssl:false}])assert.throws(()=>target({...config(),...change}));
 assert.equal(target({...config(),synthetic_only:false,ssl:true,host:'db.example.invalid',port:5432,database:'postgres'}).ssl,true);
});
test('apply rejects changed approved target before any database command',async()=>{
 const {envelope,approval}=fixture();envelope.plan.expires_at=new Date(Date.now()+3600000).toISOString();envelope.sha256=digest(envelope.plan);approval.plan_sha256=envelope.sha256;approval.expires_at=envelope.plan.expires_at;
 let commands=0;await assert.rejects(()=>applyPlan({query:async()=>{commands++;throw new Error('unexpected database access');}},{...config(),approval_reference:'SYNTHETIC-other-release'},envelope,approval,envelope.sha256),/Target differs/);assert.equal(commands,0);
});
test('missing mail release approval prevents send before database access',async()=>{
 const {envelope,approval}=fixture();envelope.plan.expires_at=new Date(Date.now()+3600000).toISOString();envelope.sha256=digest(envelope.plan);approval.plan_sha256=envelope.sha256;approval.expires_at=envelope.plan.expires_at;
 const previous={...process.env};for(const key of Object.keys(process.env))delete process.env[key];
 let commands=0;try{await assert.rejects(()=>sendInvitation({query:async()=>{commands++;throw new Error('unexpected database access');}},config(),envelope,approval,envelope.sha256));assert.equal(commands,0);}finally{Object.assign(process.env,previous);}
});
test('CLI failures omit private input values and stack traces',()=>{
 const marker='SYNTHETIC-private-identity@epdg.invalid';
 const result=spawnSync(process.execPath,[require.resolve('../scripts/account-release/founder-bootstrap.cjs'),'--invalid',marker],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.includes(marker),false);assert.equal(result.stderr.includes(' at '),false);assert.match(result.stderr,/No private values are logged/);
});
