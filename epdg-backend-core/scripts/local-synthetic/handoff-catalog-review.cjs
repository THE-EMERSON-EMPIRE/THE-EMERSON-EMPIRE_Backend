'use strict';
// Read-only metadata/count/hash audit. Never returns credentials or HR records.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const C=require('./common.cjs');
const {identityGate}=require('./learning-migrate.cjs');
const manifest=require('../../src/learning/schema-manifest.json');
const sourceFiles=['learning-migrations/007-synthetic-crm-handoff.sql','learning-migrations/008-synthetic-handoff-reviewer-provenance.sql','learning-migrations/009-synthetic-historical-evidence.sql','src/handoff/config.ts','src/handoff/contract.ts',
  'src/handoff/HandoffService.ts','src/handoff/learningGate.ts','src/handoff/routes.ts','src/learning/LearningService.ts',
  'src/learning/MentorReviewService.ts','src/learning/schema-manifest.json','src/security/routes.ts','src/app.ts'];
const digest=value=>C.crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const normalize=value=>JSON.parse(JSON.stringify(value).replace(/\\r\\n/g,'\\n')
  .replace(/::character varying::text/g,'::character varying').replace(/\]::text\[\]/g,']'));

function runtimeAccess(){
  const literal=C.configFile.replaceAll("'","''");
  const parentLiteral=C.state.replaceAll("'","''");
  const command=`$userSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; function Describe-Acl($target) { `+
    `$acl=Get-Acl -LiteralPath $target; $allowed=@($userSid,'S-1-5-18'); $allowEntries=@($acl.Access | Where-Object {$_.AccessControlType -eq 'Allow'}); `+
    `$observed=@($allowEntries | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); `+
    `$unexpected=@($observed | Where-Object {$_ -notin $allowed}); `+
    `[pscustomobject]@{inheritanceDisabled=$acl.AreAccessRulesProtected; allowedPrincipalsOnly=($unexpected.Count -eq 0); `+
    `currentUserPresent=($observed -contains $userSid); systemPresent=($observed -contains 'S-1-5-18')} }; `+
    `[pscustomobject]@{file=(Describe-Acl '${literal}'); parent=(Describe-Acl '${parentLiteral}')} | ConvertTo-Json -Depth 3 -Compress`;
  const acl=JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true}));
  for(const entry of [acl.file,acl.parent]){
    assert.equal(entry.allowedPrincipalsOnly,true);assert.equal(entry.currentUserPresent,true);assert.equal(entry.systemPresent,true);
  }
  assert.equal(acl.parent.inheritanceDisabled,true,'Inherited file rights require a protected private parent boundary');
  execFileSync('C:/Program Files/Git/cmd/git.exe',['check-ignore','--quiet','--','.local-synthetic/runtime.json'],
    {cwd:C.backend,windowsHide:true,stdio:'pipe'});
  return {file:acl.file,parent:acl.parent,privateParentBoundaryVerified:true,gitIgnored:true,configurationContentsLogged:false};
}

async function review(){
  const c=C.config();await C.preflight(c);const db=await C.client(c,true);
  let receipt;
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await identityGate(db,c);
    const expected=[manifest,...manifest.extensions].map(({version,sha256})=>({version,sha256}));assert.equal(expected.length,9);
    for(const m of [manifest,...manifest.extensions])assert.equal(digest(C.fs.readFileSync(C.path.join(C.core,'learning-migrations',m.file),'utf8')),m.sha256);
    const {rows:ledger}=await db.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations ORDER BY applied_at,version');
    assert.deepEqual(ledger,expected);
    const {rows:schemas}=await db.query(`SELECT n.nspname AS schema,count(*)::int AS tables,
      count(*) FILTER(WHERE c.relrowsecurity)::int AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('synthetic_handoff','synthetic_learning','portal_security') AND c.relkind='r' GROUP BY n.nspname ORDER BY n.nspname`);
    assert.deepEqual(schemas,[{schema:'portal_security',tables:6,rls:6},{schema:'synthetic_handoff',tables:3,rls:3},{schema:'synthetic_learning',tables:15,rls:15}]);
    const {rows:[safety]}=await db.query(`SELECT
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='synthetic_handoff') AS handoff_policies,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='synthetic_handoff' AND p.prosecdef) AS security_definers,
      has_schema_privilege('epdg_synthetic_app','synthetic_handoff','CREATE') AS app_schema_create,
      has_any_column_privilege('epdg_synthetic_app','synthetic_handoff.mappings','INSERT,UPDATE') OR
        has_table_privilege('epdg_synthetic_app','synthetic_handoff.mappings','DELETE,TRUNCATE') AS app_mapping_write,
      has_any_column_privilege('epdg_synthetic_app','synthetic_learning.enrollments','INSERT,UPDATE') OR
        has_table_privilege('epdg_synthetic_app','synthetic_learning.enrollments','DELETE,TRUNCATE') AS app_enrollment_write,
      has_any_column_privilege('epdg_synthetic_app','synthetic_handoff.events','UPDATE') OR
        has_table_privilege('epdg_synthetic_app','synthetic_handoff.events','DELETE,TRUNCATE') OR
        has_column_privilege('epdg_synthetic_app','synthetic_handoff.events','received_at','INSERT') AS app_event_admin,
      has_any_column_privilege('epdg_synthetic_app','synthetic_handoff.nonces','UPDATE') OR
        has_table_privilege('epdg_synthetic_app','synthetic_handoff.nonces','DELETE,TRUNCATE') OR
        has_column_privilege('epdg_synthetic_app','synthetic_handoff.nonces','received_at','INSERT') AS app_nonce_admin,
      has_function_privilege('epdg_synthetic_app','synthetic_handoff.enrollment_allowed(uuid)','EXECUTE') AS app_gate_execute`);
    assert.deepEqual(safety,{handoff_policies:0,security_definers:0,app_schema_create:false,app_mapping_write:false,
      app_enrollment_write:false,app_event_admin:false,app_nonce_admin:false,app_gate_execute:true});
    const {rows:browserGrants}=await db.query(`WITH grants AS (
      SELECT 'schema' AS kind,acl.grantee,acl.privilege_type FROM pg_namespace n
        CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='synthetic_handoff'
      UNION ALL SELECT 'table',acl.grantee,acl.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='synthetic_handoff'
      UNION ALL SELECT 'column',acl.grantee,acl.privilege_type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) acl
        WHERE n.nspname='synthetic_handoff' AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL SELECT 'function',acl.grantee,acl.privilege_type FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='synthetic_handoff')
      SELECT kind,privilege_type FROM grants LEFT JOIN pg_roles r ON r.oid=grants.grantee
        WHERE grants.grantee=0 OR r.rolname IN ('anon','authenticated') ORDER BY kind,privilege_type`);
    assert.deepEqual(browserGrants,[]);
    const {rows:triggers}=await db.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,t.tgtype::int AS type,
      pn.nspname AS function_schema,p.proname AS function_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname='synthetic_learning' AND NOT t.tgisinternal AND (t.tgtype::int & 2)=2
      ORDER BY c.relname,t.tgname COLLATE "C"`);
    const learningTables={completions:'a_handoff_completion_guard',assignment_drafts:'a_handoff_draft_guard',
      assignment_receipts:'a_handoff_receipt_guard',assignment_attachments:'a_handoff_attachment_guard',
      mentor_review_drafts:'a_handoff_mentor_draft_guard',mentor_review_feedback:'a_handoff_mentor_feedback_guard'};
    const orderedGuards=[];
    for(const [table,name] of Object.entries(learningTables)){
      const group=triggers.filter(row=>row.table_name===table);assert.ok(group.length);assert.equal(group[0].name,name);
      const first=group[0];assert.equal(first.enabled,'O');assert.equal(first.type,31);
      assert.equal(first.function_schema,'synthetic_handoff');assert.equal(first.function_name,'guard_learning_write');
      orderedGuards.push({table,firstGuard:name,otherBeforeGuards:group.slice(1).map(row=>row.name)});
    }
    const {rows:handoffGuards}=await db.query(`SELECT t.tgname AS name,t.tgenabled AS enabled,t.tgtype::int AS type
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='synthetic_handoff' AND NOT t.tgisinternal ORDER BY t.tgname`);
    assert.deepEqual(handoffGuards,['handoff_event_guard','handoff_mapping_guard','handoff_nonce_guard'].map(name=>({name,enabled:'O',type:31})));
    const metadataSql=C.fs.readFileSync(C.path.join(C.state,'schema-metadata-query.sql'),'utf8');
    const actual=(await db.query(metadataSql)).rows[0].baseline;
    const expectedMetadata=JSON.parse(C.fs.readFileSync(C.path.join(C.state,'schema-metadata-expected.json'),'utf8'));
    assert.equal(actual.tables.length,50);const removed=actual.constraints.filter(row=>row.name==='synthetic_email_only').length;
    assert.equal(removed,5);actual.constraints=actual.constraints.filter(row=>row.name!=='synthetic_email_only');
    const differences=[];
    for(const section of Object.keys(expectedMetadata)){
      try{assert.deepEqual(normalize(actual[section]),normalize(expectedMetadata[section]));}catch{differences.push(section);}
    }
    assert.deepEqual(differences,[]);
    const originalMetadata={tablesCompared:50,sectionsCompared:Object.keys(expectedMetadata),differences,
      canonicalNormalizedSha256:digest(canonical(normalize(actual))),expectedCanonicalNormalizedSha256:digest(canonical(normalize(expectedMetadata))),
      normalization:'Retain all source metadata; omit only five reviewed local synthetic_email_only constraints and normalize equivalent varchar/text array cast deparsing and CRLF',
      baselineSource:'Existing metadata-only source snapshot; no remote inspection or application rows were read'};
    assert.equal(originalMetadata.canonicalNormalizedSha256,originalMetadata.expectedCanonicalNormalizedSha256);
    const {rows:[accounts]}=await db.query(`SELECT (SELECT count(*)::int FROM core.users) AS synthetic_accounts,
      (SELECT count(*)::int FROM core.users WHERE email NOT LIKE '%@epdg.invalid' OR name NOT LIKE 'SYNTHETIC %') AS non_synthetic_accounts,
      (SELECT count(*)::int FROM core.user_branch_roles WHERE role_name::text NOT IN ('intern','school')) AS privileged_roles`);
    assert.deepEqual(accounts,{synthetic_accounts:4,non_synthetic_accounts:0,privileged_roles:0});
    const {rows:[latest]}=await db.query(`SELECT decision,decision_version,withdrawn FROM synthetic_handoff.events
      WHERE mapping_id='84000000-0000-4000-8000-000000000001' ORDER BY decision_version DESC LIMIT 1`);
    receipt={at:new Date().toISOString(),readOnlyTransaction:true,database:'epdg_synthetic',host:'127.0.0.1',port:55432,
      learningLedger:ledger,schemas,safety,browserGrantCount:browserGrants.length,orderedLearningGuards:orderedGuards,handoffGuards,
      originalMetadata,accounts,latestSyntheticDecision:latest??null,
      immutablePreservation:'Root setup and live verification receipts separately prove prior immutable rows; no row identities or contents exported here',
      configurationAccess:runtimeAccess(),sourceFiles:sourceFiles.map(file=>({file,sha256:digest(C.fs.readFileSync(C.path.join(C.core,file),'utf8'))})),
      reviewerDatabaseMutations:0,productionTouched:false,realInternRecordsUsed:false};
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
  const output=C.path.join(C.workspace,'build-evidence/epdg-synthetic-2026-10-24/crm-onboarding-handoff/backend/independent-catalog-review.json');
  C.fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
  return {receipt:output,sha256:digest(C.fs.readFileSync(output,'utf8')),ledgerEntries:9,handoffRlsTables:3,browserGrants:0,
    firstOrderedLearningGuards:6,originalMetadataTables:50,originalMetadataDifferences:0,runtimeAclAndGitignoreVerified:true};
}
module.exports={review};
if(require.main===module)review().then(value=>console.log(JSON.stringify(value))).catch(()=>{
  console.error('Read-only local handoff catalog review failed; no database changes were made.');process.exitCode=1;
});
