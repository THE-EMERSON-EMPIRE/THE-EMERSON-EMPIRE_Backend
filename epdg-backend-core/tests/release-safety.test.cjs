'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const {
  getReviewedMigrationManifest,
  getMigrationPolicy,
  validateMigrationDirectory,
  validateMigrationFileNames,
  validateNonDestructiveMigrationSql,
} = require('../dist/db/migrationSafety.js');
const {
  runHealthSmoke,
  validateApiOrigin,
} = require('../scripts/health-smoke.cjs');

const sourceMigrations = join(__dirname, '..', 'src', 'db', 'migrations');
const builtMigrations = join(__dirname, '..', 'dist', 'db', 'migrations');
const policy = getMigrationPolicy();

test('historical migration SQL remains source-only audit evidence', () => {
  validateMigrationDirectory(sourceMigrations);
  assert.equal(existsSync(builtMigrations), false);
  assert.equal(policy.baselineFiles.length, 33);
  assert.deepEqual(policy.reviewedForwardFiles, []);
  assert.equal(getReviewedMigrationManifest(sourceMigrations).length, 33);
  assert.match(
    readFileSync(join(__dirname, '..', '..', '.gitattributes'), 'utf8'),
    /epdg-backend-core\/src\/db\/migrations\/\*\.sql text eol=lf/,
  );
});

test('destructive historical migrations are baseline-only', () => {
  assert.deepEqual(policy.blockedHistoricalFiles, [
    '011-create_admins_table.sql',
    '024-fix-certificates-table.sql',
  ]);
  for (const file of policy.blockedHistoricalFiles) {
    assert.equal(policy.baselineFiles.includes(file), true, file);
    assert.equal(policy.reviewedForwardFiles.includes(file), false, file);
  }
});

test('application code contains no database migration execution path', () => {
  const databaseModule = readFileSync(
    join(__dirname, '..', 'src', 'db', 'index.ts'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
  );
  assert.doesNotMatch(databaseModule, /performMigration|postgres-migrations|ALLOW_DATABASE_MIGRATIONS/);
  assert.equal(packageJson.dependencies['postgres-migrations'], undefined);
});

test('unreviewed migration filenames fail closed', () => {
  assert.throws(
    () => validateMigrationFileNames([
      ...policy.baselineFiles,
      '034-unreviewed.sql',
    ]),
    /not allowlisted/,
  );
});

test('reviewed forward migrations reject destructive SQL', () => {
  for (const sql of [
    'DROP TABLE epdg.applications;',
    'TRUNCATE epdg.submissions;',
    'DELETE FROM public.migrations;',
  ]) {
    assert.throws(
      () => validateNonDestructiveMigrationSql('034-forward-only.sql', sql),
      /contains destructive SQL/,
    );
  }
});

test('EPDG health smoke accepts only credential-free origins', () => {
  assert.equal(validateApiOrigin('https://api.example.invalid'), 'https://api.example.invalid');
  assert.equal(validateApiOrigin('http://127.0.0.1:8000'), 'http://127.0.0.1:8000');
  assert.throws(() => validateApiOrigin(undefined), /EPDG_API_ORIGIN is required/);

  for (const origin of [
    'http://api.example.invalid',
    'https://user@api.example.invalid',
    'https://api.example.invalid/path',
    'https://api.example.invalid?token=private',
  ]) {
    assert.throws(() => validateApiOrigin(origin), /EPDG_API_ORIGIN/);
  }
});

test('EPDG health smoke verifies the privacy-safe readiness contract', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      status: 200,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({
        success: true,
        service: 'epdg-backend-core',
        status: 'ok',
      }),
    };
  };

  assert.deepEqual(
    await runHealthSmoke('https://api.example.invalid', fetchImpl),
    { status: 200 },
  );
  assert.equal(calls[0].url, 'https://api.example.invalid/health');
  assert.equal(calls[0].options.redirect, 'error');
});
