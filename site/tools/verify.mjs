#!/usr/bin/env node
// Runs every check over the PATINA public site and exits non zero if any of
// them fails. This is the one command to run before publishing the site, the
// way docs/tools/verify.mjs is for the documentation.
// Run: node site/tools/verify.mjs

import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(fileURLToPath(new URL('.', import.meta.url)));

const STEPS = [
  ['check-site.mjs', [], 'structure, links, metadata and the shared design tokens'],
  ['build-cards.mjs', ['--check'], 'the social cards still match the palette'],
  ['check-behaviour.mjs', [], 'the browser scripts do what the pages promise'],
];

let failed = 0;

for (const [script, args, what] of STEPS) {
  process.stdout.write(`\n=== ${script}  (${what})\n`);
  const run = spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: 'utf8' });
  const out = (run.stdout || '').trimEnd();
  const err = (run.stderr || '').trimEnd();
  if (out) console.log(out.split('\n').map((l) => '  ' + l).join('\n'));
  if (err) console.error(err.split('\n').map((l) => '  ' + l).join('\n'));
  if (run.status !== 0) {
    failed += 1;
    console.error(`  FAILED with status ${run.status}`);
  }
}

console.log('');
if (failed) {
  console.error(`${failed} of ${STEPS.length} checks failed`);
  process.exit(1);
}
console.log(`all ${STEPS.length} checks passed`);
