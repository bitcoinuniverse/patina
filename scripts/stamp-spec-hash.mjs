#!/usr/bin/env node
/**
 * Write the current specification hash into every shipped deployment record.
 *
 * Deployment records bind to the specification by hash. Whenever the
 * specification changes, run this, review the diff, and rerun the tests.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readSpecBytes, specSha256 } from './verify-spec.mjs';

const DEPLOYMENT_DIR = fileURLToPath(new URL('../deployments/', import.meta.url));

function main() {
  const hash = specSha256(readSpecBytes());
  const files = readdirSync(DEPLOYMENT_DIR).filter((name) => name.endsWith('.json')).sort();
  let changed = 0;

  for (const name of files) {
    const path = `${DEPLOYMENT_DIR}${name}`;
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (record.spec_sha256 === hash) {
      process.stdout.write(`unchanged  ${name}\n`);
      continue;
    }
    record.spec_sha256 = hash;
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    changed += 1;
    process.stdout.write(`stamped    ${name}\n`);
  }

  process.stdout.write(`spec sha256 ${hash}\n`);
  process.stdout.write(`${changed} of ${files.length} record(s) updated\n`);
}

main();
