'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const net = require('node:net');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const profile = require('../../src/neon-admin-staging/profile.json');
const migrate = require('./migrate.cjs');

const fixtures = [
  { email: 'founder-admin@epdg.invalid', name: 'SYNTHETIC Founder Administrator', role: 'admin', founder: true },
  { email: 'webdev-candidate@epdg.invalid', name: 'SYNTHETIC WebDev Candidate', role: 'intern', founder: false },
];

function connectionUrl(name, role) {
  assert.equal(process.env.NEON_ADMIN_STAGING_PROJECT_ID, profile.projectId, 'Unexpected Neon project');
  assert.equal(process.env.NEON_ADMIN_STAGING_BRANCH_ID, profile.branchId, 'Unexpected Neon branch');
  const raw = process.env[name];
  assert.ok(raw && raw.length < 2048, `A bounded ${role} connection URL is required`);
  const url = new URL(raw);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, profile.databaseHost, 'Connection URL is not pinned to the staging compute');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), profile.databaseName, 'Connection URL targets another database');
  assert.equal(decodeURIComponent(url.username), role, 'Connection URL has an unexpected role');
  assert.equal(url.port || '5432', '5432');
  return { url, raw };
}

async function seedSyntheticFixtures() {
  const { raw } = connectionUrl('NEON_ADMIN_STAGING_MIGRATOR_DATABASE_URL', profile.migratorRole);
  const pool = new Pool({ connectionString: migrate.strictTlsConnectionString(raw), ssl: { rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const password = crypto.randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    const { rows: [identity] } = await client.query(`SELECT current_database() AS database_name,current_user AS role_name,
      r.rolsuper FROM pg_roles r WHERE r.rolname=current_user`);
    assert.equal(identity.database_name, profile.databaseName);
    assert.equal(identity.role_name, profile.migratorRole);
    assert.equal(identity.rolsuper, false);
    assert.equal(client.connection.stream?.encrypted, true, 'Neon client transport did not negotiate TLS');
    assert.equal(client.connection.stream?.authorized, true, 'Neon TLS certificate was not verified');
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('epdg-neon-admin-staging-fixtures-v1'))");
      const { rows: users } = await client.query('SELECT id,email,name FROM core.users ORDER BY email');
      if (users.length === 0) {
        const { rows: others } = await client.query(`SELECT
          (SELECT count(*)::int FROM epdg.users) AS epdg_users,
          (SELECT count(*)::int FROM portal_security.account_states) AS states,
          (SELECT count(*)::int FROM portal_security.memberships) AS memberships,
          (SELECT count(*)::int FROM epdg.schools) AS schools,
          (SELECT count(*)::int FROM epdg.companies) AS companies,
          (SELECT count(*)::int FROM epdg.intern_profiles) AS learners`);
        assert.deepEqual(Object.values(others[0]), [0,0,0,0,0,0], 'The empty fixture seed requires empty identity tables');
        await client.query("INSERT INTO core.branches(code,name) VALUES('epdg','EPDG isolated administrator staging')");
        for (const fixture of fixtures) {
          const { rows: [coreUser] } = await client.query(`INSERT INTO core.users(email,name,password,is_verified)
            VALUES($1,$2,$3,true) RETURNING id`, [fixture.email, fixture.name, passwordHash]);
          await client.query(`INSERT INTO epdg.users(id,email,name,password,role,is_verified)
            VALUES($1,$2,$3,$4,$5,true)`, [coreUser.id, fixture.email, fixture.name, passwordHash, fixture.role]);
          await client.query(`INSERT INTO core.user_branch_roles(user_id,branch_id,role_name,admin_role)
            SELECT $1,id,$2,$3 FROM core.branches WHERE code='epdg'`,
          [coreUser.id, fixture.role, fixture.founder ? 'admin' : null]);
          await client.query('INSERT INTO portal_security.account_states(user_id,active) VALUES($1,true)', [coreUser.id]);
          if (fixture.founder) {
            await client.query("INSERT INTO epdg.admins(user_id,admin_role,force_password_change) VALUES($1,'admin',false)", [coreUser.id]);
            await client.query(`INSERT INTO portal_security.role_assignments(user_id,role_code,status,assigned_by_user_id)
              VALUES($1,'founder_admin','active',$1)`, [coreUser.id]);
          }
        }
      } else {
        assert.equal(users.length, fixtures.length, 'Only the two approved synthetic staging identities may exist');
        for (let i = 0; i < fixtures.length; i++) {
          assert.equal(users[i].email, fixtures[i].email);
          assert.equal(users[i].name, fixtures[i].name);
          await client.query('UPDATE core.users SET password=$1 WHERE id=$2', [passwordHash, users[i].id]);
          await client.query('UPDATE epdg.users SET password=$1 WHERE id=$2', [passwordHash, users[i].id]);
          await client.query('UPDATE portal_security.account_states SET revision=revision+1 WHERE user_id=$1', [users[i].id]);
          await client.query(`UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed'
            WHERE user_id=$1 AND revoked_at IS NULL`, [users[i].id]);
        }
        const { rows: [adminRole] } = await client.query(`SELECT count(*)::int AS count
          FROM portal_security.role_assignments WHERE user_id=$1 AND role_code='founder_admin' AND status='active'`, [users[0].id]);
        assert.equal(adminRole.count, 1, 'The synthetic founder fixture must retain its staging-only role');
      }
      const { rows: [emptyOwnedData] } = await client.query(`SELECT
        (SELECT count(*)::int FROM portal_security.memberships) AS memberships,
        (SELECT count(*)::int FROM epdg.schools) AS schools,
        (SELECT count(*)::int FROM epdg.companies) AS companies,
        (SELECT count(*)::int FROM epdg.intern_profiles) AS learner_profiles`);
      assert.deepEqual(Object.values(emptyOwnedData), [0,0,0,0], 'Applicant, organization, and learner data must be absent');
      const { rows: allUsers } = await client.query(`SELECT email,name FROM core.users
        WHERE email NOT LIKE '%@epdg.invalid' OR name NOT LIKE 'SYNTHETIC %'`);
      assert.equal(allUsers.length, 0, 'Real identities are forbidden in the synthetic staging database');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { client.release(); await pool.end(); }
  return password;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function configureRuntime() {
  const { url } = connectionUrl('NEON_ADMIN_STAGING_RUNTIME_DATABASE_URL', profile.runtimeRole);
  process.env.NODE_ENV = 'test';
  process.env.EPDG_NEON_ADMIN_STAGING_MODE = '1';
  process.env.EPDG_SYNTHETIC_MODE = '1';
  process.env.EPDG_ADMIN_STAGING_MODE = '1';
  process.env.NEON_ADMIN_STAGING_PROJECT_ID = profile.projectId;
  process.env.NEON_ADMIN_STAGING_BRANCH_ID = profile.branchId;
  process.env.DB_HOST = url.hostname;
  process.env.DB_PORT = url.port || '5432';
  process.env.DB_NAME = decodeURIComponent(url.pathname.slice(1));
  process.env.DB_USER = decodeURIComponent(url.username);
  process.env.DB_PASSWORD = decodeURIComponent(url.password);
  process.env.DB_SSL = 'true';
  process.env.SESSION_CSRF_SECRET = crypto.randomBytes(48).toString('base64url');
  for (const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','SUPABASE_DB_CA_CERT',
    'RESEND_API_KEY','DATABASE_URL','DATABASE_PUBLIC_URL','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD',
    'JWT_SECRET','CERT_SIGNING_SECRET','FRONTEND_URL','MAIL_DELIVERY_MODE']) delete process.env[name];
}

async function verify() {
  const founderPassword = await seedSyntheticFixtures();
  configureRuntime();
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  process.env.PORTAL_ORIGIN = origin;
  process.env.CORS_ORIGINS = origin;
  process.env.PORT = String(port);
  const { validateEnvironment } = require('../../dist/config/env.js');
  const { testConnection, getPool } = require('../../dist/db/index.js');
  const { checkSecuritySchema } = require('../../dist/security/PortalService.js');
  const { createAdminStagingApp } = require('../../dist/adminStagingApp.js');
  validateEnvironment();
  await testConnection();
  await checkSecuritySchema();
  const app = createAdminStagingApp({ readinessCheck: async () => { await testConnection(); await checkSecuritySchema(); } });
  const server = app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const url = `${origin}/api`;
  const requestHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-EPDG-Request': 'portal', 'Content-Type': 'application/json' };
  let cookie = '';
  let csrf = '';
  let logout = false;
  const checks = [];
  try {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200, 'Readiness endpoint must confirm verified database access');
    checks.push('TLS database readiness');

    const unauthenticated = await fetch(`${url}/admin/overview`);
    assert.equal(unauthenticated.status, 401, 'Unauthenticated administrator access must be denied');
    checks.push('unauthenticated denial');

    const userDenied = await fetch(`${url}/auth/login`, { method: 'POST', headers: requestHeaders,
      body: JSON.stringify({ email: fixtures[1].email, password: founderPassword }) });
    assert.equal(userDenied.status, 401, 'A synthetic user without an active portal admin role must not sign in');
    checks.push('unassigned synthetic account denial');

    const login = await fetch(`${url}/auth/login`, { method: 'POST', headers: requestHeaders,
      body: JSON.stringify({ email: fixtures[0].email, password: founderPassword }) });
    assert.equal(login.status, 200, 'Synthetic founder staging account must authenticate');
    const loginBody = await login.json();
    assert.equal(loginBody.user.email, fixtures[0].email);
    assert.deepEqual(loginBody.user.portal_roles, ['founder_admin']);
    assert.ok(login.headers.get('set-cookie')?.toLowerCase().includes('httponly'));
    assert.ok(login.headers.get('set-cookie')?.toLowerCase().includes('samesite=strict'));
    cookie = login.headers.get('set-cookie').split(';', 1)[0];
    csrf = loginBody.csrf_token;
    checks.push('cookie-backed synthetic login');

    const restored = await fetch(`${url}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(restored.status, 200, 'The session must restore from its HttpOnly cookie');
    checks.push('session restoration');

    const overview = await fetch(`${url}/admin/overview`, { headers: { Cookie: cookie } });
    assert.equal(overview.status, 200, 'Founder role must read its staging overview');
    const overviewData = (await overview.json()).data;
    assert.equal(overviewData.environment, 'isolated-synthetic');
    assert.equal(overviewData.accounts.total, 2);
    checks.push('authorized administrator query');

    const users = await fetch(`${url}/admin/users`, { headers: { Cookie: cookie } });
    assert.equal(users.status, 200);
    const userItems = (await users.json()).data.items;
    assert.equal(userItems.length, 2);
    assert.ok(userItems.every(item => item.name.startsWith('SYNTHETIC ') && item.email.endsWith('@epdg.invalid')));
    checks.push('synthetic identity boundary');

    const csrfDenied = await fetch(`${url}/admin/role-requests`, { method: 'POST', headers: requestHeaders,
      body: JSON.stringify({ target_user_id: 2, role_code: 'webdev_technical' }),
      headers: { ...requestHeaders, Cookie: cookie } });
    assert.equal(csrfDenied.status, 403, 'State-changing requests must require the session CSRF token');
    checks.push('CSRF denial');

    const before = await getPool().query(`SELECT count(*)::int AS count FROM portal_security.role_assignments
      WHERE user_id=2 AND role_code='webdev_technical' AND status IN ('pending','active')`);
    const requestRole = await fetch(`${url}/admin/role-requests`, { method: 'POST',
      headers: { ...requestHeaders, Cookie: cookie, 'X-CSRF-Token': loginBody.csrf_token },
      body: JSON.stringify({ target_user_id: 2, role_code: 'webdev_technical' }) });
    if (before.rows[0].count === 0) {
      assert.equal(requestRole.status, 200, 'A permitted WebDev request should be recorded');
      const result = (await requestRole.json()).data;
      assert.equal(result.assignment.status, 'pending');
      assert.equal(result.permissions_granted, false);
    } else {
      assert.equal(requestRole.status, 409, 'A duplicate WebDev request must be denied');
    }
    const roleState = await getPool().query(`SELECT count(*) FILTER (WHERE role_code='webdev_technical' AND status='pending')::int AS pending,
      count(*) FILTER (WHERE role_code='webdev_technical' AND status='active')::int AS active
      FROM portal_security.role_assignments WHERE user_id=2`);
    assert.equal(roleState.rows[0].pending, 1);
    assert.equal(roleState.rows[0].active, 0);
    checks.push('pending-only WebDev request');

    const learnerPath = await fetch(`${url}/learner/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(learnerPath.status, 404, 'Admin-only service must not expose learner routes');
    const recoveryPath = await fetch(`${url}/auth/forgot-password`, { method: 'POST', headers: requestHeaders,
      body: JSON.stringify({ email: fixtures[0].email }) });
    assert.equal(recoveryPath.status, 404, 'Admin-only service must not expose recovery or external email');
    checks.push('admin-only route surface');

    const databaseRole = await getPool().query(`SELECT current_user AS role,
      r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
      has_table_privilege(current_user,'core.users','DELETE') AS can_delete_users,
      has_column_privilege(current_user,'core.users','password','UPDATE') AS can_change_password,
      has_column_privilege(current_user,'portal_security.account_states','active','UPDATE') AS can_activate,
      has_schema_privilege(current_user,'portal_security','CREATE') AS can_create_objects,
      (SELECT count(*)::int FROM core.users WHERE email NOT LIKE '%@epdg.invalid' OR name NOT LIKE 'SYNTHETIC %') AS real_identities,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='portal_security' AND c.relkind='r' AND c.relrowsecurity) AS secured_security_tables
      FROM pg_roles r WHERE r.rolname=current_user`);
    const [privileges] = databaseRole.rows;
    assert.equal(privileges.role, profile.runtimeRole);
    for (const name of ['rolsuper','rolcreatedb','rolcreaterole','rolbypassrls','can_delete_users',
      'can_change_password','can_activate','can_create_objects']) assert.equal(privileges[name], false, `Forbidden runtime privilege ${name}`);
    assert.equal(privileges.real_identities, 0);
    assert.equal(privileges.secured_security_tables, 8);
    checks.push('unprivileged runtime role and RLS');

    const logoutResponse = await fetch(`${url}/auth/logout`, { method: 'POST',
      headers: { ...requestHeaders, Cookie: cookie, 'X-CSRF-Token': loginBody.csrf_token }, body: '{}' });
    assert.equal(logoutResponse.status, 200);
    logout = true;
    checks.push('CSRF-protected logout');
    console.log(JSON.stringify({ projectId: profile.projectId, branchId: profile.branchId,
      database: profile.databaseName, result: 'passed', checks, realRecordsImported: 0,
      rolesGrantedToRealUsers: 0, learnerActivation: false }));
  } finally {
    if (cookie && !logout) {
      try { await fetch(`${url}/auth/logout`, { method: 'POST', headers: { ...requestHeaders,
        Cookie: cookie, 'X-CSRF-Token': csrf }, body: '{}' }); } catch { /* best-effort cleanup */ }
    }
    await new Promise(resolve => server.close(resolve));
    await getPool().end();
  }
}

module.exports = { verify, seedSyntheticFixtures, configureRuntime };

if (require.main === module) verify().catch(error => {
  console.error(`Neon administrator staging verification failed (${error?.name || 'Error'}); credentials and fixture passwords were not printed.`);
  process.exitCode = 1;
});
