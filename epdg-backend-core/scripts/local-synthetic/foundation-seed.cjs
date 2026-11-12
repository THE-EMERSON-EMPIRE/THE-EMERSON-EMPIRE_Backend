'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');

const EMAILS=['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid'];
async function seed(){
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);
  try{
    await db.query('BEGIN');
    const {rows:users}=await db.query('SELECT email,name FROM core.users ORDER BY email');
    if(users.length){
      assert.deepEqual(users.map(user=>user.email),EMAILS,'Existing user store must be the approved synthetic fixture set');
      assert.ok(users.every(user=>user.name.startsWith('SYNTHETIC ')),'Existing fixtures must remain synthetic');
      await db.query('COMMIT');console.log('Existing synthetic foundation fixtures verified; no identities or credentials changed.');return;
    }
    for(const table of ['core.branches','core.user_branch_roles','epdg.users','epdg.schools','epdg.intern_profiles']){
      const {rows:[result]}=await db.query('SELECT count(*)::int AS count FROM '+table);
      assert.equal(result.count,0,'Refusing to seed a partially populated table: '+table);
    }
    const bcrypt=require('bcrypt');
    const {createDualWriteUser}=require('../../dist/utils/coreIdentity.js');
    const hashedPassword=await bcrypt.hash(c.fixturePassword,12);
    await db.query("INSERT INTO core.branches(code,name) VALUES('epdg','EPDG Synthetic Test')");
    for(const suffix of ['a','b']){
      const schoolEmail='school-'+suffix+'@epdg.invalid';
      const school=await createDualWriteUser(db,{email:schoolEmail,name:'SYNTHETIC Institution '+suffix.toUpperCase(),hashedPassword,role:'school',isVerified:true});
      const {rows:[schoolRow]}=await db.query(
        'INSERT INTO epdg.schools(user_id,school_name,email,is_approved,is_verified) VALUES($1,$2,$3,true,true) RETURNING id',
        [school.id,'SYNTHETIC Institution '+suffix.toUpperCase(),schoolEmail]);
      const learnerEmail='learner-'+suffix+'@epdg.invalid';
      const learner=await createDualWriteUser(db,{email:learnerEmail,name:'SYNTHETIC Learner '+suffix.toUpperCase(),hashedPassword,role:'intern',isVerified:true});
      await db.query('INSERT INTO epdg.intern_profiles(user_id,school_id,is_approved) VALUES($1,$2,true)',[learner.id,schoolRow.id]);
    }
    const {rows:seeded}=await db.query('SELECT email,name FROM core.users ORDER BY email');
    assert.deepEqual(seeded.map(user=>user.email),EMAILS);
    assert.ok(seeded.every(user=>user.name.startsWith('SYNTHETIC ')));
    await db.query('COMMIT');
    console.log('Four fictional .invalid foundation fixtures created; no real identities or records used.');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
module.exports={seed};
