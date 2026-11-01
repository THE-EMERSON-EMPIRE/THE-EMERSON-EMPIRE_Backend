'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const C=require('./common.cjs');
const {fs,path,crypto,config,client,preflight,mailHeaders}=C;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const origin='http://127.0.0.1:58080';
async function verify(){
  const c=config();await preflight(c);const checks=[];let current='startup';
  const check=async(name,work)=>{current=name;await work();checks.push(name);console.log('PASS '+name);};
  const api=async(route,{method='GET',body,session,headers={},cookie}={})=>{
    const unsafe=!['GET','HEAD','OPTIONS'].includes(method);
    const h={...(unsafe?{Origin:origin,'X-EPDG-Request':'portal','Content-Type':'application/json'}:{}),
      ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(cookie?{Cookie:cookie}:{}),...headers};
    for(const key of Object.keys(h))if(h[key]===null)delete h[key];
    const r=await fetch('http://127.0.0.1:58000'+route,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    return {status:r.status,json:await r.json(),headers:r.headers};
  };
  const login=async(email,password=c.fixturePassword)=>{
    const r=await api('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(r.status,200,'Synthetic login');
    const setCookie=r.headers.get('set-cookie');assert.ok(setCookie,'Session cookie issued');
    return {cookie:setCookie.split(';')[0],raw:setCookie.split(';')[0].split('=')[1],csrf:r.json.csrf_token,user:r.json.user,headers:r.headers,json:r.json};
  };
  const db=await client(c,true);
  const ids=Object.fromEntries((await db.query('SELECT email,id FROM core.users')).rows.map(u=>[u.email,u.id]));
  const aId=ids['learner-a@epdg.invalid'],bId=ids['learner-b@epdg.invalid'];
  let a,b,schoolA,schoolB,recoveryToken;
  try{
    await check('health and private responses prohibit caching',async()=>{
      const r=await api('/health');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
      assert.equal((await api('/api/auth/session')).status,401);
    });
    await check('JWT bearer and legacy registration/refresh/privileged routes stay closed',async()=>{
      const jwt=require('jsonwebtoken').sign({id:aId,purpose:'access',role:'admin'},c.jwtSecret,{algorithm:'HS256',expiresIn:'1h'});
      for(const route of ['/api/auth/session','/api/admin/stats'])assert.equal((await api(route,{headers:{Authorization:'Bearer '+jwt}})).status,401);
      for(const route of ['/api/auth/register','/api/auth/refresh','/api/invitations','/api/owner/bootstrap','/api/memberships']){
        const r=await api(route,{method:'POST',body:{role:'admin',user_id:aId}});assert.equal(r.status,503);assert.ok(!Object.hasOwn(r.json,'token'));
      }
    });
    await check('login requires exact origin, custom header, JSON, and strict fields',async()=>{
      for(const value of [null,'null','https://untrusted.invalid'])assert.equal((await api('/api/auth/login',{method:'POST',body:{email:'learner-a@epdg.invalid',password:c.fixturePassword},headers:{Origin:value}})).status,403);
      assert.equal((await api('/api/auth/login',{method:'POST',body:{},headers:{'X-EPDG-Request':null}})).status,403);
      assert.equal((await api('/api/auth/login',{method:'POST',body:{},headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
      assert.equal((await api('/api/auth/login',{method:'POST',body:{},headers:{'Content-Type':'text/plain'}})).status,415);
      const forged=await api('/api/auth/login',{method:'POST',body:{email:'learner-a@epdg.invalid',password:c.fixturePassword,role:'admin'}});assert.equal(forged.status,400);assert.ok(!JSON.stringify(forged.json).includes(c.fixturePassword));
      assert.equal((await api('/api/auth/login',{method:'POST',body:{email:'learner-a@epdg.invalid',password:'x'.repeat(17000)}})).status,413);
      const malformed=await fetch('http://127.0.0.1:58000/api/auth/login',{method:'POST',headers:{Origin:origin,'X-EPDG-Request':'portal','Content-Type':'application/json'},body:'{"password":"'+c.fixturePassword+'",'});
      assert.equal(malformed.status,400);const safe=await malformed.text();assert.ok(!safe.includes(c.fixturePassword));assert.ok(safe.includes('Invalid JSON body'));
    });
    await check('four real logins issue HttpOnly Strict cookies without JSON bearer credentials',async()=>{
      a=await login('learner-a@epdg.invalid');b=await login('learner-b@epdg.invalid');schoolA=await login('school-a@epdg.invalid');schoolB=await login('school-b@epdg.invalid');
      for(const s of [a,b,schoolA,schoolB]){const cookie=s.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict')&&cookie.includes('Path=/'));assert.ok(!cookie.includes('Domain='));assert.ok(!Object.hasOwn(s.json,'token'));assert.ok(/^[A-Za-z0-9_-]{43}$/.test(s.raw));assert.ok(s.csrf!==s.raw);assert.deepEqual(s.user.permissions,[]);assert.equal(s.user.privileged_controls_available,false);}
      assert.equal(a.user.legacy_role,'intern');assert.equal(schoolA.user.legacy_role,'school');
    });
    await check('self access preserves institution A/B separation and rejects forged scope selection',async()=>{
      assert.equal(a.user.memberships.length,1);assert.equal(b.user.memberships.length,1);assert.notEqual(a.user.memberships[0].school_id,b.user.memberships[0].school_id);
      assert.equal(a.user.memberships[0].school_id,schoolA.user.memberships[0].school_id);assert.equal(b.user.memberships[0].school_id,schoolB.user.memberships[0].school_id);
      const r=await api('/api/auth/me',{session:a,headers:{'X-Role':'admin'}});assert.equal(r.status,200);assert.equal(r.json.user.id,aId);assert.equal(r.json.user.legacy_role,'intern');
      assert.equal((await api('/api/auth/session?user_id='+bId,{session:a})).status,400);
      assert.equal((await api('/api/access?school_id='+b.user.memberships[0].school_id,{session:a})).status,400);
      assert.equal((await api('/api/access/owner.manage',{session:a})).status,403);
      assert.equal((await api('/api/admin/stats',{session:a})).status,503);
      assert.equal((await api('/api/profile',{method:'PATCH',session:a,body:{role:'admin',school_id:b.user.memberships[0].school_id}})).status,403);
    });
    await check('malformed, duplicate, unknown, and bearer-plus-cookie credentials are rejected',async()=>{
      assert.equal((await api('/api/auth/session',{cookie:'epdg_synthetic_session=invalid'})).status,401);
      assert.equal((await api('/api/auth/session',{cookie:a.cookie+'; '+a.cookie})).status,401);
      assert.equal((await api('/api/auth/session',{cookie:'epdg_synthetic_session='+crypto.randomBytes(32).toString('base64url')})).status,401);
      assert.equal((await api('/api/auth/session',{session:a,headers:{Authorization:'Bearer forged'}})).status,401);
    });
    await check('session survives controlled backend and database restart',async()=>{
      await db.end();
      for(const command of ['stop','start']){const r=spawnSync(process.execPath,[path.join(__dirname,'manage.cjs'),command],{env:C.cleanEnv(),cwd:C.core,windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.status,0,'Controlled restart');}
      const r=await api('/api/auth/session',{session:a});assert.equal(r.status,200);assert.equal(r.json.user.id,aId);
    });
  }catch(error){fs.writeFileSync(path.join(C.state,'security-verify.failure.json'),JSON.stringify({check:current,errorType:error.name,message:error.message},null,2));throw error;}
  finally{if(!db._ending)await db.end();}

  const operator=await client(c,true);
  try{
    await check('logout requires session-bound CSRF and cannot be forged from another session',async()=>{
      for(const csrf of [null,'forged',b.csrf])assert.equal((await api('/api/auth/logout',{method:'POST',session:a,body:{},headers:{'X-CSRF-Token':csrf}})).status,403);
      assert.equal((await api('/api/auth/session',{session:a})).status,200);
      const logout=await api('/api/auth/logout',{method:'POST',session:a,body:{}});assert.equal(logout.status,200);assert.ok(logout.headers.get('set-cookie').includes('Expires=Thu, 01 Jan 1970'));
      assert.equal((await api('/api/auth/session',{session:a})).status,401);
      const {rows:[r]}=await operator.query('SELECT revoked_reason FROM portal_security.sessions WHERE token_hash=$1',[hash(a.raw)]);assert.equal(r.revoked_reason,'logout');
    });
    await check('password change revokes all sessions and requires reauthentication',async()=>{
      const one=await login('learner-a@epdg.invalid'),two=await login('learner-a@epdg.invalid');
      const temporary=crypto.randomBytes(32).toString('base64url');
      assert.equal((await api('/api/auth/change-password',{method:'POST',session:one,body:{current_password:c.fixturePassword,new_password:temporary}})).status,200);
      for(const s of [one,two])assert.equal((await api('/api/auth/session',{session:s})).status,401);
      assert.equal((await api('/api/auth/login',{method:'POST',body:{email:'learner-a@epdg.invalid',password:c.fixturePassword}})).status,401);
      const changed=await login('learner-a@epdg.invalid',temporary);
      assert.equal((await api('/api/auth/change-password',{method:'POST',session:changed,body:{current_password:temporary,new_password:c.fixturePassword}})).status,200);
      a=await login('learner-a@epdg.invalid');
    });
    await check('membership deactivation and reactivation cannot resurrect an old session',async()=>{
      await operator.query('UPDATE portal_security.memberships SET active=false WHERE user_id=$1',[bId]);
      assert.equal((await api('/api/auth/session',{session:b})).status,401);
      await operator.query('UPDATE portal_security.memberships SET active=true WHERE user_id=$1',[bId]);
      assert.equal((await api('/api/auth/session',{session:b})).status,401);
      b=await login('learner-b@epdg.invalid');
      await operator.query('UPDATE portal_security.memberships SET active=false WHERE user_id=$1',[bId]);
      await operator.query('UPDATE portal_security.memberships SET active=true WHERE user_id=$1',[bId]);
      assert.equal((await api('/api/auth/session',{session:b})).status,401);
    });
    await check('account disable/re-enable invalidates existing sessions without an intervening request',async()=>{
      await operator.query('UPDATE portal_security.account_states SET active=false WHERE user_id=$1',[aId]);
      await operator.query('UPDATE portal_security.account_states SET active=true WHERE user_id=$1',[aId]);
      assert.equal((await api('/api/auth/session',{session:a})).status,401);
      a=await login('learner-a@epdg.invalid');
    });
    await check('absolute and idle expiry are enforced and persisted as revocation',async()=>{
      for(const idle of [false,true]){
        const s=await login('learner-b@epdg.invalid');
        if(idle)await operator.query("UPDATE portal_security.sessions SET last_seen_at=clock_timestamp()-interval '1 hour' WHERE token_hash=$1",[hash(s.raw)]);
        else await operator.query("UPDATE portal_security.sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[hash(s.raw)]);
        assert.equal((await api('/api/auth/session',{session:s})).status,401);
        const {rows:[r]}=await operator.query('SELECT revoked_reason FROM portal_security.sessions WHERE token_hash=$1',[hash(s.raw)]);assert.equal(r.revoked_reason,'expired');
      }
    });
    const capturedRecovery=async(email)=>{
      const before=await (await fetch('http://127.0.0.1:58025/api/v1/messages',{headers:mailHeaders(c)})).json();
      const r=await api('/api/auth/forgot-password',{method:'POST',body:{email}});assert.equal(r.status,200);
      let message;
      for(let i=0;i<50;i++){const list=await (await fetch('http://127.0.0.1:58025/api/v1/messages',{headers:mailHeaders(c)})).json();message=list.messages.find(m=>!before.messages.some(old=>old.ID===m.ID)&&m.To[0].Address===email);if(message)break;await new Promise(resolve=>setTimeout(resolve,100));}
      assert.ok(message,'Recovery must be captured in Mailpit');
      const detail=await (await fetch('http://127.0.0.1:58025/api/v1/message/'+message.ID,{headers:mailHeaders(c)})).json();
      const match=detail.HTML.match(/http:\/\/127\.0\.0\.1:58080\/reset-password#token=([A-Za-z0-9_-]{43})/);assert.ok(match,'Recovery token stays in a fragment');
      return {token:match[1],response:r.json};
    };
    await check('recovery uses generic responses, hashed opaque tokens, and the mail sink',async()=>{
      const unknown=await api('/api/auth/forgot-password',{method:'POST',body:{email:'unknown@epdg.invalid'}});
      const known=await capturedRecovery('learner-b@epdg.invalid');recoveryToken=known.token;assert.deepEqual(known.response,unknown.json);
      const {rows:[r]}=await operator.query('SELECT token_hash FROM portal_security.recovery_tokens WHERE token_hash=$1',[hash(recoveryToken)]);assert.ok(r&&r.token_hash!==recoveryToken);
    });
    await check('concurrent reset consumes the recovery token exactly once and revokes every old session',async()=>{
      const one=await login('learner-b@epdg.invalid'),two=await login('learner-b@epdg.invalid');
      const responses=await Promise.all([1,2].map(()=>api('/api/auth/reset-password',{method:'POST',body:{token:recoveryToken,password:c.fixturePassword}})));
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
      for(const s of [one,two])assert.equal((await api('/api/auth/session',{session:s})).status,401);
      assert.equal((await api('/api/auth/reset-password',{method:'POST',body:{token:recoveryToken,password:c.fixturePassword}})).status,400);
      const {rows:[mirror]}=await operator.query('SELECT c.password=e.password AS same FROM core.users c JOIN epdg.users e ON e.id=c.id WHERE c.id=$1',[bId]);assert.equal(mirror.same,true);
    });
    await check('a replacement recovery request revokes prior links and expiry is enforced',async()=>{
      const first=await capturedRecovery('learner-a@epdg.invalid');const second=await capturedRecovery('learner-a@epdg.invalid');
      assert.equal((await api('/api/auth/reset-password',{method:'POST',body:{token:first.token,password:c.fixturePassword}})).status,400);
      await operator.query("UPDATE portal_security.recovery_tokens SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[hash(second.token)]);
      assert.equal((await api('/api/auth/reset-password',{method:'POST',body:{token:second.token,password:c.fixturePassword}})).status,400);
      assert.equal((await api('/api/auth/reset-password',{method:'POST',body:{token:crypto.randomBytes(32).toString('base64url'),password:c.fixturePassword}})).status,400);
    });
    await check('SQL grants prevent runtime membership, activation, ledger, audit, or schema administration',async()=>{
      const app=await client(c);try{
        for(const sql of ["UPDATE portal_security.memberships SET active=false",'UPDATE portal_security.account_states SET active=false',"UPDATE portal_security.schema_migrations SET sha256=repeat('0',64)",'UPDATE portal_security.audit_events SET event=event','DELETE FROM portal_security.audit_events','CREATE TABLE portal_security.invalid_probe(id int)','SELECT * FROM public.leads'])await assert.rejects(app.query(sql),e=>e.code==='42501');
      }finally{await app.end();}
      const {rows:[rls]}=await operator.query("SELECT count(*)::int AS tables,count(*) FILTER(WHERE c.relrowsecurity)::int AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal_security' AND c.relkind='r'");assert.deepEqual(rls,{tables:6,rls:6});
      const {rows:[grants]}=await operator.query("SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE table_schema='portal_security' AND grantee='PUBLIC'");assert.equal(grants.count,0);
    });
    await check('private logs and audit fields do not contain credentials or raw recovery/session tokens',async()=>{
      const log=fs.readFileSync(path.join(C.state,'backend.log'),'utf8');
      for(const secret of [a.raw,b.raw,recoveryToken,c.fixturePassword,c.csrfSecret])assert.ok(!log.includes(secret),'Credential-free log');
      const {rows:[r]}=await operator.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='portal_security' AND table_name='audit_events' AND column_name NOT IN ('id','user_id','session_id','event','created_at')");assert.equal(r.count,0);
      const {rows:[bad]}=await operator.query("SELECT count(*)::int AS count FROM core.users WHERE email NOT LIKE '%@epdg.invalid' OR name NOT LIKE 'SYNTHETIC %'");assert.equal(bad.count,0);
    });
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,checksPassed:checks.length,checks,
      productionTouched:false,privilegedControlsEnabled:false,permissionGrantsCreated:0,
      schemaManifest:require('../../src/security/schema-manifest.json'),
      limitations:['Synthetic loopback environment only; no hosted cookie/proxy or browser acceptance','Role/permission matrix and owner proof remain closed','Invitations and profile writes intentionally unavailable','In-memory IP throttles and best-effort mail delivery require hosted review before production']};
    fs.writeFileSync(path.join(C.state,'security-verification.receipt.json'),JSON.stringify(receipt,null,2));
    console.log(JSON.stringify({checksPassed:checks.length,productionTouched:false,privilegedControlsEnabled:false}));
  }catch(error){fs.writeFileSync(path.join(C.state,'security-verify.failure.json'),JSON.stringify({check:current,errorType:error.name,message:error.message},null,2));throw error;}
  finally{
    // Return fixture activity to its reviewed state; never change identities, role grants, or institutions.
    await operator.query('UPDATE portal_security.account_states SET active=true WHERE active=false');
    await operator.query('UPDATE portal_security.memberships SET active=true WHERE active=false');
    await operator.end();
  }
}
module.exports={verify};
