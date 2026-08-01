#!/usr/bin/env node
/**
 * Byte contract check for patina-protocol.md.
 *
 * The specification is a hashed artifact. Deployment records bind to its
 * SHA-256, so a stray carriage return or a missing trailing newline would change
 * the identity of every deployment. This script enforces the byte rules and
 * prints the hash.
 *
 * Rules checked:
 *   valid UTF-8, no byte order mark
 *   LF line endings only, never CR
 *   no trailing whitespace on any line
 *   no tab characters
 *   exactly one trailing newline
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = fileURLToPath(new URL('../patina-protocol.md', import.meta.url));

/** Check the byte rules. Returns the list of problems found. */
export function checkSpecBytes(bytes) {
  const problems = [];

  if (bytes.length === 0) {
    problems.push('file is empty');
    return problems;
  }

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push('file starts with a UTF-8 byte order mark');
  }

  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    problems.push('file is not valid UTF-8');
    return problems;
  }

  const crCount = (text.match(/\r/g) ?? []).length;
  if (crCount > 0) problems.push(`file contains ${crCount} carriage return byte(s), line endings must be LF`);

  const tabCount = (text.match(/\t/g) ?? []).length;
  if (tabCount > 0) problems.push(`file contains ${tabCount} tab character(s)`);

  if (!text.endsWith('\n')) problems.push('file does not end with a newline');
  if (text.endsWith('\n\n')) problems.push('file ends with more than one newline');

  const lines = text.split('\n');
  const trailing = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/[ \t]$/.test(lines[i])) trailing.push(i + 1);
  }
  if (trailing.length > 0) problems.push(`trailing whitespace on line(s): ${trailing.join(', ')}`);

  return problems;
}

/** SHA-256 of the specification file, lowercase hex. */
export function specSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read the specification bytes that ship with this package. */
export function readSpecBytes() {
  return readFileSync(SPEC_PATH);
}

function main() {
  const bytes = readSpecBytes();
  const problems = checkSpecBytes(bytes);
  const hash = specSha256(bytes);
  const lines = bytes.toString('utf8').split('\n').length - 1;

  process.stdout.write(`spec file    patina-protocol.md\n`);
  process.stdout.write(`spec bytes   ${bytes.length}\n`);
  process.stdout.write(`spec lines   ${lines}\n`);
  process.stdout.write(`spec sha256  ${hash}\n`);

  if (problems.length > 0) {
    process.stdout.write(`\nbyte contract FAILED\n`);
    for (const p of problems) process.stdout.write(`  ${p}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`byte contract ok\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
