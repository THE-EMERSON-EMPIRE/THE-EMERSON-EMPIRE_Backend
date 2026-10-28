'use strict';
// Fictional fixtures only. Copied from reviewed Railway seed; never copies rows.
const bcrypt=require('bcrypt');
const fixtures=require('../local-synthetic/learning-fixtures.cjs');
const F=require('../local-synthetic/handoff-fixtures.cjs');
async function seed(db,password){
 const {createDualWriteUser}=require('../../dist/utils/coreIdentity.js');
 const encoded=await bcrypt.hash(password,12),users={};
 await db.query("INSERT INTO core.branches(code,name) VALUES('epdg','EPDG Hosted Synthetic Practice')");
 for(const suffix of ['a','b']){
  const schoolUser=await createDualWriteUser(db,{email:`school-${suffix}@epdg.invalid`,name:`SYNTHETIC Institution ${suffix.toUpperCase()}`,hashedPassword:encoded,role:'school',isVerified:true});
  const {rows:[school]}=await db.query('INSERT INTO epdg.schools(user_id,school_name,email,is_approved,is_verified) VALUES($1,$2,$3,true,true) RETURNING id',
   [schoolUser.id,`SYNTHETIC Institution ${suffix.toUpperCase()}`,`school-${suffix}@epdg.invalid`]);
  const learner=await createDualWriteUser(db,{email:`learner-${suffix}@epdg.invalid`,name:`SYNTHETIC Learner ${suffix.toUpperCase()}`,hashedPassword:encoded,role:'intern',isVerified:true});
  await db.query('INSERT INTO epdg.intern_profiles(user_id,school_id,is_approved) VALUES($1,$2,true)',[learner.id,school.id]);
  users[`school-${suffix}@epdg.invalid`]={...schoolUser,schoolId:school.id};users[`learner-${suffix}@epdg.invalid`]={...learner,schoolId:school.id};
  for(const user of [schoolUser,learner]){
   await db.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)',[user.id]);
   const {rows:[membership]}=await db.query('INSERT INTO portal_security.memberships(user_id,school_id,active) VALUES($1,$2,true) RETURNING id',[user.id,school.id]);
   users[user.email??(user.id===learner.id?`learner-${suffix}@epdg.invalid`:`school-${suffix}@epdg.invalid`)].membershipId=membership.id;
  }
 }
 const programs=[...fixtures.programs,{id:F.programId,enrollmentId:F.enrollmentId,learner:F.learnerEmail,school:F.mentorEmail,title:F.title,summary:F.summary,
  items:F.items,resource:F.resource,startsAt:F.startsAt,endsAt:F.endsAt}];
 for(const [index,program]of programs.entries()){
  const learner=users[program.learner],mentor=users[program.school],starts=program.startsAt??'2026-10-27T00:00:00.000Z',ends=program.endsAt??'2026-11-10T00:00:00.000Z';
  await db.query('INSERT INTO synthetic_learning.programs(id,school_id,title,summary,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',[program.id,learner.schoolId,program.title,program.summary,starts,ends]);
  await db.query('INSERT INTO synthetic_learning.enrollments(id,program_id,user_id,school_id,membership_id,active) VALUES($1,$2,$3,$4,$5,true)',[program.enrollmentId,program.id,learner.id,learner.schoolId,learner.membershipId]);
  for(const [position,item]of program.items.entries())await db.query('INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [item.id,program.id,position+1,item.title,item.kind,item.description,item.content,new Date(Date.parse(starts)+item.day*86400000)]);
  const r=program.resource;await db.query('INSERT INTO synthetic_learning.resources(id,program_id,title,description,body) VALUES($1,$2,$3,$4,$5)',[r.id,program.id,r.title,r.description,r.body]);
  if(program.feedback){const f=program.feedback;await db.query('INSERT INTO synthetic_learning.feedback(id,enrollment_id,title,comment,mentor_label) VALUES($1,$2,$3,$4,$5)',[f.id,program.enrollmentId,f.title,f.comment,f.mentorLabel]);}
  await db.query('INSERT INTO synthetic_learning.mentor_assignments(id,mentor_user_id,membership_id,enrollment_id,school_id,active,mentor_label) VALUES($1,$2,$3,$4,$5,true,$6)',
   [program.id===F.programId?F.mentorAssignmentId:fixtures.id('6',index+1),mentor.id,mentor.membershipId,program.enrollmentId,learner.schoolId,program.school==='school-a@epdg.invalid'?'SYNTHETIC Mentor A':'SYNTHETIC Mentor B']);
 }
 await db.query('INSERT INTO synthetic_handoff.mappings(id,person_id,application_id,crm_program_id,reviewer_id,user_id,enrollment_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [F.mappingId,F.personId,F.applicationId,F.crmProgramId,F.reviewerId,users[F.learnerEmail].id,F.enrollmentId]);
}

module.exports={seed};
