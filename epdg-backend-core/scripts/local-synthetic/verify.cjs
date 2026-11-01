'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const C=require('./common.cjs');
const {fs,path,state,core,config,client,preflight,mailHeaders,runtimeEnv,checksum,isolationChecksum}=C;
async function request(route,body,token){
  const response=await fetch('http://127.0.0.1:58000'+route,{method:body?'POST':'GET',
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});
  return {status:response.status,body:await response.json()};
}
async function seed(c){
  const db=await client(c);
  try {
    const {rows:[{count}]}=await db.query('SELECT count(*)::int AS count FROM core.users');
    if(count===4)return;
    assert.equal(count,0,'Seed only an empty account store; never overwrite users');
    const bcrypt=require('bcrypt');
    const {createDualWriteUser}=require('../../dist/utils/coreIdentity.js');
    const hash=await bcrypt.hash(c.fixturePassword,12);
    await db.query('BEGIN');
    await db.query("INSERT INTO core.branches(code,name) VALUES('epdg','EPDG Synthetic Test')");
    for(const institution of ['a','b']){
      const school=await createDualWriteUser(db,{email:`school-${institution}@epdg.invalid`,name:`SYNTHETIC Institution ${institution.toUpperCase()}`,hashedPassword:hash,role:'school',isVerified:true});
      const {rows:[row]}=await db.query('INSERT INTO epdg.schools(user_id,school_name,email,is_approved,is_verified) VALUES($1,$2,$3,true,true) RETURNING id',[school.id,`SYNTHETIC Institution ${institution.toUpperCase()}`,`school-${institution}@epdg.invalid`]);
      const learner=await createDualWriteUser(db,{email:`learner-${institution}@epdg.invalid`,name:`SYNTHETIC Learner ${institution.toUpperCase()}`,hashedPassword:hash,role:'intern',isVerified:true});
      await db.query('INSERT INTO epdg.intern_profiles(user_id,school_id,is_approved) VALUES($1,$2,true)',[learner.id,row.id]);
    }
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
async function verify(){
  const c=config();await preflight(c);
  const empty=JSON.parse(fs.readFileSync(path.join(state,'empty-baseline.receipt.json')));
  assert.equal(empty.applicationRowsBeforeSeed,0);assert.equal(empty.applicationTables,50);
  await seed(c);
  const db=await client(c);const admin=await client(c,true);
  let schema;const tableRows={};
  try{
    const {rows:[counts]}=await admin.query(`SELECT count(*)::int AS tables,
      count(*) FILTER(WHERE c.relrowsecurity)::int AS rls_tables
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('core','epdg','public','private') AND c.relkind='r'`);
    assert.deepEqual(counts,{tables:50,rls_tables:47}); schema=counts;
    const {rows:tables}=await admin.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('core','epdg','public','private') ORDER BY 1,2");
    const expected={'core.branches':1,'core.user_branch_roles':4,'core.users':4,'epdg.users':4,'epdg.schools':2,'epdg.intern_profiles':2};
    for(const t of tables){const key=t.schemaname+'.'+t.tablename;const {rows:[r]}=await admin.query(`SELECT count(*)::int AS count FROM "${t.schemaname}"."${t.tablename}"`);assert.equal(r.count,expected[key]||0,key+' synthetic row count');tableRows[key]=r.count;}
    const {rows:users}=await db.query('SELECT id,email,name FROM core.users ORDER BY id');
    assert.equal(users.length,4);assert.ok(users.every(u=>u.email.endsWith('@epdg.invalid')&&u.name.startsWith('SYNTHETIC ')));
    const {rows:[mirror]}=await db.query('SELECT count(*)::int AS count FROM core.users c JOIN epdg.users e ON e.id=c.id AND e.email=c.email');
    assert.equal(mirror.count,4);
    const {rows:institutions}=await db.query('SELECT ip.user_id,ip.school_id FROM epdg.intern_profiles ip ORDER BY ip.user_id');
    assert.equal(institutions.length,2);assert.notEqual(institutions[0].school_id,institutions[1].school_id);
    const {rows:triggers}=await admin.query("SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('core','epdg','public','private') AND NOT t.tgisinternal");
    assert.equal(triggers.length,0);
    const {rows:[ledger]}=await admin.query('SELECT count(*)::int AS count FROM public.migrations');assert.equal(ledger.count,0);
    await db.query('BEGIN');
    await assert.rejects(db.query("INSERT INTO core.users(email,name,password) VALUES('blocked@example.com','SYNTHETIC rejected','unused')"),e=>e.code==='23514');
    await db.query('ROLLBACK');
    await assert.rejects(db.query('CREATE TABLE core.synthetic_ddl_probe(id int)'),e=>e.code==='42501');
    await assert.rejects(db.query('SELECT * FROM public.leads'),e=>e.code==='42501');
  }finally{await db.end();await admin.end();}
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/api/auth/me')).status,401);
  assert.equal((await request('/api/admin/stats')).status,401);
  assert.equal((await fetch('http://127.0.0.1:58025/api/v1/messages')).status,401);
  let learnerToken;
  for(const institution of ['a','b'])for(const [kind,role] of [['school','school'],['learner','intern']]){
    const login=await request('/api/auth/login',{email:`${kind}-${institution}@epdg.invalid`,password:c.fixturePassword,role});
    assert.equal(login.status,200,`${kind}-${institution} login`);
    const me=await request('/api/auth/me',undefined,login.body.token);
    assert.equal(me.status,200);assert.equal(me.body.user.email,`${kind}-${institution}@epdg.invalid`);assert.equal(me.body.user.role,role);
    if(kind==='learner'&&institution==='a')learnerToken=login.body.token;
  }
  assert.equal((await request('/api/admin/stats',undefined,learnerToken)).status,403);
  assert.equal((await request('/api/auth/refresh',{token:learnerToken})).status,503);
  assert.equal((await request('/api/auth/me',undefined,'invalid-test-token')).status,401);
  const sink=async()=>{const r=await fetch('http://127.0.0.1:58025/api/v1/messages',{headers:mailHeaders(c)});assert.equal(r.status,200);return r.json();};
  const before=await sink();
  assert.equal((await request('/api/auth/forgot-password',{email:'learner-a@epdg.invalid'})).status,200);
  let captured;
  for(let i=0;i<20;i++){const messages=await sink();captured=messages.messages?.find(m=>!before.messages?.some(old=>old.ID===m.ID));if(captured)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(captured,'Password recovery must reach Mailpit through the application transport');
  assert.equal(captured.To[0].Address,'learner-a@epdg.invalid');
  const transport=require('nodemailer').createTransport({host:'127.0.0.1',port:51025,secure:false,ignoreTLS:true,connectionTimeout:3000});
  await assert.rejects(transport.sendMail({from:'no-reply@epdg.invalid',to:'blocked@example.com',subject:'SYNTHETIC rejection probe',text:'Synthetic sink must reject this reserved example domain'}),e=>e.code==='EENVELOPE');
  const detail=await (await fetch('http://127.0.0.1:58025/api/v1/message/'+captured.ID,{headers:mailHeaders(c)})).json();
  const link=(detail.HTML||detail.Text).match(/http:\/\/127\.0\.0\.1:58080\/reset-password\?token=([^"\s<]+)/);
  assert.ok(link,'Recovery link must use the explicit local frontend origin');
  const token=decodeURIComponent(link[1]);
  assert.equal((await request('/api/auth/reset-password',{token,password:c.fixturePassword})).status,200);
  assert.equal((await request('/api/auth/reset-password',{token,password:c.fixturePassword})).status,400);
  const probe=`const assert=require('node:assert/strict');const net=require('node:net');require(${JSON.stringify(path.join(__dirname,'network-guard.cjs'))}).install();assert.throws(()=>net.connect(443,'api.resend.com'),/blocked/);assert.throws(()=>net.connect(465,'127.0.0.1'),/blocked/);fetch('https://api.resend.com').then(()=>process.exit(2),e=>{assert.match(e.message,/blocked/);console.log('egress blocked')});`;
  const result=spawnSync(process.execPath,['-e',probe],{env:runtimeEnv(c),cwd:core,windowsHide:true,encoding:'utf8',timeout:5000});assert.equal(result.status,0);
  await assert.rejects(preflight({...c,instanceId:'00000000-0000-0000-0000-000000000000'}),/gate failed/);
  const infoResponse=await fetch('http://127.0.0.1:58025/api/v1/info',{headers:mailHeaders(c)});
  const info=await infoResponse.json();
  fs.writeFileSync(path.join(state,'mailpit-info.receipt.json'),JSON.stringify(info,null,2));
  const receipt={verifiedAt:new Date().toISOString(),backendBaseCommit:'7bfdb114363147ec2998d151dff22a786b2122ba',
    instanceId:c.instanceId,baselineSha256:checksum(),isolationSha256:isolationChecksum(),schema,
    zeroRowsBeforeSeed:true,tableRows,syntheticAccounts:4,syntheticInstitutions:2,identityMirrorsVerified:true,
    applicationEmailsRestrictedToInvalid:true,nonSyntheticEmailInsertRejected:true,
    appRole:{superuser:false,createDatabase:false,createRole:false,createSchema:false,bypassRls:true,scope:'DML core and epdg only'},
    health:true,anonymousDenied:true,learnerAdminDenied:true,allFourAccountLogins:true,
    recoveryCaptured:true,recoveryResetSucceeded:true,recoveryReplayRejected:true,smtpRejectsNonInvalidRecipients:true,
    outboundProviderHttpAndSmtpBlocked:true,wrongInstanceRejected:true,mailUiRequiresAuthentication:true,
    productionDataCopied:false,productionWrites:false,paidResourcesCreated:false,
    limits:['Local Windows development only; no hosted preview connectivity','Application network guard is not an OS sandbox','Supabase Auth, Storage, Realtime and Edge services unavailable','Full session revocation and invitation/owner authorization remain future work','Cross-institution API acceptance remains pending; fixture relationships only verified']};
  fs.writeFileSync(path.join(state,'verification.receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt,null,2));
}
module.exports={verify};
