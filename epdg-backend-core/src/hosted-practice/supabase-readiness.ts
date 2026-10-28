import type { PoolClient } from 'pg';
import { PortalError } from '../security/primitives';
import type { SupabasePracticeProfile } from './profile';
import manifest from './supabase-schema-manifest.json';

const managedSchemas = ['auth','extensions','graphql','graphql_public','pgbouncer','public','realtime','storage','vault'];
const unavailable = () => new PortalError(503, 'Hosted practice is unavailable');

/** App-only isolation on managed Postgres. Never modifies provider-owned objects. */
export async function checkSupabaseIdentity(client: PoolClient, p: SupabasePracticeProfile): Promise<void> {
  const { rows: identities } = await client.query(`SELECT current_database() AS db,current_user AS role,
    inet_server_port() AS port,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit,r.rolcanlogin,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
    has_database_privilege(current_user,current_database(),'TEMP') AS database_temp,
    d.datdba=r.oid AS database_owner,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
    current_setting('search_path') AS search_path,h.instance_id::text,h.project_id::text,h.environment_id::text,
    h.service_id::text,h.supabase_project_ref,h.supabase_organization_id,h.database_host,
    h.baseline_sha256,h.isolation_sha256,h.schema_sha256,
    m.instance_id::text AS source_instance,m.provider AS source_provider,m.supabase_project_ref AS source_project_ref,
    m.baseline_sha256 AS source_baseline,m.isolation_sha256 AS source_isolation
    FROM pg_roles r CROSS JOIN pg_database d CROSS JOIN hosted_practice.identity h CROSS JOIN synthetic_meta.identity m
    WHERE r.rolname=current_user AND d.datname=current_database()`);
  const [identity] = identities;
  if (identities.length !== 1 || !identity || identity.db !== 'postgres' || identity.role !== p.databaseUser || identity.port !== 5432 ||
      identity.rolsuper || identity.rolcreatedb || identity.rolcreaterole || identity.rolreplication || identity.rolbypassrls ||
      identity.rolinherit || identity.rolcanlogin !== true ||
      identity.memberships !== 0 || identity.database_create || identity.database_temp !== true || identity.database_owner ||
      identity.tls !== true || identity.search_path.replace(/\s/g, '') !== 'pg_catalog,epdg,pg_temp' ||
      identity.instance_id !== p.instanceId || identity.project_id !== p.projectId || identity.environment_id !== p.environmentId ||
      identity.service_id !== p.serviceId || identity.supabase_project_ref !== p.supabaseProjectRef ||
      identity.supabase_organization_id !== p.supabaseOrganizationId || identity.database_host !== p.databaseHost ||
      identity.baseline_sha256 !== p.baselineSha256 || identity.isolation_sha256 !== p.isolationSha256 ||
      identity.schema_sha256 !== manifest.hosted.sha256 || identity.source_instance !== p.instanceId ||
      identity.source_provider !== 'supabase' || identity.source_project_ref !== p.supabaseProjectRef ||
      identity.source_baseline !== p.baselineSha256 || identity.source_isolation !== p.isolationSha256) throw unavailable();

  const { rows: [catalog] } = await client.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY($1::text[]) AND c.relkind='r') AS app_tables,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY($1::text[]) AND c.relkind='r' AND c.relrowsecurity) AS app_rls,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname=ANY($1::text[]) AND
      n.nspowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')) AS app_owner_drift,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[])
      AND c.relowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')) AS app_relation_owner_drift,
    EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=ANY($1::text[])
      AND f.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')) AS app_function_owner_drift,
    EXISTS(SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass
      AND d.refobjid=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND d.deptype='o'
      AND CASE WHEN d.dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) THEN
        NOT EXISTS(SELECT 1 FROM pg_identify_object(d.classid,d.objid,d.objsubid) object
          JOIN pg_namespace temp ON temp.nspname=CASE WHEN object.type='schema' THEN object.name ELSE object.schema END
          WHERE temp.oid=pg_my_temp_schema() OR pg_is_other_temp_schema(temp.oid))
      ELSE true END) AS durable_owner,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_(toast(_temp_[0-9]+)?|temp_[0-9]+)$'
      AND n.nspname<>ALL($1::text[]) AND n.nspname<>ALL($2::text[])) AS unknown_namespace,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname=ANY($2::text[]) AND has_schema_privilege(current_user,n.oid,'CREATE')) AS managed_create,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY($2::text[]) AND has_schema_privilege(current_user,n.oid,'USAGE') AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
      has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ELSE false END) AS managed_table,
    EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY($2::text[]) AND has_schema_privilege(current_user,n.oid,'USAGE') AND a.attnum>0 AND NOT a.attisdropped AND
      CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END) AS managed_column,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($2::text[])
      AND has_schema_privilege(current_user,n.oid,'USAGE') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS managed_sequence,
    EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=ANY($2::text[])
      AND has_schema_privilege(current_user,n.oid,'USAGE') AND f.prosecdef AND has_function_privilege(current_user,f.oid,'EXECUTE')) AS managed_definer,
    EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname=ANY($3::text[]) AND n.nspname=ANY($1::text[]) AND
      (has_schema_privilege(r.oid,n.oid,'USAGE,CREATE') OR
       EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
         (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
          has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) ELSE false END) OR
       EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) OR
       EXISTS(SELECT 1 FROM pg_proc f WHERE f.pronamespace=n.oid AND has_function_privilege(r.oid,f.oid,'EXECUTE')) OR
       EXISTS(SELECT 1 FROM pg_type t WHERE t.typnamespace=n.oid AND t.typtype='e' AND has_type_privilege(r.oid,t.oid,'USAGE')))) AS browser_effective,
    md5(string_agg(n.nspname||':'||pg_get_userbyid(n.nspowner)||':'||coalesce(n.nspacl::text,''),E'\n' ORDER BY n.nspname)) AS managed_schema_acl
    FROM pg_namespace n WHERE n.nspname=ANY($2::text[])`, [manifest.appSchemas, managedSchemas, ['anon','authenticated','authenticator','service_role']]);
  if (!catalog || catalog.app_tables !== manifest.appTables || catalog.app_rls !== manifest.appTables || catalog.app_owner_drift ||
      catalog.app_relation_owner_drift || catalog.app_function_owner_drift || catalog.durable_owner || catalog.unknown_namespace || catalog.managed_create ||
      catalog.managed_table || catalog.managed_column || catalog.managed_sequence || catalog.managed_definer || catalog.browser_effective ||
      catalog.managed_schema_acl !== p.managedSchemaAclMd5) throw unavailable();
}
