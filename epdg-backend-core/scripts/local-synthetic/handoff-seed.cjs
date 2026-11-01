'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');
const {identityGate}=require('./learning-migrate.cjs');
const manifest=require('../../src/learning/schema-manifest.json');
const F=require('./handoff-fixtures.cjs');

async function seed(){
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);let added=0;
  try{
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-synthetic-crm-handoff-v1',0))");
    await identityGate(db,c);
    const {rows:[operator]}=await db.query('SELECT current_user AS role');
    assert.equal(operator.role,'epdg_synthetic_operator','Only the isolated local operator may seed fictional mappings');
    const {rows:ledger}=await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version');
    assert.deepEqual(ledger,[manifest,...manifest.extensions].map(({version,sha256})=>({version,sha256})));
    assert.ok(manifest.extensions.some(migration => migration.file==='008-synthetic-handoff-reviewer-provenance.sql'),'The reviewed handoff migrations must be applied first');
    const {rows:users}=await db.query('SELECT id,email,name FROM core.users ORDER BY email');
    assert.deepEqual(users.map(user=>user.email),['learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid']);
    assert.ok(users.every(user=>user.name.startsWith('SYNTHETIC ')));
    const learner=users.find(user=>user.email===F.learnerEmail);const mentor=users.find(user=>user.email===F.mentorEmail);
    const {rows:scopes}=await db.query(`SELECT lm.id AS learner_membership_id,mm.id AS mentor_membership_id,s.id AS school_id
      FROM core.users lu JOIN epdg.users leu ON leu.id=lu.id
      JOIN epdg.intern_profiles ip ON ip.user_id=lu.id
      JOIN epdg.schools s ON s.id=ip.school_id
      JOIN core.users mu ON mu.id=s.user_id JOIN epdg.users meu ON meu.id=mu.id
      JOIN portal_security.memberships lm ON lm.user_id=lu.id AND lm.school_id=s.id AND lm.active
      JOIN portal_security.memberships mm ON mm.user_id=mu.id AND mm.school_id=s.id AND mm.active
      JOIN portal_security.account_states ls ON ls.user_id=lu.id AND ls.active
      JOIN portal_security.account_states ms ON ms.user_id=mu.id AND ms.active
      WHERE lu.id=$1 AND mu.id=$2 AND lu.deleted_at IS NULL AND lu.is_verified
        AND mu.deleted_at IS NULL AND mu.is_verified AND leu.deleted_at IS NULL AND leu.is_verified AND leu.rejection_reason IS NULL
        AND meu.deleted_at IS NULL AND meu.is_verified AND meu.rejection_reason IS NULL
        AND ip.is_approved AND ip.rejection_reason IS NULL AND s.is_approved AND s.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM core.user_branch_roles r JOIN core.branches b ON b.id=r.branch_id
          WHERE r.user_id=lu.id AND b.code='epdg' AND r.role_name::text='intern' AND r.rejection_reason IS NULL)
        AND EXISTS(SELECT 1 FROM core.user_branch_roles r JOIN core.branches b ON b.id=r.branch_id
          WHERE r.user_id=mu.id AND b.code='epdg' AND r.role_name::text='school' AND r.rejection_reason IS NULL)`,[learner.id,mentor.id]);
    assert.equal(scopes.length,1,'Exactly one current approved School B learner and mentor scope is required');
    const scope=scopes[0];
    const insert=async(sql,parameters)=>{const result=await db.query(sql,parameters);added+=result.rowCount;};
    await insert(`INSERT INTO synthetic_learning.programs(id,school_id,title,summary,starts_at,ends_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[F.programId,scope.school_id,F.title,F.summary,F.startsAt,F.endsAt]);
    const {rows:[program]}=await db.query(`SELECT school_id,title,summary,starts_at,ends_at FROM synthetic_learning.programs WHERE id=$1`,[F.programId]);
    assert.ok(program,'Dedicated fictional program required');
    assert.deepEqual({...program,starts_at:program.starts_at.toISOString(),ends_at:program.ends_at.toISOString()},
      {school_id:scope.school_id,title:F.title,summary:F.summary,starts_at:F.startsAt,ends_at:F.endsAt},'Never alter an existing program');
    await insert(`INSERT INTO synthetic_learning.enrollments(id,program_id,user_id,school_id,membership_id,active)
      VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO NOTHING`,[F.enrollmentId,F.programId,learner.id,scope.school_id,scope.learner_membership_id]);
    const {rows:[enrollment]}=await db.query(`SELECT program_id,user_id,school_id,membership_id,active FROM synthetic_learning.enrollments WHERE id=$1`,[F.enrollmentId]);
    assert.deepEqual(enrollment,{program_id:F.programId,user_id:learner.id,school_id:scope.school_id,membership_id:scope.learner_membership_id,active:true},
      'Never reassign or reactivate an existing enrollment');
    for(const item of F.items){
      const dueAt=new Date(Date.parse(F.startsAt)+item.day*86400000).toISOString();
      await insert(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,[item.id,F.programId,item.position,item.title,item.kind,item.description,item.content,dueAt]);
      const {rows:[existing]}=await db.query(`SELECT program_id,position,title,kind,description,content,due_at FROM synthetic_learning.items WHERE id=$1`,[item.id]);
      assert.ok(existing,'Fictional learning item required');
      assert.deepEqual({...existing,due_at:existing.due_at.toISOString()},{program_id:F.programId,position:item.position,title:item.title,
        kind:item.kind,description:item.description,content:item.content,due_at:dueAt},'Never overwrite an existing learning item');
    }
    await insert(`INSERT INTO synthetic_learning.resources(id,program_id,title,description,body)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,[F.resourceId,F.programId,F.resource.title,F.resource.description,F.resource.body]);
    const {rows:[resource]}=await db.query('SELECT program_id,title,description,body FROM synthetic_learning.resources WHERE id=$1',[F.resourceId]);
    assert.deepEqual(resource,{program_id:F.programId,title:F.resource.title,description:F.resource.description,body:F.resource.body},'Never overwrite an existing resource');
    // Establish the ordinary same-school mentor mapping before the restrictive CRM handoff mapping.
    await insert(`INSERT INTO synthetic_learning.mentor_assignments(id,mentor_user_id,membership_id,enrollment_id,school_id,active,mentor_label)
      VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(id) DO NOTHING`,[F.mentorAssignmentId,mentor.id,scope.mentor_membership_id,F.enrollmentId,scope.school_id,F.mentorLabel]);
    const {rows:[mentorMapping]}=await db.query(`SELECT mentor_user_id,membership_id,enrollment_id,school_id,active,mentor_label
      FROM synthetic_learning.mentor_assignments WHERE id=$1`,[F.mentorAssignmentId]);
    assert.deepEqual(mentorMapping,{mentor_user_id:mentor.id,membership_id:scope.mentor_membership_id,enrollment_id:F.enrollmentId,
      school_id:scope.school_id,active:true,mentor_label:F.mentorLabel},'Never reassign or reactivate an existing mentor mapping');
    const {rows:programEnrollments}=await db.query('SELECT id FROM synthetic_learning.enrollments WHERE program_id=$1 ORDER BY id',[F.programId]);
    assert.deepEqual(programEnrollments,[{id:F.enrollmentId}],'Dedicated practice program must have only its reviewed enrollment');
    const {rows:programItems}=await db.query(`SELECT id,program_id,position,title,kind,description,content
      FROM synthetic_learning.items WHERE program_id=$1 ORDER BY position`,[F.programId]);
    const fixedItemIds=new Set(F.items.map(item=>item.id));
    assert.deepEqual(programItems.filter(item=>fixedItemIds.has(item.id)).map(item=>({id:item.id})),
      F.items.map(item=>({id:item.id})),'Dedicated practice program must retain all reviewed fixed items');
    // The verifier deliberately appends a new assignment for each rehearsal so
    // previous receipts remain frozen. Permit only those exact fictional rows;
    // all other extra items still stop the seed instead of being overwritten.
    for(const item of programItems.filter(item=>!fixedItemIds.has(item.id))){
      assert.match(item.id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.ok(Number.isInteger(item.position)&&item.position>F.items.length,'Only appended QA positions are allowed');
      assert.deepEqual({program_id:item.program_id,title:item.title,kind:item.kind,description:item.description,content:item.content},
        {program_id:F.programId,title:'SYNTHETIC CRM Handoff QA',kind:'assignment',description:'SYNTHETIC handoff rehearsal only.',
          content:'SYNTHETIC describe a fictional welcome plan after a signed onboarding clearance.'},
        'Unrecognized extra items require review before seeding');
    }
    const {rows:programResources}=await db.query('SELECT id FROM synthetic_learning.resources WHERE program_id=$1 ORDER BY id',[F.programId]);
    assert.deepEqual(programResources,[{id:F.resourceId}],'Dedicated practice program must have only its reviewed resource');
    const {rows:enrollmentMentors}=await db.query('SELECT id FROM synthetic_learning.mentor_assignments WHERE enrollment_id=$1 ORDER BY id',[F.enrollmentId]);
    assert.deepEqual(enrollmentMentors,[{id:F.mentorAssignmentId}],'Dedicated enrollment must have only its reviewed mentor mapping');
    await insert(`INSERT INTO synthetic_handoff.mappings(id,person_id,application_id,crm_program_id,reviewer_id,user_id,enrollment_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,[F.mappingId,F.personId,F.applicationId,F.crmProgramId,F.reviewerId,learner.id,F.enrollmentId]);
    const {rows:mappings}=await db.query('SELECT id,person_id,application_id,crm_program_id,reviewer_id,user_id,enrollment_id FROM synthetic_handoff.mappings ORDER BY id');
    assert.deepEqual(mappings,[{id:F.mappingId,person_id:F.personId,application_id:F.applicationId,crm_program_id:F.crmProgramId,
      reviewer_id:F.reviewerId,user_id:learner.id,enrollment_id:F.enrollmentId}],'Only the exact reviewed fictional mapping is allowed');
    await db.query('COMMIT');
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,programs:1,enrollments:1,lessons:1,assignments:1,resources:1,
      mentorMappings:1,handoffMappings:1,rowsAdded:added,identitiesAdded:0,passwordsChanged:false,sessionsChanged:false,
      rolesChanged:false,privilegedPermissionsGranted:false,priorLearningRecordsChanged:false,productionTouched:false};
    C.fs.writeFileSync(C.path.join(C.state,'handoff-seed.receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));return receipt;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
module.exports={seed};
