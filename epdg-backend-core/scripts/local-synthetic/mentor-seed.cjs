'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');
const {identityGate}=require('./learning-migrate.cjs');
const manifest=require('../../src/learning/schema-manifest.json');
const fixtures=require('./learning-fixtures.cjs');
async function seed(){
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);let added=0;
  try{
    await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-local-mentor-seed-v1'))");
    await identityGate(db,c);
    const {rows:ledger}=await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version');
    assert.deepEqual(ledger,[manifest,...manifest.extensions].map(({version,sha256})=>({version,sha256})));
    const {rows:users}=await db.query('SELECT id,email,name FROM core.users ORDER BY email');
    assert.deepEqual(users.map(u=>u.email),['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid']);
    assert.ok(users.every(u=>u.name.startsWith('SYNTHETIC ')));
    for(const [index,program]of fixtures.programs.entries()){
      const mentor=users.find(u=>u.email===program.school);const learner=users.find(u=>u.email===program.learner);
      const {rows:[scope]}=await db.query(`SELECT m.id AS membership_id,s.id AS school_id
        FROM synthetic_learning.enrollments e JOIN epdg.schools s ON s.id=e.school_id AND s.user_id=$1
        JOIN portal_security.memberships m ON m.user_id=s.user_id AND m.school_id=s.id AND m.active
        JOIN portal_security.memberships lm ON lm.id=e.membership_id AND lm.user_id=e.user_id AND lm.school_id=s.id AND lm.active
        JOIN portal_security.account_states ms ON ms.user_id=m.user_id AND ms.active
        JOIN portal_security.account_states ls ON ls.user_id=e.user_id AND ls.active
        WHERE e.id=$2 AND e.user_id=$3 AND e.program_id=$4 AND e.active AND s.is_approved AND s.deleted_at IS NULL`,
        [mentor.id,program.enrollmentId,learner.id,program.id]);
      assert.ok(scope,'Current same-school synthetic mentor and learner scope required');
      const id=fixtures.id('6',index+1);const label=program.school==='school-a@epdg.invalid'?'SYNTHETIC Mentor A':'SYNTHETIC Mentor B';
      const expected={mentor_user_id:mentor.id,membership_id:scope.membership_id,enrollment_id:program.enrollmentId,school_id:scope.school_id,mentor_label:label};
      const result=await db.query(`INSERT INTO synthetic_learning.mentor_assignments(id,mentor_user_id,membership_id,enrollment_id,school_id,active,mentor_label)
        VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(id) DO NOTHING`,[id,mentor.id,scope.membership_id,program.enrollmentId,scope.school_id,label]);
      added+=result.rowCount;
      const {rows:[existing]}=await db.query(`SELECT mentor_user_id,membership_id,enrollment_id,school_id,mentor_label
        FROM synthetic_learning.mentor_assignments WHERE id=$1`,[id]);
      assert.deepEqual(existing,expected,'Never reassign or reactivate an existing mentor mapping');
    }
    await db.query('COMMIT');
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,mappings:3,added,existingInactiveMappingsPreserved:true,
      identitiesAdded:0,passwordsChanged:false,rolesChanged:false,privilegedPermissionsGranted:false,productionTouched:false};
    C.fs.writeFileSync(C.path.join(C.state,'mentor-seed.receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
module.exports={seed};
