'use strict';

const {
  copyFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} = require('node:fs');
const { join } = require('node:path');

const source = join(__dirname, '..', 'src', 'db', 'migrations');
const destination = join(__dirname, '..', 'dist', 'db', 'migrations');
const policySource = join(__dirname, '..', 'src', 'db', 'migration-policy.json');
const policyDestination = join(__dirname, '..', 'dist', 'db', 'migration-policy.json');
const policy = JSON.parse(readFileSync(policySource, 'utf8'));
const reviewedFiles = [...policy.baselineFiles, ...policy.reviewedForwardFiles];
const actualFiles = readdirSync(source)
  .sort();
const expectedFiles = [...reviewedFiles].sort();

if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error('Migration files do not match the reviewed migration policy.');
}

for (const file of reviewedFiles) {
  if (!file.endsWith('.sql')) {
    throw new Error(`Migration evidence must be SQL: ${file}`);
  }
}

// Historical migrations are source-only audit evidence. They are deliberately
// excluded from dist so application code cannot execute destructive history.
rmSync(destination, { recursive: true, force: true });
copyFileSync(policySource, policyDestination);
