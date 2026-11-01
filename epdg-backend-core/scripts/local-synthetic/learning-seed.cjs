'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');
const manifest=require('../../src/learning/schema-manifest.json');
const fixtures=require('./learning-fixtures.cjs');
const {identityGate}=require('./learning-migrate.cjs');
async function seed() {
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);
  try {
    await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-local-learning-seed-v1'))");
    await identityGate(db,c);
    const {rows:ledger}=await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version');
    assert.deepEqual(ledger,[manifest,...manifest.extensions].map(({version,sha256})=>({version,sha256})));
    const {rows:users}=await db.query('SELECT id,email,name FROM core.users ORDER BY email');
    assert.deepEqual(users.map(u=>u.email),['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid']);
    assert.ok(users.every(u=>u.name.startsWith('SYNTHETIC ')));
    for(const program of fixtures.programs) {
      const learner=users.find(u=>u.email===program.learner);const schoolUser=users.find(u=>u.email===program.school);
      const {rows:[scope]}=await db.query(`SELECT m.id AS membership_id,s.id AS school_id
        FROM portal_security.memberships m JOIN epdg.schools s ON s.id=m.school_id
        JOIN epdg.intern_profiles i ON i.school_id=s.id AND i.user_id=m.user_id
        JOIN portal_security.account_states a ON a.user_id=m.user_id AND a.active
        WHERE m.user_id=$1 AND s.user_id=$2 AND m.active AND s.is_approved AND s.deleted_at IS NULL`,[learner.id,schoolUser.id]);
      assert.ok(scope,'Existing approved synthetic learner school membership required');
      await db.query(`INSERT INTO synthetic_learning.programs(id,school_id,title,summary,starts_at,ends_at)
        VALUES($1,$2,$3,$4,date_trunc('day',clock_timestamp()),date_trunc('day',clock_timestamp())+interval '14 days') ON CONFLICT(id) DO NOTHING`,
        [program.id,scope.school_id,program.title,program.summary]);
      const {rows:[existing]}=await db.query('SELECT title,school_id FROM synthetic_learning.programs WHERE id=$1',[program.id]);
      assert.equal(existing.title,program.title);assert.equal(existing.school_id,scope.school_id);
      await db.query(`INSERT INTO synthetic_learning.enrollments(id,program_id,user_id,school_id,membership_id)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,[program.enrollmentId,program.id,learner.id,scope.school_id,scope.membership_id]);
      const {rows:[enrollment]}=await db.query('SELECT program_id,user_id,school_id,membership_id FROM synthetic_learning.enrollments WHERE id=$1',[program.enrollmentId]);
      assert.deepEqual(enrollment,{program_id:program.id,user_id:learner.id,school_id:scope.school_id,membership_id:scope.membership_id});
      for(const [position,item] of program.items.entries()) {
        await db.query(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
          SELECT $1,$2,$3,$4,$5,$6,$7,starts_at+($8::int*interval '1 day') FROM synthetic_learning.programs WHERE id=$2
          ON CONFLICT(id) DO NOTHING`,[item.id,program.id,position+1,item.title,item.kind,item.description,item.content,item.day]);
      }
      const resource=program.resource;
      await db.query(`INSERT INTO synthetic_learning.resources(id,program_id,title,description,body)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,[resource.id,program.id,resource.title,resource.description,resource.body]);
      if(program.feedback) {
        const f=program.feedback;
        await db.query(`INSERT INTO synthetic_learning.feedback(id,enrollment_id,title,comment,mentor_label)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,[f.id,program.enrollmentId,f.title,f.comment,f.mentorLabel]);
      }
    }
    // One explicit completed practice lesson illustrates persistence; repeats
    // never overwrite timestamps, other completions, passwords, or account state.
    await db.query(`INSERT INTO synthetic_learning.completions(enrollment_id,program_id,item_id)
      VALUES($1,$2,$3) ON CONFLICT(enrollment_id,item_id) DO NOTHING`,[fixtures.id('2',1),fixtures.id('1',1),fixtures.id('3',1)]);
    await db.query('COMMIT');
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,programs:3,enrollments:3,lessons:7,textAssignments:3,
      feedback:2,resources:3,identitiesAdded:0,passwordsChanged:false,productionTouched:false};
    C.fs.writeFileSync(C.path.join(C.state,'learning-seed.receipt.json'),JSON.stringify(receipt,null,2));
    console.log(JSON.stringify(receipt));
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
module.exports={seed};
