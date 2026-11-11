'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const profile = require('../dist/neon-admin-staging/profile.json');
const { validateNeonAdminStagingEnvironment } = require('../dist/neon-admin-staging/profile.js');
const { getDatabaseSslConfig } = require('../dist/db/tls.js');
const { portalConfig } = require('../dist/security/config.js');

function environment(overrides = {}) {
  return {
    NODE_ENV: 'test', EPDG_NEON_ADMIN_STAGING_MODE: '1', EPDG_SYNTHETIC_MODE: '1', EPDG_ADMIN_STAGING_MODE: '1',
    NEON_ADMIN_STAGING_PROJECT_ID: profile.projectId, NEON_ADMIN_STAGING_BRANCH_ID: profile.branchId,
    DB_HOST: profile.databaseHost, DB_PORT: '5432', DB_NAME: profile.databaseName,
    DB_USER: profile.runtimeRole, DB_PASSWORD: 'runtime-password-placeholder-1234567890', DB_SSL: 'true',
    SESSION_CSRF_SECRET: 'csrf-secret-placeholder-12345678901234567890',
    PORTAL_ORIGIN: 'http://127.0.0.1:58080', CORS_ORIGINS: 'http://127.0.0.1:58080',
    ...overrides,
  };
}

test('Neon staging requires the exact project, child branch, database, runtime role, and local synthetic identity', () => {
  assert.equal(validateNeonAdminStagingEnvironment(environment()).branchId, profile.branchId);
  for (const overrides of [
    { NEON_ADMIN_STAGING_BRANCH_ID: 'br-wrong-branch' },
    { DB_HOST: 'other.c-16.us-east-1.aws.neon.tech' },
    { DB_NAME: 'another_app' },
    { DB_USER: profile.migratorRole },
    { DB_SSL: 'false' },
    { NODE_ENV: 'development' },
    { PORTAL_ORIGIN: 'http://localhost:58080', CORS_ORIGINS: 'http://localhost:58080' },
    { SUPABASE_URL: 'https://supabase.example.invalid' },
    { RESEND_API_KEY: 'must-not-be-in-staging' },
  ]) assert.throws(() => validateNeonAdminStagingEnvironment(environment(overrides)), /configuration is unavailable/);
});

test('Neon staging TLS verifies the server certificate and rejects unsafe TLS settings', () => {
  assert.deepEqual(getDatabaseSslConfig(environment()), { rejectUnauthorized: true });
  assert.throws(() => getDatabaseSslConfig(environment({ DB_SSL: 'false' })), /configuration is unavailable/);
  assert.throws(() => getDatabaseSslConfig(environment({ DB_HOST: 'unverified.example.invalid' })), /configuration is unavailable/);
});

test('Neon staging test cookies accept only the validated loopback origin and production cookies stay secure', () => {
  const loopback = environment({ PORTAL_ORIGIN: 'http://127.0.0.1:43127', CORS_ORIGINS: 'http://127.0.0.1:43127' });
  const localConfig = portalConfig(loopback);
  assert.equal(localConfig.origin, loopback.PORTAL_ORIGIN);
  assert.equal(localConfig.cookieName, 'epdg_admin_staging_session');
  assert.equal(localConfig.cookie.secure, false);
  assert.throws(() => portalConfig(environment({
    PORTAL_ORIGIN: 'http://localhost:43127', CORS_ORIGINS: 'http://localhost:43127',
  })), /configuration is unavailable/);

  const production = environment({ NODE_ENV: 'production',
    PORTAL_ORIGIN: 'https://admin-staging.example.invalid', CORS_ORIGINS: 'https://admin-staging.example.invalid' });
  const productionConfig = portalConfig(production);
  assert.equal(productionConfig.cookieName, '__Host-epdg_session');
  assert.equal(productionConfig.cookie.secure, true);
});

test('the pinned synthetic foundation migration is checksummed and contains no destructive or imported data operation', () => {
  const root = join(__dirname, '..');
  const manifest = JSON.parse(readFileSync(join(root, 'neon-admin-staging-migrations/000-synthetic-foundation.json'), 'utf8'));
  const sql = readFileSync(join(root, 'neon-admin-staging-migrations', manifest.file), 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), manifest.sha256);
  assert.match(sql, /CREATE TABLE core\.users/i);
  assert.match(sql, /CREATE TABLE epdg\.users/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|COPY\s+.+\s+FROM/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO/i);
});

test('the Railway candidate app mounts only the isolated administrator router', () => {
  const root = join(__dirname, '..');
  const app = readFileSync(join(root, 'src/adminStagingApp.ts'), 'utf8');
  const routes = readFileSync(join(root, 'src/security/adminStagingRoutes.ts'), 'utf8');
  assert.match(app, /createAdminStagingRouter/);
  assert.doesNotMatch(app, /createHandoffRouter|createPortalRouter/);
  assert.match(routes, /router\.post\('\/auth\/login'/);
  assert.match(routes, /router\.get\('\/admin\/overview'/);
  assert.doesNotMatch(routes, /learner|forgot-password|reset-password|change-password|refresh|register/i);
  assert.match(routes, /X-CSRF-Token/);
  assert.match(routes, /HttpOnly|cookie/i);
});

test('runtime privileges are column-scoped, RLS-bound, and exclude activation or deletion', () => {
  const root = join(__dirname, '..');
  const grants = readFileSync(join(root, 'scripts/neon-admin-staging/configure-runtime.cjs'), 'utf8');
  assert.match(grants, /rolbypassrls/);
  assert.match(grants, /ALTER TABLE core\.users|CREATE POLICY/);
  assert.match(grants, /GRANT UPDATE\(last_login_at\) ON core\.users/);
  assert.match(grants, /GRANT UPDATE\(revision\) ON portal_security\.account_states/);
  assert.doesNotMatch(grants, /GRANT\s+[^;]*(?:DELETE|BYPASSRLS|ALL\s+PRIVILEGES)/i);
  assert.doesNotMatch(grants, /GRANT\s+.+\s+TO\s+PUBLIC/i);
});
