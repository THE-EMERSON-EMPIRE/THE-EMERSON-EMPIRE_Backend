'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { AdminService } = require('../dist/security/AdminService.js');
const { ADMIN_ROLE_CATALOG, FOUNDER_ADMIN_PERMISSIONS, isAdminStagingEnabled, permissionsForAdminRoles } = require('../dist/security/adminPolicy.js');

test('administrator staging is available only in the local or exact Neon synthetic profile', () => {
  assert.equal(isAdminStagingEnabled({ NODE_ENV: 'test', EPDG_SYNTHETIC_MODE: '1', EPDG_ADMIN_STAGING_MODE: '1' }), true);
  assert.equal(isAdminStagingEnabled({ NODE_ENV: 'production', EPDG_SYNTHETIC_MODE: '1', EPDG_ADMIN_STAGING_MODE: '1' }), false);
  assert.equal(isAdminStagingEnabled({ NODE_ENV: 'test', EPDG_ADMIN_STAGING_MODE: '1' }), false);
  assert.equal(isAdminStagingEnabled({ NODE_ENV: 'test', EPDG_SYNTHETIC_MODE: '1' }), false);

  const neon = {
    NODE_ENV: 'production', EPDG_NEON_ADMIN_STAGING_MODE: '1', EPDG_SYNTHETIC_MODE: '1', EPDG_ADMIN_STAGING_MODE: '1',
    NEON_ADMIN_STAGING_PROJECT_ID: 'lively-hill-76068632', NEON_ADMIN_STAGING_BRANCH_ID: 'br-plain-unit-bc3s0lqy',
    DB_HOST: 'ep-late-breeze-bce2mem6.c-16.us-east-1.aws.neon.tech', DB_PORT: '5432',
    DB_NAME: 'emerson_epdg_portal_app', DB_USER: 'epdg_portal_runtime', DB_PASSWORD: 'runtime-password-placeholder-1234567890',
    DB_SSL: 'true', SESSION_CSRF_SECRET: 'csrf-secret-placeholder-12345678901234567890',
    PORTAL_ORIGIN: 'https://review.example.invalid', CORS_ORIGINS: 'https://review.example.invalid',
  };
  assert.equal(isAdminStagingEnabled(neon), true);
  assert.throws(() => isAdminStagingEnabled({ ...neon, NEON_ADMIN_STAGING_BRANCH_ID: 'br-other-branch' }), /configuration is unavailable/);
  assert.throws(() => isAdminStagingEnabled({ ...neon, SUPABASE_URL: 'https://example.invalid' }), /configuration is unavailable/);
});

test('founder permissions are explicit; WebDev has no inherited founder permission', () => {
  assert.deepEqual(permissionsForAdminRoles(['founder_admin']), [...FOUNDER_ADMIN_PERMISSIONS]);
  assert.deepEqual(permissionsForAdminRoles(['webdev_technical']), []);
  assert.equal(ADMIN_ROLE_CATALOG.some(role => role.code === 'hr'), false);
  assert.equal(ADMIN_ROLE_CATALOG.find(role => role.code === 'founder_admin').requestable, false);
  assert.equal(ADMIN_ROLE_CATALOG.find(role => role.code === 'webdev_technical').requestable, true);
});

test('role request controls reject self-escalation and founder grants before SQL', async () => {
  const admin = new AdminService();
  const client = { query: async () => { throw new Error('unexpected SQL'); } };
  const founder = { id: 7, name: 'SYNTHETIC Founder', email: 'founder-admin@epdg.invalid', permissions: [...FOUNDER_ADMIN_PERMISSIONS] };
  await assert.rejects(() => admin.requestWebDevRole(client, founder, 7, 'webdev_technical'), /Self-assignment/);
  await assert.rejects(() => admin.requestWebDevRole(client, founder, 8, 'founder_admin'), /cannot be requested/);
  const webdev = { ...founder, id: 8, permissions: [] };
  await assert.rejects(() => admin.requestWebDevRole(client, webdev, 9, 'webdev_technical'), /permission required/);
});

test('admin migration is additive, checksummed, isolated, and enables RLS without public grants', () => {
  const root = join(__dirname, '..');
  const manifest = JSON.parse(readFileSync(join(root, 'src/security/admin-schema-manifest.json'), 'utf8'));
  const sql = readFileSync(join(root, 'admin-migrations', manifest.file), 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), manifest.sha256);
  assert.match(sql, /ALTER TABLE portal_security\.role_assignments ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE portal_security\.admin_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON portal_security\.role_assignments,portal_security\.admin_events FROM PUBLIC/i);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /GRANT\s+.+\s+TO\s+PUBLIC/i);
});
