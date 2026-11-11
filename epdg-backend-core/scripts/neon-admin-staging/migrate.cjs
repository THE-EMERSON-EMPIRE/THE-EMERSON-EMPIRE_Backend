'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const core = path.resolve(__dirname, '../..');
const profile = require('../../src/neon-admin-staging/profile.json');
const foundation = require('../../neon-admin-staging-migrations/000-synthetic-foundation.json');
const security = require('../../src/security/schema-manifest.json');
const admin = require('../../src/security/admin-schema-manifest.json');
const migrations = [
  { manifest: foundation, file: path.join(core, 'neon-admin-staging-migrations', foundation.file) },
  { manifest: security, file: path.join(core, 'security-migrations', security.file) },
  { manifest: admin, file: path.join(core, 'admin-migrations', admin.file) },
];

function requireTarget() {
  assert.equal(process.env.NODE_ENV, 'test', 'Manual staging migrations require NODE_ENV=test');
  for (const name of ['EPDG_NEON_ADMIN_STAGING_MODE', 'EPDG_SYNTHETIC_MODE', 'EPDG_ADMIN_STAGING_MODE']) {
    assert.equal(process.env[name], '1', 'Isolated Neon administrator staging mode is required');
  }
  assert.equal(process.env.NEON_ADMIN_STAGING_PROJECT_ID, profile.projectId, 'Unexpected Neon project');
  assert.equal(process.env.NEON_ADMIN_STAGING_BRANCH_ID, profile.branchId, 'Unexpected Neon branch');
  assert.equal(process.env.DB_HOST, profile.databaseHost, 'Unexpected Neon host');
  assert.equal(process.env.DB_PORT, '5432', 'Unexpected Neon port');
  assert.equal(process.env.DB_NAME, profile.databaseName, 'Unexpected Neon database');
  assert.equal(process.env.DB_USER, profile.migratorRole, 'Migrations require the pinned migrator role');
  assert.equal(process.env.DB_SSL, 'true', 'Neon TLS verification is mandatory');
  const raw = process.env.NEON_ADMIN_STAGING_MIGRATOR_DATABASE_URL;
  assert.ok(raw && raw.length < 2048, 'A bounded migrator connection URL is required');
  const url = new URL(raw);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, profile.databaseHost, 'Connection URL is not pinned to the staging compute');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), profile.databaseName, 'Connection URL targets another database');
  assert.equal(decodeURIComponent(url.username), profile.migratorRole, 'Connection URL does not use the migrator role');
  assert.equal(url.port || '5432', '5432');
  return raw;
}

function strictTlsConnectionString(raw) {
  const url = new URL(raw);
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

function readMigration(item) {
  const sql = fs.readFileSync(item.file, 'utf8');
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  assert.equal(digest, item.manifest.sha256, 'Migration checksum does not match its reviewed manifest');
  return { version: item.manifest.version, sha256: digest, sql };
}

async function identity(db) {
  const { rows } = await db.query(`SELECT current_database() AS database_name, current_user AS role_name,
    r.rolsuper FROM pg_roles r WHERE r.rolname=current_user`);
  assert.equal(rows.length, 1, 'Database identity could not be verified');
  assert.equal(rows[0].database_name, profile.databaseName, 'Connected to another database');
  assert.equal(rows[0].role_name, profile.migratorRole, 'Connected with an unexpected role');
  assert.equal(rows[0].rolsuper, false, 'Neon staging migrations must not use a PostgreSQL superuser');
  assert.equal(db.connection.stream?.encrypted, true, 'Neon client transport did not negotiate TLS');
  assert.equal(db.connection.stream?.authorized, true, 'Neon TLS certificate was not verified');
}

async function apply(db, migration) {
  const { rows: existing } = await db.query(
    'SELECT sha256 FROM portal_security.schema_migrations WHERE version=$1', [migration.version]);
  if (existing.length) {
    assert.equal(existing[0].sha256, migration.sha256, 'Applied migration checksum mismatch requires manual review');
    return 'already-applied';
  }
  await db.query('BEGIN');
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-neon-admin-staging-migrations-v1'))");
    const { rows: concurrent } = await db.query(
      'SELECT sha256 FROM portal_security.schema_migrations WHERE version=$1', [migration.version]);
    if (concurrent.length) {
      assert.equal(concurrent[0].sha256, migration.sha256, 'Concurrent migration checksum mismatch');
      await db.query('COMMIT');
      return 'already-applied';
    }
    await db.query(migration.sql);
    await db.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',
      [migration.version, migration.sha256]);
    await db.query('COMMIT');
    return 'applied';
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function migrate() {
  const connectionString = strictTlsConnectionString(requireTarget());
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  let client;
  try {
    client = await pool.connect();
    await identity(client);
    const { rows: [catalog] } = await client.query(`SELECT
      to_regclass('portal_security.schema_migrations') IS NOT NULL AS has_ledger,
      to_regnamespace('core') IS NOT NULL AS has_core,
      to_regnamespace('epdg') IS NOT NULL AS has_epdg,
      to_regnamespace('portal_security') IS NOT NULL AS has_security`);
    if (!catalog.has_ledger) {
      assert.equal(catalog.has_core || catalog.has_epdg || catalog.has_security, false,
        'Untracked application schemas exist; refusing to claim this branch');
      const { rows: [objects] } = await client.query(`SELECT count(*)::int AS count FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema','public')
          AND c.relkind IN ('r','p','v','m','S')`);
      assert.equal(objects.count, 0, 'Untracked application objects exist; refusing to migrate');
      const first = readMigration(migrations[0]);
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('epdg-neon-admin-staging-migrations-v1'))");
        await client.query(first.sql);
        await client.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',
          [first.version, first.sha256]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    } else {
      const expectedFoundation = readMigration(migrations[0]);
      const { rows: baseline } = await client.query('SELECT version,sha256 FROM portal_security.schema_migrations ORDER BY version');
      const known = new Map(migrations.map(item => [item.manifest.version, item.manifest.sha256]));
      assert.ok(baseline.some(entry => entry.version === expectedFoundation.version),
        'Existing Neon staging ledger has no reviewed foundation record');
      assert.ok(baseline.length <= known.size, 'Unexpected Neon staging ledger entries require review');
      for (const entry of baseline) assert.equal(known.get(entry.version), entry.sha256, 'Existing staging migration checksum mismatch');
      if (baseline.some(entry => entry.version === admin.version)) {
        assert.ok(baseline.some(entry => entry.version === security.version), 'Admin migration cannot precede portal security');
      }
    }

    const statuses = [];
    for (const item of migrations) {
      const migration = readMigration(item);
      if (migration.version !== foundation.version) statuses.push(await apply(client, migration));
    }
    const { rows: ledger } = await client.query('SELECT version,sha256 FROM portal_security.schema_migrations ORDER BY version');
    const known = new Map(migrations.map(item => [item.manifest.version, item.manifest.sha256]));
    assert.equal(ledger.length, known.size, 'Unexpected migration ledger entries require review');
    for (const entry of ledger) assert.equal(known.get(entry.version), entry.sha256, 'Unexpected migration ledger entry');
    console.log(JSON.stringify({ projectId: profile.projectId, branchId: profile.branchId,
      database: profile.databaseName, migrationStatuses: statuses, recordsCreated: 0, productionTouched: false }));
  } finally {
    client?.release();
    await pool.end();
  }
}

module.exports = { migrate, requireTarget, strictTlsConnectionString, readMigration, identity };
if (require.main === module) migrate().catch(error => {
  console.error(`Neon administrator staging migration failed (${error?.name || 'Error'}); no credentials or SQL values were printed.`);
  process.exitCode = 1;
});
