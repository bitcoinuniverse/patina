#!/usr/bin/env node
// Runs every check over the PATINA documentation and exits non zero if any of
// them fails. This is the one command to run before publishing.
// Run: node docs/tools/verify.mjs

import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(fileURLToPath(new URL('.', import.meta.url)));

const STEPS = [
  ['vectors.mjs', 'recompute every byte example'],
  ['stamp-meta.mjs', 'rewrite the sharing metadata and the scriptless contents'],
  ['build-search-index.mjs', 'regenerate the search index'],
  ['check-html.mjs', 'structure and accessibility'],
  ['check-links.mjs', 'every link resolves'],
  ['check-style.mjs', 'house style'],
  ['check-vectors.mjs', 'printed hex matches the computed values'],
  ['check-contrast.mjs', 'colour contrast in both themes and both stylesheets'],
  ['check-shell.mjs', 'the browser scripts build what they should'],
];

let failed = 0;

for (const [script, what] of STEPS) {
  process.stdout.write(`\n=== ${script}  (${what})\n`);
  const run = spawnSync(process.execPath, [join(TOOLS, script)], { encoding: 'utf8' });
  const out = (run.stdout || '').trimEnd();
  const err = (run.stderr || '').trimEnd();
  // vectors.mjs prints the values themselves, which is noise in a summary run.
  if (script === 'vectors.mjs') {
    console.log(`  ${out.split('\n').length} lines of computed vectors`);
  } else if (out) {
    console.log(out.split('\n').map((l) => '  ' + l).join('\n'));
  }
  if (err) console.error(err.split('\n').map((l) => '  ' + l).join('\n'));
  if (run.status !== 0) { failed += 1; console.error(`  FAILED with status ${run.status}`); }
}

console.log('');
if (failed) {
  console.error(`${failed} of ${STEPS.length} checks failed`);
  process.exit(1);
}
console.log(`all ${STEPS.length} checks passed`);
