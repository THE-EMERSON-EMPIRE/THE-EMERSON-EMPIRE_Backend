'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, relative } = require('node:path');
const { test } = require('node:test');

const repoRoot = join(__dirname, '..');
const schemaPath = join(repoRoot, 'epdg-backend-core', 'SCHEMA_REFERENCE.sql');
const agencyPath = join(repoRoot, 'supabase', 'migrations', '20260708_api_foundation_review.sql');
const mapPath = join(repoRoot, 'docs', 'rls-policy-map.md');
const rlsDraftPath = join(
  repoRoot,
  'supabase',
  'review-only',
  '2026-08-08',
  'draft_data_api_lockdown.sql',
);
const indexDraftPath = join(
  repoRoot,
  'supabase',
  'review-only',
  '2026-08-08',
  'draft_foreign_key_indexes.sql',
);
const ownershipPath = join(
  repoRoot,
  'supabase',
  'review-only',
  '2026-08-08',
  'proven-ownership-relationships.json',
);

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function stripSqlLineComments(sql) {
  return sql.replace(/^\s*--.*$/gm, '');
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function extractTrackedTables() {
  const snapshot = [...read(schemaPath).matchAll(
    /^CREATE TABLE\s+([a-z_]+\.[a-z_]+)\s*\(/gmi,
  )].map((match) => match[1].toLowerCase());
  const agency = [...read(agencyPath).matchAll(
    /^create table if not exists\s+(agency\.[a-z_]+)\s*\(/gmi,
  )].map((match) => match[1].toLowerCase());
  return { snapshot, agency, all: sortedUnique([...snapshot, ...agency]) };
}

function snapshotTableBlocks() {
  const schema = read(schemaPath);
  const headings = [...schema.matchAll(/^-- --- Table: ([a-z_]+\.[a-z_]+) ---$/gm)];
  return headings.map((heading, index) => ({
    table: heading[1].toLowerCase(),
    body: schema.slice(heading.index, headings[index + 1]?.index ?? schema.length),
  }));
}

function columnList(value) {
  return value.split(',').map((column) => column
    .trim()
    .replaceAll('"', '')
    .replace(/\s+(asc|desc)\b.*$/i, '')
    .toLowerCase());
}

function uncoveredSnapshotForeignKeys() {
  const uncovered = [];
  for (const { table, body } of snapshotTableBlocks()) {
    const indexColumns = [];
    for (const match of body.matchAll(/PRIMARY KEY \(([^)]+)\)/gi)) {
      indexColumns.push(columnList(match[1]));
    }
    for (const match of body.matchAll(/UNIQUE \(([^)]+)\)/gi)) {
      indexColumns.push(columnList(match[1]));
    }
    for (const match of body.matchAll(
      /CREATE (?:UNIQUE )?INDEX [a-z0-9_]+ ON [^\n]+?\(([^)]+)\)/gi,
    )) {
      indexColumns.push(columnList(match[1]));
    }

    for (const match of body.matchAll(
      /FOREIGN KEY \(([^)]+)\) REFERENCES ([a-z0-9_.]+)\(([^)]+)\)/gi,
    )) {
      const foreignColumns = columnList(match[1]);
      const covered = indexColumns.some((indexed) => foreignColumns.every(
        (column, index) => indexed[index] === column,
      ));
      if (!covered) {
        assert.equal(foreignColumns.length, 1, `test parser expects one-column FK: ${table}`);
        uncovered.push(`${table}.${foreignColumns[0]}`);
      }
    }
  }
  return sortedUnique(uncovered);
}

function snapshotForeignKeySet() {
  const result = new Set();
  for (const { table, body } of snapshotTableBlocks()) {
    const childSchema = table.split('.')[0];
    for (const match of body.matchAll(
      /FOREIGN KEY \(([^)]+)\) REFERENCES ([a-z0-9_.]+)\(([^)]+)\)/gi,
    )) {
      const parent = match[2].includes('.') ? match[2] : `${childSchema}.${match[2]}`;
      result.add([
        table,
        columnList(match[1]).join(','),
        parent.toLowerCase(),
        columnList(match[3]).join(','),
      ].join('|'));
    }
  }
  return result;
}

test('RLS map has one row for each of the 43 tracked table contracts', () => {
  const { snapshot, agency, all } = extractTrackedTables();
  assert.equal(snapshot.length, 40);
  assert.equal(agency.length, 3);
  assert.equal(all.length, 43);

  const map = read(mapPath);
  const section = map.match(/<!-- TABLE_MAP_START -->([\s\S]+?)<!-- TABLE_MAP_END -->/);
  assert.ok(section, 'table-map markers must exist');
  const rows = [...section[1].matchAll(/^\| `([a-z_]+\.[a-z_]+)` \|/gm)]
    .map((match) => match[1].toLowerCase());

  assert.equal(rows.length, 43);
  assert.deepEqual(sortedUnique(rows), all);
  assert.match(map, /Anonymous \/ public/);
  assert.match(map, /Authenticated participant/);
  assert.match(map, /Intern own record/);
  assert.match(map, /Assigned mentor or team lead/);
  assert.match(map, /Founder \/ super-admin/);
  assert.match(map, /Backend service only/);
});

test('reported-disabled and Agency-proposal RLS labels are exact', () => {
  const map = read(mapPath);
  const section = map.match(/<!-- TABLE_MAP_START -->([\s\S]+?)<!-- TABLE_MAP_END -->/)[1];
  const rows = section.split('\n').filter((line) => /^\| `[a-z_]+\.[a-z_]+` \|/.test(line));
  const disabled = [];
  const proposed = [];

  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim());
    const table = cells[1].replaceAll('`', '');
    if (cells[2].includes('**D**')) disabled.push(table);
    if (cells[2].includes('**P**')) proposed.push(table);
  }

  assert.deepEqual(disabled.sort(), [
    'core.branches',
    'core.user_branch_roles',
    'core.users',
    'epdg.career_experiences',
    'epdg.career_files',
    'epdg.career_projects',
    'epdg.career_skills',
  ]);
  assert.deepEqual(proposed.sort(), [
    'agency.booking_inquiries',
    'agency.clients',
    'agency.compliance_acknowledgements',
  ]);
});

test('review-only lockdown covers tracked tables plus the separate runtime ledger', () => {
  const draft = read(rlsDraftPath);
  const listed = [...draft.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)]
    .map((match) => `${match[1]}.${match[2]}`);
  const expected = sortedUnique([...extractTrackedTables().all, 'public.migrations']);

  assert.equal(listed.length, 44);
  assert.deepEqual(sortedUnique(listed), expected);
  assert.match(draft, /alter table %I\.%I enable row level security/i);
  assert.match(draft, /revoke all privileges on schema %I from %I/i);
  assert.match(draft, /revoke all privileges on all tables in schema %I from %I/i);
  assert.match(draft, /revoke all privileges on all sequences in schema %I from %I/i);
  assert.match(draft, /revoke all privileges on all functions in schema %I from %I/i);
  assert.match(draft, /array\['anon', 'authenticated'\]/i);
});

test('review SQL is fail-closed and excludes unsafe policy shortcuts', () => {
  const sql = stripSqlLineComments(`${read(rlsDraftPath)}\n${read(indexDraftPath)}`);

  for (const forbidden of [
    /\bcreate\s+policy\b/i,
    /\busing\s*\(\s*true\s*\)/i,
    /\bwith\s+check\s*\(\s*true\s*\)/i,
    /auth\.role\s*\(/i,
    /raw_user_meta_data|user_metadata/i,
    /security\s+definer/i,
    /\bgrant\b[\s\S]{0,200}\bservice_role\b/i,
    /\bdrop\s+table\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /\bdisable\s+row\s+level\s+security\b/i,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }

  for (const path of [rlsDraftPath, indexDraftPath, ownershipPath]) {
    const repoPath = relative(repoRoot, path).replaceAll('\\', '/');
    assert.match(repoPath, /^supabase\/review-only\/2026-08-08\//);
    assert.doesNotMatch(repoPath, /^supabase\/migrations\//);
    assert.doesNotMatch(repoPath, /^epdg-backend-core\/src\/db\/migrations\//);
  }
});

test('24 concurrent index candidates exactly match uncovered snapshot FKs', () => {
  const draft = read(indexDraftPath);
  const statements = [...draft.matchAll(
    /^create index concurrently if not exists\s+([a-z0-9_]+)\s+on\s+([a-z_]+\.[a-z_]+)\s+\(([^)]+)\);/gmi,
  )];
  const proposed = statements.map((match) => {
    const columns = columnList(match[3]);
    assert.equal(columns.length, 1, match[1]);
    return `${match[2].toLowerCase()}.${columns[0]}`;
  });

  assert.equal(statements.length, 24);
  assert.equal((draft.match(/^create index /gmi) || []).length, 24);
  assert.deepEqual(sortedUnique(proposed), uncoveredSnapshotForeignKeys());
  assert.doesNotMatch(draft, /^\s*(begin|commit)\s*;/gmi);
});

test('policy-design relationships are limited to proven foreign keys and code predicates', () => {
  const manifest = JSON.parse(read(ownershipPath));
  assert.equal(manifest.policyReady, false);
  assert.equal(manifest.identityBridgeStatus, 'unresolved');
  assert.equal(manifest.relationships.length, 29);
  assert.equal(new Set(manifest.relationships.map(({ id }) => id)).size, 29);

  const foreignKeys = snapshotForeignKeySet();
  for (const relationship of manifest.relationships) {
    const key = [
      relationship.child,
      relationship.childColumns.join(','),
      relationship.parent,
      relationship.parentColumns.join(','),
    ].join('|').toLowerCase();
    assert.equal(foreignKeys.has(key), true, `${relationship.id}: ${key}`);
  }

  const publicRoute = read(join(repoRoot, 'routes', 'publicContributions.js'));
  assert.match(publicRoute, /cf\.is_public\s*=\s*true/i);
  assert.match(publicRoute, /ip\.is_approved\s*=\s*true/i);
  assert.match(publicRoute, /u\.deleted_at\s+is\s+null/i);

  const careerService = read(join(
    repoRoot,
    'epdg-backend-core',
    'src',
    'services',
    'CareerFileService.ts',
  ));
  assert.match(careerService, /ip\.id\s*=\s*\$1\s+AND\s+ip\.mentor_id\s*=\s*\$2/i);

  const authMiddleware = read(join(
    repoRoot,
    'epdg-backend-core',
    'src',
    'middlewares',
    'auth.ts',
  ));
  assert.match(authMiddleware, /decoded\.purpose\s*!==\s*'access'/);
  assert.match(authMiddleware, /Number\.isInteger\(decoded\.id\)/);
  assert.match(authMiddleware, /admin_role\s*!==\s*'super_admin'/);

  assert.doesNotMatch(stripSqlLineComments(read(rlsDraftPath)), /\bcreate\s+policy\b/i);
});
