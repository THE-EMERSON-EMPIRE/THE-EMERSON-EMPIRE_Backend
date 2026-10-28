import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { PortalError } from '../security/primitives';
import learningManifest from '../learning/schema-manifest.json';
import { handoffConfig, handoffLock } from './config';
import { HandoffEvent, requireFreshIssuedAt } from './contract';
import { isHostedPractice } from '../hosted-practice/profile';
import { checkHostedDatabase } from '../hosted-practice/readiness';

const unavailable = () => new PortalError(503, 'Synthetic onboarding handoff is unavailable');
const conflict = () => new PortalError(409, 'Handoff conflicts with retained state');
export async function checkHandoffSchema(client: PoolClient): Promise<void> {
  if (isHostedPractice()) { await checkHostedDatabase(client); return; }
  const expected = learningManifest.extensions[learningManifest.extensions.length - 1];
  const { rows: [row] } = await client.query(`SELECT current_database() AS db,current_user AS role,
    host(inet_server_addr()) AS host,inet_server_port() AS port,identity.instance_id::text,
    (SELECT sha256 FROM synthetic_learning.schema_migrations WHERE version=$1) AS sha256,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='synthetic_handoff' AND c.relkind='r' AND c.relrowsecurity) AS secured_tables,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='synthetic_handoff' AND c.relkind='r') AS total_tables,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='synthetic_handoff') AS policies,
    has_schema_privilege(current_user,'synthetic_handoff','CREATE') AS schema_create,
    (has_any_column_privilege(current_user,'synthetic_handoff.mappings','INSERT,UPDATE') OR
      has_table_privilege(current_user,'synthetic_handoff.mappings','DELETE,TRUNCATE')) AS mapping_admin,
    (has_any_column_privilege(current_user,'synthetic_handoff.events','UPDATE') OR
      has_table_privilege(current_user,'synthetic_handoff.events','DELETE,TRUNCATE') OR
      has_column_privilege(current_user,'synthetic_handoff.events','received_at','INSERT')) AS event_admin,
    (has_any_column_privilege(current_user,'synthetic_handoff.nonces','UPDATE') OR
      has_table_privilege(current_user,'synthetic_handoff.nonces','DELETE,TRUNCATE') OR
      has_column_privilege(current_user,'synthetic_handoff.nonces','received_at','INSERT')) AS nonce_admin,
    (NOT has_table_privilege(current_user,'synthetic_handoff.mappings','SELECT') OR
      NOT has_table_privilege(current_user,'synthetic_handoff.events','SELECT') OR
      NOT has_table_privilege(current_user,'synthetic_handoff.nonces','SELECT') OR
      NOT has_function_privilege(current_user,'synthetic_handoff.enrollment_allowed(uuid)','EXECUTE') OR
      EXISTS(SELECT 1 FROM (VALUES ('events','event_id'),('events','payload_sha256'),('events','mapping_id'),('events','decision_id'),
        ('events','decision_version'),('events','decision'),('events','issued_at'),('events','policy_version'),('events','reviewer_id'),
        ('events','identity_verified'),('events','onboarding_complete'),('events','agreements_complete'),('events','hr_approved'),
        ('events','withdrawn'),('nonces','nonce'),('nonces','event_id')) required(table_name,column_name)
        WHERE NOT has_column_privilege(current_user,'synthetic_handoff.'||quote_ident(required.table_name),required.column_name,'INSERT'))) AS missing_runtime,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND t.tgenabled='O' AND
       ((n.nspname='synthetic_handoff' AND t.tgname IN ('handoff_mapping_guard','handoff_event_guard','handoff_nonce_guard')) OR
        (n.nspname='synthetic_learning' AND t.tgname IN ('a_handoff_completion_guard','a_handoff_draft_guard','a_handoff_receipt_guard',
          'a_handoff_attachment_guard','a_handoff_mentor_draft_guard','a_handoff_mentor_feedback_guard')))) AS guards,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='synthetic_handoff' AND p.prosecdef) AS definer,
    has_function_privilege(current_user,'synthetic_handoff.enrollment_allowed(uuid)','EXECUTE') AS gate_execute,
    EXISTS(SELECT 1 FROM pg_class table_object JOIN pg_namespace n ON n.oid=table_object.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(table_object.relacl,acldefault('r',table_object.relowner))) acl
      LEFT JOIN pg_roles role ON role.oid=acl.grantee WHERE n.nspname='synthetic_handoff'
        AND (acl.grantee=0 OR role.rolname IN ('anon','authenticated'))) OR
    EXISTS(SELECT 1 FROM pg_attribute column_object JOIN pg_class table_object ON table_object.oid=column_object.attrelid
      JOIN pg_namespace n ON n.oid=table_object.relnamespace CROSS JOIN LATERAL aclexplode(column_object.attacl) acl
      LEFT JOIN pg_roles role ON role.oid=acl.grantee WHERE n.nspname='synthetic_handoff'
        AND column_object.attnum>0 AND NOT column_object.attisdropped
        AND (acl.grantee=0 OR role.rolname IN ('anon','authenticated'))) OR
    EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
      LEFT JOIN pg_roles role ON role.oid=acl.grantee WHERE n.nspname='synthetic_handoff'
        AND (acl.grantee=0 OR role.rolname IN ('anon','authenticated'))) OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles role ON role.oid=acl.grantee WHERE n.nspname='synthetic_handoff'
        AND (acl.grantee=0 OR role.rolname IN ('anon','authenticated'))) AS browser_grants,
    EXISTS(SELECT 1 FROM information_schema.role_column_grants WHERE table_schema='synthetic_handoff' AND grantee=current_user
      AND privilege_type='INSERT' AND ((table_name='events' AND column_name NOT IN
        ('event_id','payload_sha256','mapping_id','decision_id','decision_version','decision','issued_at','policy_version','reviewer_id',
          'identity_verified','onboarding_complete','agreements_complete','hr_approved','withdrawn')) OR
        (table_name='nonces' AND column_name NOT IN ('nonce','event_id')) OR table_name='mappings')) AS unexpected_insert
    FROM synthetic_meta.identity identity`, [expected.version]);
  if (!row || row.db !== 'epdg_synthetic' || row.role !== 'epdg_synthetic_app' || row.host !== '127.0.0.1' || row.port !== 55432 ||
      row.instance_id !== process.env.SYNTHETIC_INSTANCE_ID || row.sha256 !== expected.sha256 || row.secured_tables !== 3 || row.total_tables !== 3 ||
      row.policies !== 0 || row.schema_create || row.mapping_admin || row.event_admin || row.nonce_admin || row.missing_runtime ||
      row.guards !== 9 || row.definer || !row.gate_execute || row.browser_grants || row.unexpected_insert) throw unavailable();
}

interface CurrentEvent { decision: 'cleared' | 'held' | 'revoked'; withdrawn: boolean; decision_version: number; received_at: Date }
const status = (row: CurrentEvent) => row.decision === 'revoked' || row.withdrawn ? 'withdrawn' as const
  : row.decision === 'cleared' ? 'ready' as const : 'held' as const;

/** Only append validated decisions; account, membership and enrollment rows are never written. */
export class HandoffService {
  constructor(private readonly connect: () => Promise<PoolClient> = () => getPool().connect()) {}

  async receive(event: HandoffEvent, digest: string, nonce: string) {
    const config = handoffConfig(); config.key.fill(0);
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('synthetic_handoff.enabled','on',true)");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [handoffLock]);
      await checkHandoffSchema(client);
      const { rows: [existing] } = await client.query<{payload_sha256: string; mapping_id: string}>(
        'SELECT payload_sha256,mapping_id FROM synthetic_handoff.events WHERE event_id=$1', [event.event_id]);
      if (existing && existing.payload_sha256 !== digest) throw conflict();
      const { rows: [mapping] } = await client.query<{id: string}>(`SELECT mapping.id FROM synthetic_handoff.mappings mapping
        JOIN synthetic_learning.enrollments e ON e.id=mapping.enrollment_id AND e.user_id=mapping.user_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id AND p.school_id=e.school_id
        JOIN portal_security.memberships membership ON membership.id=e.membership_id AND membership.user_id=e.user_id
        JOIN portal_security.account_states account ON account.user_id=e.user_id
        JOIN core.users u ON u.id=e.user_id JOIN epdg.users eu ON eu.id=u.id
        JOIN epdg.intern_profiles intern ON intern.user_id=u.id AND intern.school_id=e.school_id
        JOIN epdg.schools school ON school.id=e.school_id
        WHERE mapping.person_id=$1 AND mapping.application_id=$2 AND mapping.crm_program_id=$3
          AND e.active AND membership.active AND membership.school_id=e.school_id AND account.active
          AND u.email='learner-b@epdg.invalid' AND u.name LIKE 'SYNTHETIC %' AND u.deleted_at IS NULL AND u.is_verified
          AND eu.deleted_at IS NULL AND eu.is_verified AND eu.rejection_reason IS NULL
          AND intern.is_approved AND intern.rejection_reason IS NULL AND school.is_approved AND school.deleted_at IS NULL
          AND p.title LIKE 'SYNTHETIC %'
          AND EXISTS(SELECT 1 FROM core.user_branch_roles role JOIN core.branches branch ON branch.id=role.branch_id
            WHERE role.user_id=u.id AND branch.code='epdg' AND role.role_name::text='intern' AND role.rejection_reason IS NULL)`,
      [event.person_id, event.application_id, event.program_id]);
      if (!mapping || (existing && existing.mapping_id !== mapping.id)) throw new PortalError(404, 'Synthetic handoff mapping not found');
      if ((await client.query('SELECT 1 FROM synthetic_handoff.nonces WHERE nonce=$1', [nonce])).rows.length) throw conflict();
      if (!existing) {
        requireFreshIssuedAt(event);
        const { rows: [latest] } = await client.query<{decision_version: number}>(
          'SELECT decision_version FROM synthetic_handoff.events WHERE mapping_id=$1 ORDER BY decision_version DESC LIMIT 1', [mapping.id]);
        if (latest && latest.decision_version >= event.decision_version) throw conflict();
        const c = event.clearance;
        await client.query(`INSERT INTO synthetic_handoff.events(event_id,payload_sha256,mapping_id,decision_id,decision_version,
          decision,issued_at,policy_version,reviewer_id,identity_verified,onboarding_complete,agreements_complete,hr_approved,withdrawn)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [event.event_id, digest, mapping.id, event.decision_id, event.decision_version, event.decision, event.issued_at,
          event.policy_version, event.reviewer_id, c.identity_verified, c.onboarding_complete, c.agreements_complete, c.hr_approved, event.withdrawn]);
      }
      await client.query('INSERT INTO synthetic_handoff.nonces(nonce,event_id) VALUES($1,$2)', [nonce, event.event_id]);
      const { rows: [current] } = await client.query<CurrentEvent>(`SELECT decision,withdrawn,decision_version,received_at
        FROM synthetic_handoff.events WHERE mapping_id=$1 ORDER BY decision_version DESC LIMIT 1`, [mapping.id]);
      if (!current) throw unavailable();
      const result = { success: true as const, environment: config.hosted ? 'synthetic-hosted' as const : 'synthetic-local' as const, event_id: event.event_id,
        result: existing ? 'duplicate' as const : 'accepted' as const, received_at: current.received_at.toISOString(),
        current_status: status(current), decision_version: current.decision_version };
      await client.query('COMMIT'); return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (['23505', '23514', '23503'].includes(String((error as {code?: unknown})?.code))) throw conflict();
      throw error;
    } finally { client.release(); }
  }
}
