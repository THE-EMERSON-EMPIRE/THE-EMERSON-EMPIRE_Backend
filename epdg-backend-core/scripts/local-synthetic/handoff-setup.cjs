'use strict';
// Explicit operator setup only; startup never calls this file.
const assert=require('node:assert/strict');
const C=require('./common.cjs');
const {migrate,identityGate}=require('./learning-migrate.cjs');
const {frozenSnapshot}=require('./learning-migration-policy.cjs');
const {protectedSnapshot}=require('./handoff-verify.cjs');
const F=require('./handoff-fixtures.cjs');
const reviewedSha256='2f32810a5956999693d98e3ea9f4ca200da53ae6530da3fb1e08c51ff54a75ca';
async function oldEnrollmentSnapshot(db){return (await db.query(`SELECT id,encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') AS sha256
 FROM synthetic_learning.enrollments e WHERE id<>$1 ORDER BY id`,[F.enrollmentId])).rows;}
async function setup(){
 const c=C.config();await C.preflight(c);
 const sql=C.fs.readFileSync(C.path.join(C.core,'learning-migrations/007-synthetic-crm-handoff.sql'));
 assert.equal(C.crypto.createHash('sha256').update(sql).digest('hex'),reviewedSha256,'Only the independently reviewed migration may be applied');
 let db=await C.client(c,true),before,protectedBefore,oldEnrollments;
 try{await identityGate(db,c);before=await frozenSnapshot(db);protectedBefore=await protectedSnapshot(db);oldEnrollments=await oldEnrollmentSnapshot(db);}finally{await db.end();}
 await migrate();const seed=await require('./handoff-seed.cjs').seed();
 db=await C.client(c,true);try{await identityGate(db,c);assert.deepEqual(await frozenSnapshot(db),before);
  const after=await protectedSnapshot(db);assert.deepEqual(after.filter(r=>r.table!=='synthetic_learning.enrollments'),protectedBefore.filter(r=>r.table!=='synthetic_learning.enrollments'));
  assert.deepEqual(await oldEnrollmentSnapshot(db),oldEnrollments,'Every prior enrollment must remain identical');
  const delta=after.find(r=>r.table==='synthetic_learning.enrollments').count-protectedBefore.find(r=>r.table==='synthetic_learning.enrollments').count;
  assert.ok(delta===0||delta===1,'Only the dedicated fictional enrollment may be added');
 }finally{await db.end();}
 const current=C.config();
 if(current.crmHandoffKey!==undefined){assert.match(current.crmHandoffKey,/^[A-Za-z0-9_-]{43}$/);assert.equal(Buffer.from(current.crmHandoffKey,'base64url').length,32);assert.equal(Buffer.from(current.crmHandoffKey,'base64url').toString('base64url'),current.crmHandoffKey);}
 else current.crmHandoffKey=C.crypto.randomBytes(32).toString('base64url');
 assert.ok(![current.jwtSecret,current.certificateSecret,current.csrfSecret,current.appPassword,current.adminPassword].includes(current.crmHandoffKey));
 current.crmHandoffEnabled=true;C.fs.writeFileSync(C.configFile,JSON.stringify(current,null,2));
 const receipt={at:new Date().toISOString(),reviewedSha256,localDatabase:'epdg_synthetic',host:'127.0.0.1',port:55432,
  preExistingImmutableRows:before.length,preExistingImmutableSha256:C.crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex'),
  allOldImmutableRowsPreserved:true,accountsPasswordsMembershipsRolesPreserved:true,seed,
  featureEnabledLocally:true,separateKeyGeneratedOrRetained:true,secretsPrinted:false,productionTouched:false};
 C.fs.writeFileSync(C.path.join(C.state,'handoff-setup.receipt.json'),JSON.stringify(receipt,null,2));return receipt;
}
module.exports={setup};
if(require.main===module)setup().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Local handoff setup failed; feature was not newly enabled unless every migration and preservation gate completed.');process.exitCode=1;});
