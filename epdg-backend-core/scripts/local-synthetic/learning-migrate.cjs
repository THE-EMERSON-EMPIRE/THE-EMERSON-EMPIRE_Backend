'use strict';
const assert = require('node:assert/strict');
const C = require('./common.cjs');
const manifest = require('../../src/learning/schema-manifest.json');
const migrationPolicy=require('./learning-migration-policy.cjs');
async function identityGate(db, c) {
  const {rows:[identity]} = await db.query(`SELECT current_database() AS db,host(inet_server_addr()) AS host,
    inet_server_port() AS port,current_setting('data_directory') AS directory,instance_id::text,
    baseline_sha256,isolation_sha256 FROM synthetic_meta.identity`);
  assert.equal(identity.db,'epdg_synthetic');assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,55432);
  assert.equal(identity.instance_id,c.instanceId);assert.equal(identity.baseline_sha256,C.checksum());
  assert.equal(identity.isolation_sha256,C.isolationChecksum());
  assert.equal(C.path.resolve(identity.directory).toLowerCase(),C.path.join(C.state,'postgres').toLowerCase());
}
async function migrate() {
  const c=C.config();await C.preflight(c);
  const migrations=[manifest,...manifest.extensions].map(m=>{
    const sql=C.fs.readFileSync(C.path.join(C.core,'learning-migrations',m.file),'utf8');
    assert.equal(C.crypto.createHash('sha256').update(sql).digest('hex'),m.sha256,'Reviewed local migration checksum');
    migrationPolicy.validate(m.file,sql);
    return {...m,sql};
  });
  const db=await C.client(c,true);const applied=[];let preservation=null;
  try {
    await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-local-learning-migration-v1'))");
    await identityGate(db,c);
    const {rows:[existing]}=await db.query("SELECT to_regclass('synthetic_learning.schema_migrations') IS NOT NULL AS present");
    let ledger=[];
    if(existing.present) {
      ledger=(await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version')).rows;
      assert.ok(ledger.length>0&&ledger.length<=migrations.length,'Unknown local learning migration history requires review');
      for(const [index,row] of ledger.entries()) {
        assert.equal(row.version,migrations[index].version);assert.equal(row.sha256,migrations[index].sha256);
      }
    } else {
      const {rows:[unexpected]}=await db.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='synthetic_learning') AS present");
      assert.equal(unexpected.present,false,'Never overwrite an unknown learning schema');
    }
    for(const m of migrations.slice(ledger.length)) {
      let before;
      if(m.file==='006-synthetic-assignment-revisions.sql'){
        await db.query("SET LOCAL lock_timeout='5s'");
        await db.query('LOCK TABLE synthetic_learning.assignment_receipts,synthetic_learning.assignment_attachments,synthetic_learning.mentor_review_feedback IN ACCESS EXCLUSIVE MODE');
        before=await migrationPolicy.frozenSnapshot(db);
      }
      await db.query(m.sql);
      if(before){const after=await migrationPolicy.frozenSnapshot(db);assert.deepEqual(after,before,'Frozen old receipts, file bytes and published feedback must be preserved');
        preservation={oldImmutableRows:before.length,beforeSha256:C.crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex'),
          afterSha256:C.crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex'),allOldRowsUnchanged:true};
        }
      await db.query('INSERT INTO synthetic_learning.schema_migrations(version,sha256) VALUES($1,$2)',[m.version,m.sha256]);
      applied.push(m.version);
    }
    await db.query(`GRANT USAGE ON SCHEMA synthetic_learning TO epdg_synthetic_app;
      GRANT SELECT ON synthetic_learning.schema_migrations,synthetic_learning.programs,synthetic_learning.enrollments,
        synthetic_learning.items,synthetic_learning.completions,synthetic_learning.feedback,synthetic_learning.resources TO epdg_synthetic_app;
      GRANT INSERT(enrollment_id,program_id,item_id) ON synthetic_learning.completions TO epdg_synthetic_app;
      GRANT SELECT ON synthetic_learning.assignment_drafts,synthetic_learning.assignment_receipts TO epdg_synthetic_app;
      GRANT INSERT(enrollment_id,program_id,item_id,answer,revision) ON synthetic_learning.assignment_drafts,synthetic_learning.assignment_receipts TO epdg_synthetic_app;
      GRANT UPDATE(answer,revision,attempt_number,previous_receipt_id) ON synthetic_learning.assignment_drafts TO epdg_synthetic_app;
      GRANT SELECT ON synthetic_learning.assignment_attachments TO epdg_synthetic_app;
      GRANT INSERT(enrollment_id,program_id,item_id,filename,media_type,bytes) ON synthetic_learning.assignment_attachments TO epdg_synthetic_app;
      GRANT UPDATE(removed) ON synthetic_learning.assignment_attachments TO epdg_synthetic_app;
      GRANT SELECT ON synthetic_learning.mentor_assignments,synthetic_learning.mentor_review_drafts,synthetic_learning.mentor_review_feedback TO epdg_synthetic_app;
      GRANT INSERT(assignment_id,receipt_id,comment,revision) ON synthetic_learning.mentor_review_drafts,synthetic_learning.mentor_review_feedback TO epdg_synthetic_app;
      GRANT UPDATE(comment,revision) ON synthetic_learning.mentor_review_drafts TO epdg_synthetic_app;
      GRANT EXECUTE ON FUNCTION synthetic_learning.mentor_scope_allowed(uuid,uuid) TO epdg_synthetic_app;`);
    await db.query('COMMIT');
    if(preservation)C.fs.writeFileSync(C.path.join(C.state,'revision-migration-preservation.receipt.json'),JSON.stringify(preservation,null,2));
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,migrations:migrations.map(({version,sha256})=>({version,sha256})),
      applied,preservation,productionTouched:false,originalSchemaModified:false,privilegedPermissionsGranted:false};
    C.fs.writeFileSync(C.path.join(C.state,'learning-migration.receipt.json'),JSON.stringify(receipt,null,2));
    console.log(JSON.stringify(receipt));
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
module.exports={migrate,identityGate};
