import type { PoolClient } from 'pg';
import { accountManagementEnabled, accountReleaseConfig, assertAccountRelease } from '../security/accountReleaseConfig';
import { hashToken, PortalError } from '../security/primitives';
import manifest from './portable-schema-manifest.json';

/** Identifiers come only from these two constants, never from request data. */
export const learningSchema = (): 'portal_learning' | 'synthetic_learning' => accountManagementEnabled() ? 'portal_learning' : 'synthetic_learning';
export const learningEnvironment = (): 'portal-release-candidate' | 'synthetic-local' => accountManagementEnabled() && !accountReleaseConfig().synthetic ? 'portal-release-candidate' : 'synthetic-local';
export const portableLearning = accountManagementEnabled;

export async function checkPortableLearningSchema(client: PoolClient): Promise<void> {
  await assertAccountRelease(client);
  const { rows: [row] } = await client.query<{version: string; sha256: string; restricted: boolean; secured: number;
    policies: number; guards: number; excessive_grants: boolean; public_execution: boolean}>(`SELECT m.version,m.sha256,
    NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb
      AND NOT has_schema_privilege(current_user,'portal_learning','CREATE')
      AND NOT has_any_column_privilege(current_user,'portal_learning.enrollments','INSERT,UPDATE')
      AND NOT has_any_column_privilege(current_user,'portal_learning.mentor_assignments','INSERT,UPDATE') AS restricted,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='portal_learning' AND c.relkind='r' AND c.relrowsecurity) AS secured,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='portal_learning') AS policies,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='portal_learning' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgname IN
        ('assignment_draft_guard','assignment_receipt_guard','assignment_attachment_guard','assignment_attachment_revision',
         'mentor_review_draft_guard','mentor_review_feedback_guard')) AS guards,
    (EXISTS(SELECT 1 FROM pg_tables t JOIN pg_roles owner ON owner.rolname=t.tableowner WHERE t.schemaname='portal_learning'
      AND (pg_has_role(current_user,owner.oid,'USAGE')
        OR has_table_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'DELETE,TRUNCATE')
        OR (t.tablename NOT IN ('completions','assignment_drafts','assignment_receipts','assignment_attachments','mentor_review_drafts','mentor_review_feedback')
          AND has_any_column_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT,UPDATE'))))
      OR has_any_column_privilege(current_user,'portal_learning.assignment_receipts','UPDATE')
      OR has_any_column_privilege(current_user,'portal_learning.mentor_review_feedback','UPDATE')
      OR EXISTS(SELECT 1 FROM information_schema.column_privileges c WHERE c.grantee=current_user AND c.table_schema='portal_learning'
        AND ((c.privilege_type='UPDATE' AND ((c.table_name='assignment_drafts' AND c.column_name NOT IN ('answer','revision','attempt_number','previous_receipt_id'))
          OR (c.table_name='assignment_attachments' AND c.column_name<>'removed')
          OR (c.table_name='mentor_review_drafts' AND c.column_name NOT IN ('comment','revision')) OR c.table_name='completions'))
        OR (c.privilege_type='INSERT' AND ((c.table_name IN ('assignment_drafts','assignment_receipts') AND c.column_name NOT IN ('enrollment_id','program_id','item_id','answer','revision'))
          OR (c.table_name='assignment_attachments' AND c.column_name NOT IN ('enrollment_id','program_id','item_id','filename','media_type','bytes'))
          OR (c.table_name IN ('mentor_review_drafts','mentor_review_feedback') AND c.column_name NOT IN ('assignment_id','receipt_id','comment','revision'))
          OR (c.table_name='completions' AND c.column_name NOT IN ('enrollment_id','program_id','item_id'))))))) AS excessive_grants,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE n.nspname='portal_learning' AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execution
    FROM portal_learning.schema_migrations m JOIN pg_roles r ON r.rolname=current_user WHERE m.version=$1`, [manifest.version]);
  if (!row || row.sha256 !== manifest.sha256 || !row.restricted || row.secured !== manifest.secured_tables
      || row.policies !== 22 || row.guards !== 6 || row.excessive_grants || row.public_execution) {
    throw new PortalError(503, 'Learner programs are unavailable pending schema verification');
  }
}

/** Bind the database RLS actor to an opaque, current authenticated session. */
export async function configurePortableLearning(client: PoolClient, raw: string): Promise<void> {
  await checkPortableLearningSchema(client);
  await client.query("SELECT set_config('portal_learning.session_hash',$1,true)", [hashToken(raw)]);
}

export async function portableOnboarding(client: PoolClient, learnerId: number) {
  const { rows: [row] } = await client.query<{program_id: string; program_title: string; updated_at: Date}>(`SELECT
    p.id AS program_id,p.title AS program_title,e.created_at AS updated_at
    FROM portal_learning.enrollments e JOIN portal_learning.programs p ON p.id=e.program_id
    WHERE e.user_id=$1 AND portal_learning.enrollment_allowed(e.id) ORDER BY e.created_at DESC,e.id LIMIT 1`, [learnerId]);
  return { success: true as const, environment: learningEnvironment(), learner_id: learnerId,
    generated_at: new Date().toISOString(), privileged_controls_available: false as const,
    onboarding: row ? { status: 'ready' as const, program_id: row.program_id, program_title: row.program_title, updated_at: row.updated_at.toISOString() }
      : { status: 'not_received' as const, program_id: null, program_title: null, updated_at: null } };
}
