'use strict';
const assert=require('node:assert/strict');
const {validateNonDestructiveMigrationSql}=require('../../dist/db/migrationSafety.js');
const replacement='ALTER TABLE synthetic_learning.assignment_receipts DROP CONSTRAINT assignment_receipts_pkey;';
function validate(file,sql){
  if(file==='006-synthetic-assignment-revisions.sql'){
    assert.equal(sql.split(replacement).length-1,1,'Only the reviewed receipt PK replacement is permitted');
    assert.ok(sql.includes('ALTER TABLE synthetic_learning.assignment_receipts ADD PRIMARY KEY(enrollment_id,item_id,attempt_number);'));
    validateNonDestructiveMigrationSql(file,sql.replace(replacement,''));
  }else validateNonDestructiveMigrationSql(file,sql);
}
async function frozenSnapshot(db){
  const {rows}=await db.query(`SELECT 'receipt' AS kind,id::text,encode(sha256(convert_to(jsonb_build_array(
      id,enrollment_id,program_id,item_id,answer,revision,submitted_at,attachments)::text,'UTF8')),'hex') AS sha256
    FROM synthetic_learning.assignment_receipts
    UNION ALL SELECT 'file',id::text,encode(sha256(convert_to(jsonb_build_array(
      id,enrollment_id,program_id,item_id,filename,media_type,size_bytes,sha256,uploaded_at,removed,
      encode(sha256(bytes),'hex'))::text,'UTF8')),'hex') FROM synthetic_learning.assignment_attachments
    UNION ALL SELECT 'feedback',id::text,encode(sha256(convert_to(jsonb_build_array(
      id,assignment_id,receipt_id,comment,revision,published_at,mentor_label)::text,'UTF8')),'hex')
    FROM synthetic_learning.mentor_review_feedback ORDER BY kind,id`);
  return rows;
}
module.exports={validate,frozenSnapshot};
