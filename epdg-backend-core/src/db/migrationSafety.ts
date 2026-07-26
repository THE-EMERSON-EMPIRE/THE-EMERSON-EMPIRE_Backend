import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import migrationPolicy from './migration-policy.json';

export interface MigrationPolicy {
  readonly baselineFiles: readonly string[];
  readonly blockedHistoricalFiles: readonly string[];
  readonly reviewedForwardFiles: readonly string[];
}

interface ParsedMigrationFile {
  file: string;
  id: number;
  name: string;
}

const policy: MigrationPolicy = migrationPolicy;
const immutableBaselineEndId = 33;
const migrationFilePattern = /^(\d+)[-_]?(.*)\.sql$/;
const forbiddenForwardSql = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

function fail(message: string): never {
  throw new Error(`Migration safety check failed: ${message}`);
}

function parseMigrationFile(file: string): ParsedMigrationFile {
  const match = migrationFilePattern.exec(file);
  if (!match) {
    return fail(`reviewed migration filename is invalid: ${file}`);
  }

  return {
    file,
    id: Number(match[1]),
    name: match[2],
  };
}

function allReviewedFiles(): string[] {
  return [...policy.baselineFiles, ...policy.reviewedForwardFiles];
}

function validatePolicyDefinition(): void {
  const reviewed = allReviewedFiles();
  if (new Set(reviewed).size !== reviewed.length) {
    fail('the migration policy contains duplicate filenames');
  }

  const parsed = reviewed.map(parseMigrationFile);
  if (
    policy.baselineFiles.length !== immutableBaselineEndId
    || parsed[policy.baselineFiles.length - 1]?.id !== immutableBaselineEndId
  ) {
    fail(`the audit-only baseline must contain exactly migrations 001-${immutableBaselineEndId}`);
  }
  for (const [index, migration] of parsed.entries()) {
    const expectedId = index + 1;
    if (migration.id !== expectedId) {
      fail(`reviewed migrations must be consecutive; expected ${expectedId}, found ${migration.id}`);
    }
  }

  const baseline = new Set(policy.baselineFiles);
  const forward = new Set(policy.reviewedForwardFiles);
  for (const file of policy.blockedHistoricalFiles) {
    if (!baseline.has(file) || forward.has(file)) {
      fail(`blocked historical migration must be baseline-only: ${file}`);
    }
  }
}

export function getMigrationPolicy(): MigrationPolicy {
  validatePolicyDefinition();
  return Object.freeze({
    baselineFiles: Object.freeze([...policy.baselineFiles]),
    blockedHistoricalFiles: Object.freeze([...policy.blockedHistoricalFiles]),
    reviewedForwardFiles: Object.freeze([...policy.reviewedForwardFiles]),
  });
}

export function validateMigrationFileNames(files: string[]): void {
  validatePolicyDefinition();
  const expected = new Set(allReviewedFiles());
  const actual = new Set(files);
  const missing = [...expected].filter((file) => !actual.has(file));
  const unexpected = [...actual].filter((file) => !expected.has(file));

  if (missing.length > 0) {
    fail(`reviewed migration files are missing: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    fail(`migration files are not allowlisted: ${unexpected.join(', ')}`);
  }
}

export function validateNonDestructiveMigrationSql(file: string, sql: string): void {
  if (forbiddenForwardSql.some((pattern) => pattern.test(sql))) {
    fail(`reviewed forward migration contains destructive SQL: ${file}`);
  }
}

export function validateForwardMigrationSql(file: string, sql: string): void {
  if (!policy.reviewedForwardFiles.includes(file)) {
    fail(`migration is not approved for forward execution: ${file}`);
  }
  validateNonDestructiveMigrationSql(file, sql);
}

export function validateMigrationDirectory(migrationsPath: string): void {
  const entries = readdirSync(migrationsPath, { withFileTypes: true });
  const unsupported = entries.filter((entry) => !entry.isFile() || !entry.name.endsWith('.sql'));
  if (unsupported.length > 0) {
    fail(`only SQL migration evidence is allowed: ${unsupported.map((entry) => entry.name).join(', ')}`);
  }
  const files = entries.map((entry) => entry.name).sort();

  validateMigrationFileNames(files);
  for (const file of policy.reviewedForwardFiles) {
    validateForwardMigrationSql(file, readFileSync(path.join(migrationsPath, file), 'utf8'));
  }
}

export function getReviewedMigrationManifest(migrationsPath: string): Array<{
  id: number;
  name: string;
  hash: string;
  baselineOnly: boolean;
}> {
  validateMigrationDirectory(migrationsPath);
  const baseline = new Set(policy.baselineFiles);
  return allReviewedFiles().map((file) => {
    const parsed = parseMigrationFile(file);
    const sql = readFileSync(path.join(migrationsPath, file), 'utf8')
      .replace(/\r\n/g, '\n');
    return {
      id: parsed.id,
      name: parsed.name,
      hash: createHash('sha1').update(file + sql, 'utf8').digest('hex'),
      baselineOnly: baseline.has(file),
    };
  });
}
