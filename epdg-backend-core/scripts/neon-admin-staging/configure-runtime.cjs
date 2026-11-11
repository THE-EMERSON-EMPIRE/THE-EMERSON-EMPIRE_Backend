'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const profile = require('../../src/neon-admin-staging/profile.json');
const migrate = require('./migrate.cjs');

const tables = [
  ['core','branches'], ['core','users'], ['core','user_branch_roles'],
  ['epdg','users'], ['epdg','admins'], ['epdg','schools'], ['epdg','companies'], ['epdg','intern_profiles'],
  ['portal_security','schema_migrations'], ['portal_security','account_states'], ['portal_security','memberships'],
  ['portal_security','sessions'], ['portal_security','recovery_tokens'], ['portal_security','audit_events'],
  ['portal_security','role_assignments'], ['portal_security','admin_events'],
];

async function configure() {
  const connectionString = migrate.strictTlsConnectionString(migrate.requireTarget());
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  let client;
  try {
    client = await pool.connect();
    await migrate.identity?.(client);
    const { rows: [role] } = await client.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
      has_schema_privilege($1,'core','CREATE') AS core_create,
      has_schema_privilege($1,'epdg','CREATE') AS epdg_create,
      has_schema_privilege($1,'portal_security','CREATE') AS security_create,
      has_database_privilege($1,current_database(),'CREATE') AS database_create,
      (SELECT count(*)::int FROM pg_auth_members am JOIN pg_roles elevated ON elevated.oid=am.roleid
        WHERE am.member=r.oid AND elevated.rolname IN ('neon_superuser','pg_read_all_data','pg_write_all_data','pg_execute_server_program'))
        AS elevated_memberships
      FROM pg_roles r WHERE r.rolname=$1`, [profile.runtimeRole]);
    assert.ok(role, 'Pinned runtime role must be created through the Neon role workflow first');
    for (const key of ['rolsuper','rolcreatedb','rolcreaterole','rolbypassrls','core_create','epdg_create','security_create','database_create']) {
      assert.equal(role[key], false, `Runtime role has forbidden privilege ${key}`);
    }
    assert.equal(role.elevated_memberships, 0, 'Runtime role must not inherit a privileged PostgreSQL role');

    await client.query('BEGIN');
    try {
    for (const [schema, table] of tables) {
      const qualified = `${schema}.${table}`;
      const { rows } = await client.query(`SELECT c.relrowsecurity AS rls FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind='r'`, [schema, table]);
      assert.equal(rows.length, 1, `Required staging table ${qualified} is missing`);
      assert.equal(rows[0].rls, true, `Row-level security is not enabled on ${qualified}`);
      const policyName = `epdg_admin_runtime_${schema}_${table}`;
      const { rows: policies } = await client.query(`SELECT cmd AS polcmd,permissive AS polpermissive,
        qual AS polqual,with_check AS polwithcheck,roles::text
        FROM pg_policies WHERE schemaname=$1 AND tablename=$2 AND policyname=$3`, [schema, table, policyName]);
      if (policies.length === 0) {
        await client.query(`CREATE POLICY ${policyName} ON ${qualified} AS PERMISSIVE FOR ALL
          TO epdg_portal_runtime USING (true) WITH CHECK (true)`);
      } else {
        assert.equal(policies.length, 1, `Unexpected policies named ${policyName}`);
        assert.equal(policies[0].polcmd, '*');
        assert.equal(policies[0].polpermissive, true);
        assert.equal(policies[0].polqual, 'true');
        assert.equal(policies[0].polwithcheck, 'true');
        assert.equal(policies[0].roles, `{${profile.runtimeRole}}`);
      }
    }

    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA core,epdg,portal_security FROM epdg_portal_runtime;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA core,epdg,portal_security FROM epdg_portal_runtime;
      REVOKE ALL ON SCHEMA public FROM epdg_portal_runtime;
      GRANT USAGE ON SCHEMA core,epdg,portal_security TO epdg_portal_runtime;
      GRANT SELECT ON core.branches,core.users,core.user_branch_roles TO epdg_portal_runtime;
      GRANT UPDATE(last_login_at) ON core.users TO epdg_portal_runtime;
      GRANT UPDATE(rejection_reason) ON core.user_branch_roles TO epdg_portal_runtime;
      GRANT SELECT ON epdg.users,epdg.admins,epdg.schools,epdg.companies,epdg.intern_profiles TO epdg_portal_runtime;
      GRANT UPDATE(last_login_at) ON epdg.users TO epdg_portal_runtime;
      GRANT SELECT ON portal_security.schema_migrations,portal_security.account_states,portal_security.memberships TO epdg_portal_runtime;
      GRANT UPDATE(revision) ON portal_security.account_states TO epdg_portal_runtime;
      GRANT SELECT,INSERT,UPDATE ON portal_security.sessions TO epdg_portal_runtime;
      GRANT INSERT ON portal_security.audit_events TO epdg_portal_runtime;
      GRANT SELECT,INSERT ON portal_security.role_assignments,portal_security.admin_events TO epdg_portal_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE epdg_portal_migrator IN SCHEMA core REVOKE ALL ON TABLES FROM epdg_portal_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE epdg_portal_migrator IN SCHEMA epdg REVOKE ALL ON TABLES FROM epdg_portal_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE epdg_portal_migrator IN SCHEMA portal_security REVOKE ALL ON TABLES FROM epdg_portal_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE epdg_portal_migrator IN SCHEMA core REVOKE ALL ON SEQUENCES FROM epdg_portal_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE epdg_portal_migrator IN SCHEMA epdg REVOKE ALL ON SEQUENCES FROM epdg_portal_runtime;
      ALTER DEFAULT PRIVILEGES FOR ROLE epdg_portal_migrator IN SCHEMA portal_security REVOKE ALL ON SEQUENCES FROM epdg_portal_runtime;`);

    const { rows: [checks] } = await client.query(`SELECT
      has_table_privilege($1,'core.users','SELECT') AS can_read_users,
      has_table_privilege($1,'core.users','DELETE') AS can_delete_users,
      has_column_privilege($1,'core.users','password','UPDATE') AS can_change_identity_password,
      has_column_privilege($1,'portal_security.account_states','active','UPDATE') AS can_activate_accounts,
      (has_table_privilege($1,'portal_security.role_assignments','SELECT') AND
        has_table_privilege($1,'portal_security.role_assignments','INSERT')) AS can_request_roles,
      (has_table_privilege($1,'portal_security.admin_events','SELECT') AND
        has_table_privilege($1,'portal_security.admin_events','INSERT')) AS can_audit_admin,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname=ANY($2::text[])
        AND 'public'::name=ANY(roles)) AS public_policies`, [profile.runtimeRole, ['core','epdg','portal_security']]);
    assert.equal(checks.can_read_users, true);
    assert.equal(checks.can_delete_users, false);
    assert.equal(checks.can_change_identity_password, false);
    assert.equal(checks.can_activate_accounts, false);
    assert.equal(checks.can_request_roles, true);
    assert.equal(checks.can_audit_admin, true);
    assert.equal(checks.public_policies, 0);
    await client.query('COMMIT');
    console.log(JSON.stringify({ projectId: profile.projectId, branchId: profile.branchId,
      runtimeRole: profile.runtimeRole, rowLevelSecurityTables: tables.length,
      canDeleteUsers: false, canChangePasswords: false, canActivateAccounts: false,
      roleRequestsRemainPending: true, publicPolicies: 0 }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

module.exports = { configure, tables };

if (require.main === module) configure().catch(error => {
  console.error(`Neon administrator staging runtime configuration failed (${error?.name || 'Error'}); no credentials were printed.`);
  process.exitCode = 1;
});
