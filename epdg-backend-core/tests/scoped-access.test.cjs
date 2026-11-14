'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {SCOPED_ROLE_CATALOG,permissionsForScopedRoles,requireScopedAccessEnabled,draftInput}=require('../dist/security/scopedAccessPolicy.js');
const {ScopedAccessService}=require('../dist/security/ScopedAccessService.js');
test('scoped access distinguishes all eleven roles without inheriting legacy grants',()=>{
 assert.equal(SCOPED_ROLE_CATALOG.length,11);assert.equal(new Set(SCOPED_ROLE_CATALOG.map(role=>role.code)).size,11);
 assert.deepEqual(permissionsForScopedRoles(['founder_admin','webdev_technical','admin']),[]);
 assert.ok(permissionsForScopedRoles(['founder_owner']).includes('admin.accounts.approve'));
 for(const role of SCOPED_ROLE_CATALOG.filter(role=>role.code!=='founder_owner'))assert.ok(!permissionsForScopedRoles([role.code]).includes('role.grant'));
 assert.ok(!permissionsForScopedRoles(['technical_maintainer']).includes('admin.accounts.read'));
 assert.ok(!permissionsForScopedRoles(['content_editor']).includes('resource.publish'));
});
test('scoped feature is disabled unless explicit and resource bodies cannot set authority',()=>{
 for(const env of [{},{EPDG_ACCOUNT_MANAGEMENT_ENABLED:'true'},{EPDG_ACCOUNT_MANAGEMENT_ENABLED:'0'}])assert.throws(()=>requireScopedAccessEnabled(env));
 assert.doesNotThrow(()=>requireScopedAccessEnabled({EPDG_ACCOUNT_MANAGEMENT_ENABLED:'1'}));
 for(const field of ['user_id','role','permissions','organization_id','founder_only','status'])assert.throws(()=>draftInput({body:'safe',revision:1,[field]:'forged'}));
 assert.throws(()=>draftInput({body:'x'.repeat(16385),revision:1}));assert.deepEqual(draftInput({body:'draft',revision:3}),{body:'draft',revision:3});
});
test('resource service uses bounded database filters and never caller identity selectors',async()=>{
 const previous=process.env.EPDG_ACCOUNT_MANAGEMENT_ENABLED;process.env.EPDG_ACCOUNT_MANAGEMENT_ENABLED='1';const calls=[];
 const client={query:async(sql,args)=>{calls.push([sql,args]);return{rows:[]};}};
 try{await new ScopedAccessService().listResources(client,42);assert.match(calls[0][0],/FROM portal_access.read_resources\(\$1\)/);assert.deepEqual(calls[0][1],[42]);await assert.rejects(()=>new ScopedAccessService().assertPermission(client,42,'role.grant','organization','1'),/outside your approved scope/);}finally{if(previous===undefined)delete process.env.EPDG_ACCOUNT_MANAGEMENT_ENABLED;else process.env.EPDG_ACCOUNT_MANAGEMENT_ENABLED=previous;}
});
test('portable access migration manifest is exact and has no destructive data or identity operation',()=>{
 const m=require('../src/security/access-schema-manifest.json'),sql=fs.readFileSync(path.join(__dirname,'../access-migrations',m.file),'utf8');
 assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),m.sha256);
 assert.doesNotMatch(sql,/\b(?:TRUNCATE|DELETE FROM|DROP TABLE|DROP SCHEMA)\b|INSERT INTO (?:core|epdg)\.users|GRANT.*TO PUBLIC/i);
 assert.match(sql,/NOT rolbypassrls/);assert.match(sql,/SECURITY DEFINER SET search_path=''/);assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_access FROM PUBLIC/);
});
