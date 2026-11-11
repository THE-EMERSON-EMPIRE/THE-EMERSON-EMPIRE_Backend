'use strict';
const assert=require('node:assert/strict');
const bcrypt=require('bcrypt');
const C=require('./common.cjs');
const {createDualWriteUser}=require('../../dist/utils/coreIdentity.js');
const fixtureEmail='founder-admin@epdg.invalid';
const fixtureName='SYNTHETIC Local Founder Admin';
async function seed(){
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);
  try{
    await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-local-admin-staging-seed-v1'))");
    const {rows:ledger}=await db.query('SELECT sha256 FROM portal_security.schema_migrations WHERE version=$1',[require('../../src/security/admin-schema-manifest.json').version]);
    assert.equal(ledger.length,1,'Run the isolated administrator migration first');
    const {rows:existing}=await db.query('SELECT id,name,email,is_verified FROM core.users WHERE lower(email)=$1 AND deleted_at IS NULL',[fixtureEmail]);
    let userId;
    if(existing.length===0){
      const password=await bcrypt.hash(c.fixturePassword,12);
      const created=await createDualWriteUser(db,{email:fixtureEmail,name:fixtureName,hashedPassword:password,role:'admin',adminRole:'admin',isVerified:true});
      userId=created.id;
    }else{
      assert.equal(existing.length,1);assert.equal(existing[0].name,fixtureName);assert.equal(existing[0].email,fixtureEmail);assert.equal(existing[0].is_verified,true);
      userId=existing[0].id;
    }
    await db.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true) ON CONFLICT(user_id) DO NOTHING',[userId]);
    const {rows:[state]}=await db.query('SELECT active FROM portal_security.account_states WHERE user_id=$1',[userId]);
    assert.equal(state.active,true,'Existing synthetic administrator state is not rewritten');
    const {rows:roles}=await db.query("SELECT status FROM portal_security.role_assignments WHERE user_id=$1 AND role_code='founder_admin' ORDER BY created_at",[userId]);
    if(roles.length===0)await db.query("INSERT INTO portal_security.role_assignments(user_id,role_code,status) VALUES($1,'founder_admin','active')",[userId]);
    else assert.deepEqual(roles,[{status:'active'}],'Unexpected founder fixture role state');
    const {rows:confirmed}=await db.query("SELECT count(*)::int AS active_founders FROM portal_security.role_assignments WHERE user_id=$1 AND role_code='founder_admin' AND status='active'",[userId]);
    assert.equal(confirmed[0].active_founders,1);
    await db.query('COMMIT');
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,fixture:'founder-admin@epdg.invalid',identityCreated:existing.length===0,activeFounderRoles:1,productionTouched:false};
    C.fs.writeFileSync(C.path.join(C.state,'admin-seed.receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
module.exports={seed};
if(require.main===module)seed().catch(error=>{console.error('Admin-staging seed failed:',error.message);process.exit(1);});
