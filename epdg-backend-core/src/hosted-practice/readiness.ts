import type { PoolClient } from 'pg';
import { PortalError } from '../security/primitives';
import securityManifest from '../security/schema-manifest.json';
import learningManifest from '../learning/schema-manifest.json';
import hostedManifest from './schema-manifest.json';
import { HostedPracticeProfile, validateHostedPracticeEnvironment } from './profile';
import { checkSupabaseIdentity } from './supabase-readiness';
import supabaseManifest from './supabase-schema-manifest.json';

const unavailable = () => new PortalError(503, 'Hosted practice is unavailable');
const readTables = ['core.users','core.branches','core.user_branch_roles','epdg.users','epdg.schools','epdg.companies',
  'epdg.intern_profiles','epdg.admins','portal_security.schema_migrations','portal_security.account_states',
  'portal_security.memberships','portal_security.sessions','portal_security.recovery_tokens','synthetic_learning.schema_migrations',
  'synthetic_learning.programs','synthetic_learning.enrollments','synthetic_learning.items','synthetic_learning.completions',
  'synthetic_learning.feedback','synthetic_learning.resources','synthetic_learning.assignment_drafts','synthetic_learning.assignment_receipts',
  'synthetic_learning.assignment_attachments','synthetic_learning.mentor_assignments','synthetic_learning.mentor_review_drafts',
  'synthetic_learning.mentor_review_feedback','synthetic_handoff.mappings','synthetic_handoff.events','synthetic_handoff.nonces','hosted_practice.identity'];
const inserts: Record<string, string[]> = {
  'portal_security.sessions': ['user_id','token_hash','credential_version','account_revision','membership_fingerprint','expires_at'],
  'portal_security.recovery_tokens': ['user_id','token_hash','credential_version','account_revision','expires_at'],
  'portal_security.audit_events': ['event','user_id','session_id'],
  'synthetic_learning.completions': ['enrollment_id','program_id','item_id'],
  'synthetic_learning.assignment_drafts': ['enrollment_id','program_id','item_id','answer','revision'],
  'synthetic_learning.assignment_receipts': ['enrollment_id','program_id','item_id','answer','revision'],
  'synthetic_learning.assignment_attachments': ['enrollment_id','program_id','item_id','filename','media_type','bytes'],
  'synthetic_learning.mentor_review_drafts': ['assignment_id','receipt_id','comment','revision'],
  'synthetic_learning.mentor_review_feedback': ['assignment_id','receipt_id','comment','revision'],
  'synthetic_handoff.events': ['event_id','payload_sha256','mapping_id','decision_id','decision_version','decision','issued_at','policy_version',
    'reviewer_id','identity_verified','onboarding_complete','agreements_complete','hr_approved','withdrawn'],
  'synthetic_handoff.nonces': ['nonce','event_id'], 'hosted_practice.mail_capture': ['from_address','recipient','subject','html'],
};
const updates: Record<string, string[]> = {
  'core.users': ['password'], 'epdg.users': ['password'], 'core.user_branch_roles': ['role_name'],
  'portal_security.account_states': ['revision'], 'portal_security.sessions': ['last_seen_at','revoked_at','revoked_reason'],
  'portal_security.recovery_tokens': ['consumed_at','revoked_at'],
  'synthetic_learning.assignment_drafts': ['answer','revision','attempt_number','previous_receipt_id'],
  'synthetic_learning.assignment_attachments': ['removed'], 'synthetic_learning.mentor_review_drafts': ['comment','revision'],
};
const railwaySchemas = ['public','private','core','epdg','portal_security','synthetic_learning','synthetic_handoff','hosted_practice','synthetic_meta'];
const protectedSchemas = ['portal_security','synthetic_learning','synthetic_handoff','hosted_practice'];
const expectedPolicies = [
  ...readTables.map(table => ({ table, name: 'hosted_app_select', command: 'r' })),
  ...Object.keys(inserts).map(table => ({ table, name: 'hosted_app_insert', command: 'a' })),
  ...Object.keys(updates).map(table => ({ table, name: 'hosted_app_update', command: 'w' })),
];
function policyExpression(value: unknown): boolean {
  return typeof value === 'string' && /^\(?CURRENT_USER\s*=\s*'epdg_synthetic_app'::name\)?$/i.test(value);
}

/** No operator credential, migration or seed is available to this runtime. */
export async function checkHostedDatabase(client: PoolClient): Promise<void> {
  const p = validateHostedPracticeEnvironment();
  if (p.version === 2) {
    await checkSupabaseIdentity(client, p);
    await checkHostedAccessContract(client, p);
    return;
  }
  const { rows: [identity] } = await client.query(`SELECT current_database() AS db,current_user AS role,
    inet_server_port() AS port,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
    has_database_privilege(current_user,current_database(),'TEMP') AS database_temp,
    d.datdba=r.oid AS database_owner,h.instance_id::text,h.project_id::text,h.environment_id::text,h.service_id::text,
    h.database_service_id::text,h.database_host,h.baseline_sha256,h.isolation_sha256,h.schema_sha256,
    m.instance_id::text AS source_instance,m.baseline_sha256 AS source_baseline,m.isolation_sha256 AS source_isolation
    FROM pg_roles r CROSS JOIN pg_database d CROSS JOIN hosted_practice.identity h CROSS JOIN synthetic_meta.identity m
    WHERE r.rolname=current_user AND d.datname=current_database()`);
  if (!identity || identity.db !== p.databaseName || identity.role !== p.databaseUser || identity.port !== p.databasePort ||
      identity.rolsuper || identity.rolcreatedb || identity.rolcreaterole || identity.rolreplication || identity.rolbypassrls ||
      identity.memberships !== 0 || identity.database_create || identity.database_temp || identity.database_owner ||
      identity.instance_id !== p.instanceId || identity.project_id !== p.projectId || identity.environment_id !== p.environmentId ||
      identity.service_id !== p.serviceId || identity.database_service_id !== p.databaseServiceId || identity.database_host !== p.databaseHost ||
      identity.baseline_sha256 !== p.baselineSha256 || identity.isolation_sha256 !== p.isolationSha256 ||
      identity.schema_sha256 !== hostedManifest.sha256 || identity.source_instance !== p.instanceId ||
      identity.source_baseline !== p.baselineSha256 || identity.source_isolation !== p.isolationSha256) throw unavailable();
  await checkHostedAccessContract(client, p);
}

/** Same least-privilege portal contract; provider checks do not waive app grants or RLS. */
export async function checkHostedAccessContract(client: PoolClient, p: HostedPracticeProfile): Promise<void> {
  const schemas = p.version === 2 ? supabaseManifest.appSchemas : railwaySchemas;
  const excludedPrincipals = p.version === 2 ? ['anon','authenticated','authenticator','service_role'] : ['anon','authenticated'];
  const policiesExpected = p.version === 2 ? [...expectedPolicies,
    { table: 'synthetic_meta.identity', name: 'hosted_app_select', command: 'r' }] : expectedPolicies;
  const { rows: [fixtures] } = await client.query(`SELECT
    (SELECT count(*)::int FROM core.users) AS core_users,
    (SELECT count(*)::int FROM epdg.users) AS epdg_users,
    EXISTS(SELECT 1 FROM core.users WHERE email NOT IN
      ('learner-a@epdg.invalid','learner-b@epdg.invalid','school-a@epdg.invalid','school-b@epdg.invalid')
      OR name NOT LIKE 'SYNTHETIC %') AS unexpected_user,
    (SELECT count(*)::int FROM core.user_branch_roles) AS branch_roles,
    EXISTS(SELECT 1 FROM core.user_branch_roles r JOIN core.branches b ON b.id=r.branch_id
      WHERE b.code<>'epdg' OR r.role_name::text NOT IN ('intern','school')) AS unexpected_role,
    (SELECT count(*)::int FROM portal_security.account_states) AS account_states,
    (SELECT count(*)::int FROM portal_security.memberships) AS memberships,
    (SELECT count(*)::int FROM epdg.admins) AS admins,
    (SELECT count(*)::int FROM epdg.companies) AS companies`);
  if (!fixtures || fixtures.core_users !== 4 || fixtures.epdg_users !== 4 || fixtures.unexpected_user ||
      fixtures.branch_roles !== 4 || fixtures.unexpected_role || fixtures.account_states !== 4 ||
      fixtures.memberships !== 4 || fixtures.admins !== 0 || fixtures.companies !== 0) throw unavailable();
  const { rows: securityLedger } = await client.query('SELECT version,sha256 FROM portal_security.schema_migrations');
  const { rows: learningLedger } = await client.query('SELECT version,sha256 FROM synthetic_learning.schema_migrations');
  const expectedLedger = p.version === 2 ? supabaseManifest.learning : [learningManifest, ...learningManifest.extensions];
  const expectedSecurity = p.version === 2 ? supabaseManifest.security : securityManifest;
  if (securityLedger.length !== 1 || securityLedger[0].version !== expectedSecurity.version || securityLedger[0].sha256 !== expectedSecurity.sha256 ||
      learningLedger.length !== expectedLedger.length || expectedLedger.some(m => !learningLedger.some(row => row.version === m.version && row.sha256 === m.sha256))) throw unavailable();
  const { rows: columns } = await client.query<{table: string; column: string; read: boolean; insert: boolean; update: boolean; forbidden: boolean; rls: boolean; owned: boolean}>(`SELECT
    n.nspname||'.'||c.relname AS table,a.attname AS column,c.relrowsecurity AS rls,c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS read,
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS insert,
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS update,
    (has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES')) AS forbidden
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`, [schemas]);
  for (const c of columns) {
    const read = readTables.includes(c.table) || c.table === 'synthetic_meta.identity';
    if (c.owned || c.forbidden || c.read !== read || c.insert !== Boolean(inserts[c.table]?.includes(c.column)) ||
        c.update !== Boolean(updates[c.table]?.includes(c.column)) ||
        ((readTables.includes(c.table) || inserts[c.table]) && !c.rls)) throw unavailable();
  }
  if (readTables.some(table => !columns.some(c => c.table === table)) ||
      Object.keys(inserts).some(table => !columns.some(c => c.table === table))) throw unavailable();
  const { rows: policies } = await client.query<{table: string; name: string; command: string; roles: string[]; permissive: boolean; using: string | null; check: string | null}>(`SELECT
    n.nspname||'.'||c.relname AS table,p.polname AS name,p.polcmd AS command,p.polpermissive AS permissive,
    ARRAY(SELECT rolname::text FROM pg_roles WHERE oid=ANY(p.polroles)) AS roles,
    pg_get_expr(p.polqual,p.polrelid) AS using,pg_get_expr(p.polwithcheck,p.polrelid) AS check
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[])`, [schemas]);
  if (policies.length !== policiesExpected.length || policiesExpected.some(expected => !policies.some(actual =>
    actual.table === expected.table && actual.name === expected.name && actual.command === expected.command && actual.permissive &&
    actual.roles.length === 1 && actual.roles[0] === p.databaseUser &&
    (expected.command === 'a' ? actual.using === null : policyExpression(actual.using)) &&
    (expected.command === 'r' ? actual.check === null : policyExpression(actual.check))))) throw unavailable();
  const { rows: [catalog] } = await client.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY($1::text[]) AND c.relkind='r' AND c.relrowsecurity) AS secured,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname=ANY($2::text[]) AND
      (has_schema_privilege(current_user,n.oid,'CREATE') OR n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))) AS schema_admin,
    EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=ANY($2::text[]) AND
      ((f.prosecdef AND n.nspname=ANY($1::text[])) OR f.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR
      (has_function_privilege(current_user,f.oid,'EXECUTE') AND f.oid NOT IN
        ('synthetic_learning.mentor_scope_allowed(uuid,uuid)'::regprocedure,'synthetic_handoff.enrollment_allowed(uuid)'::regprocedure)))) AS function_admin,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname=ANY($2::text[]) AND
      has_schema_privilege(current_user,n.oid,'USAGE')<>(n.nspname NOT IN ('public','private'))) AS schema_usage,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($2::text[])
      AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS sequence_admin,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
      WHERE n.nspname=ANY($2::text[]) AND (acl.grantee=0 OR r.rolname=ANY($3::text[]))) AS browser_table,
    EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(a.attacl) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
      WHERE n.nspname=ANY($2::text[]) AND a.attnum>0 AND NOT a.attisdropped AND (acl.grantee=0 OR r.rolname=ANY($3::text[]))) AS browser_column,
    EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
      LEFT JOIN pg_roles r ON r.oid=acl.grantee WHERE n.nspname=ANY($2::text[]) AND (acl.grantee=0 OR r.rolname=ANY($3::text[]))) AS browser_schema,
    EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
      WHERE n.nspname=ANY($2::text[]) AND (acl.grantee=0 OR r.rolname=ANY($3::text[]))) AS browser_function,
    (SELECT count(*)::int FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
      WHERE n.nspname IN ('core','epdg','public') AND k.conname='hosted_practice_email_only' AND k.contype='c' AND k.convalidated) AS email_guards`, [protectedSchemas, schemas, excludedPrincipals]);
  if (!catalog || catalog.secured !== hostedManifest.securedTables || catalog.schema_admin || catalog.schema_usage || catalog.function_admin || catalog.sequence_admin ||
      catalog.browser_table || catalog.browser_column || catalog.browser_schema || catalog.browser_function || catalog.email_guards !== (p.version === 2 ? 4 : 5)) throw unavailable();
  const { rows: guards } = await client.query<{name: string; enabled: string; schema: string; function: string; definition: string}>(`SELECT
    t.tgname AS name,t.tgenabled AS enabled,n.nspname AS schema,p.proname AS function,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname=ANY($1::text[])`, [schemas]);
  const required = ['portal_account_revision','portal_membership_revision','assignment_draft_guard','assignment_receipt_guard','assignment_attachment_guard',
    'assignment_attachment_revision','mentor_mapping_guard','mentor_review_draft_guard','mentor_review_feedback_guard','handoff_mapping_guard',
    'handoff_event_guard','handoff_nonce_guard','a_handoff_completion_guard','a_handoff_draft_guard','a_handoff_receipt_guard',
    'a_handoff_attachment_guard','a_handoff_mentor_draft_guard','a_handoff_mentor_feedback_guard','hosted_identity_immutable','hosted_capture_immutable','hosted_role_immutable'];
  if (p.version === 2) required.push('supabase_marker_immutable');
  if (guards.length !== required.length || required.some(name => !guards.some(g => g.name === name && g.enabled === 'O')) ||
      !guards.some(g => g.name === 'hosted_role_immutable' && g.schema === 'core' && g.function === 'immutable_record' &&
        /BEFORE UPDATE ON core\.user_branch_roles/.test(g.definition) && /CURRENT_USER = 'epdg_synthetic_app'::name/.test(g.definition))) throw unavailable();
}
