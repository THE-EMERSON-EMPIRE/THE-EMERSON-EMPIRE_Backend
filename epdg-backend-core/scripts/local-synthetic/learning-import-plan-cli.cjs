'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createLearningImportPlan } = require('./learning-import-plan.cjs');

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
function readJson(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('invalid');
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

const [inputPath, priorPath] = process.argv.slice(2);
if (!inputPath || process.argv.length > 4) {
  process.stderr.write('Usage: node learning-import-plan-cli.cjs <synthetic-manifest.json> [prior-synthetic-receipt.json]\n');
  process.exitCode = 2;
} else {
  try {
    const bundle = readJson(inputPath);
    const prior = priorPath ? readJson(priorPath) : [];
    const result = createLearningImportPlan(bundle, prior);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch {
    process.stderr.write('Manifest could not be verified; no data was written or transferred.\n');
    process.exitCode = 1;
  }
}
