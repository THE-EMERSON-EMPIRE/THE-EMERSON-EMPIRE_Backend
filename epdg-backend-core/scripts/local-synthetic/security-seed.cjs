'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');
async function seed(){
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);
  try{
    await db.query('BEGIN');
    const {rows:users}=await db.query('SELECT id,email,name FROM core.users ORDER BY email');
    assert.equal(users.length,4);assert.deepEqual(users.map(u=>u.email),['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid']);
    assert.ok(users.every(u=>u.name.startsWith('SYNTHETIC ')));
    const {rows:[state]}=await db.query('SELECT count(*)::int AS accounts FROM portal_security.account_states');
    const {rows:[membership]}=await db.query('SELECT count(*)::int AS memberships FROM portal_security.memberships');
    if(state.accounts===0&&membership.memberships===0){
      for(const suffix of ['a','b']){
        const schoolUser=users.find(u=>u.email===`school-${suffix}@epdg.invalid`);
        const learner=users.find(u=>u.email===`learner-${suffix}@epdg.invalid`);
        const {rows:[school]}=await db.query('SELECT id FROM epdg.schools WHERE user_id=$1',[schoolUser.id]);assert.ok(school);
        const {rows:[profile]}=await db.query('SELECT school_id FROM epdg.intern_profiles WHERE user_id=$1',[learner.id]);assert.equal(profile.school_id,school.id);
        for(const user of [schoolUser,learner]){
          await db.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)',[user.id]);
          await db.query('INSERT INTO portal_security.memberships(user_id,school_id,active) VALUES($1,$2,true)',[user.id,school.id]);
        }
      }
    }else{assert.equal(state.accounts,4);assert.equal(membership.memberships,4);}
    await db.query('COMMIT');console.log('Four existing synthetic users enabled with institution-scoped test memberships; no privileged permissions granted.');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
module.exports={seed};
