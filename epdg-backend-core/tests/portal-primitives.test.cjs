'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const {portalConfig}=require('../dist/security/config.js');
const {opaqueToken,hashToken,csrfToken,credentialVersion,constantEquals,validPassword,sessionCookie}=require('../dist/security/primitives.js');
const original={...process.env};
before(()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,runtimeEnv({instanceId:'00000000-0000-0000-0000-000000000000',appPassword:'unit-fixture',jwtSecret:'j'.repeat(48),certificateSecret:'c'.repeat(48),csrfSecret:'s'.repeat(48)}));});
after(()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,original);});
test('production sessions require explicit HTTPS origin, independent CSRF key, and host-only secure cookies',()=>{
  const c=portalConfig({NODE_ENV:'production',PORTAL_ORIGIN:'https://portal.example.invalid',SESSION_CSRF_SECRET:'unit-only-csrf-secret-of-at-least-32-characters'});
  assert.equal(c.cookieName,'__Host-epdg_session');assert.equal(c.cookie.secure,true);assert.equal(c.cookie.httpOnly,true);assert.equal(c.cookie.sameSite,'strict');assert.equal(c.cookie.path,'/');assert.equal(c.cookie.domain,undefined);
  for(const origin of ['http://portal.example.invalid','https://portal.example.invalid/path','https://name:password@portal.example.invalid'])assert.throws(()=>portalConfig({NODE_ENV:'production',PORTAL_ORIGIN:origin,SESSION_CSRF_SECRET:'x'.repeat(40)}));
  assert.throws(()=>portalConfig({NODE_ENV:'production',PORTAL_ORIGIN:'https://portal.example.invalid'}));
  assert.throws(()=>portalConfig({NODE_ENV:'production',PORTAL_ORIGIN:'https://portal.example.invalid',SESSION_CSRF_SECRET:'x'.repeat(40),SESSION_IDLE_SECONDS:'0'}));
  assert.throws(()=>portalConfig({NODE_ENV:'production',PORTAL_ORIGIN:'https://portal.example.invalid',SESSION_CSRF_SECRET:'x'.repeat(40),JWT_SECRET:'x'.repeat(40)}));
  assert.equal(portalConfig({NODE_ENV:'production',PORTAL_ORIGIN:'https://portal.example.invalid',SESSION_CSRF_SECRET:'x'.repeat(40),SESSION_IDLE_SECONDS:''}).idleSeconds,1800);
});
test('opaque session credentials and CSRF tokens are independent and credential versions rotate',()=>{
  const first=opaqueToken(),second=opaqueToken();assert.ok(first!==second);assert.ok(/^[A-Za-z0-9_-]{43}$/.test(first));assert.ok(/^[0-9a-f]{64}$/.test(hashToken(first)));
  assert.ok(csrfToken(first)!==first);assert.ok(csrfToken(first)!==csrfToken(second));assert.equal(constantEquals(csrfToken(first),csrfToken(second)),false);assert.equal(constantEquals(undefined,csrfToken(first)),false);
  assert.ok(credentialVersion('old-hash')!==credentialVersion('new-hash'));
});
test('ambiguous or bearer-supplied cookies never select an account',()=>{
  const raw=opaqueToken();const cookie=portalConfig().cookieName+'='+raw;
  assert.ok(sessionCookie({headers:{cookie}})===raw);
  for(const headers of [{cookie:cookie+'; '+cookie},{cookie,authorization:'Bearer any'},{cookie:portalConfig().cookieName+'=invalid'},{cookie:'other=value'},{cookie:'x'.repeat(5000)}])assert.equal(sessionCookie({headers}),null);
});
test('password changes respect bcrypt byte limits without truncating Unicode',()=>{
  assert.equal(validPassword('x'.repeat(11)),false);assert.equal(validPassword('x'.repeat(12)),true);assert.equal(validPassword('x'.repeat(72)),true);assert.equal(validPassword('x'.repeat(73)),false);assert.equal(validPassword('界'.repeat(25)),false);
});
test('HTTP entrypoint cannot mount the legacy bearer or feature routers',()=>{
  const source=readFileSync(join(__dirname,'../src/app.ts'),'utf8');assert.match(source,/createPortalRouter/);
  assert.doesNotMatch(source,/authRoutes|adminRoutes|internRoutes|mentorRoutes|userRoutes|uploadRoutes|verifyRoutes|swaggerSpec/);
});
test('security migration is additive, pinned, and inaccessible to application startup',()=>{
  const crypto=require('node:crypto');const manifest=require('../src/security/schema-manifest.json');const sql=readFileSync(join(__dirname,'../security-migrations',manifest.file),'utf8');
  assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),manifest.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(manifest.file,sql);
  for(const file of ['../src/index.ts','../src/security/PortalService.ts','../src/app.ts'])assert.doesNotMatch(readFileSync(join(__dirname,file),'utf8'),/readFileSync|security-migrations|CREATE TABLE|ALTER TABLE/);
  assert.match(sql,/active boolean NOT NULL DEFAULT false/);assert.doesNotMatch(sql,/INSERT INTO core\.users|GRANT.*TO (anon|authenticated|PUBLIC)/i);
});
