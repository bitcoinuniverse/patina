#!/usr/bin/env node
// House style checker for the PATINA documentation.
// Fails on: em dashes, version labels in paths or copy, hype words, emoji, and
// any resource loaded from another host.
// Run: node docs/tools/check-style.mjs

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const HYPE = [
  'comprehensive', 'robust', 'seamless', 'seamlessly', 'cutting edge', 'cutting-edge',
  'powerful', 'revolutionary', 'world class', 'world-class', 'game changing', 'game-changing',
  'unlock', 'unlocks', 'unlocking', 'best in class', 'best-in-class', 'state of the art',
  'state-of-the-art', 'next generation', 'next-generation', 'industry leading',
  'industry-leading', 'effortless', 'effortlessly', 'blazing fast', 'supercharge',
  'leverage the', 'delve', 'elevate your', 'unparalleled', 'frictionless',
];

const DASHES = [
  ['em dash', '—'],
  ['en dash', '–'],
  ['horizontal bar', '―'],
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(html|css|js|mjs|json|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = (await walk(ROOT)).sort();
const failures = [];
let scanned = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel.startsWith('assets/search-index.')) continue; // generated from the pages already checked
  if (rel === 'tools/check-style.mjs') continue;        // this file lists the words on purpose
  if (rel === 'deviations.md') continue;                // owned by another engineer
  scanned += 1;

  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);

  // Path itself must carry no version label.
  if (/(^|[/_.-])v\d+([/_.-]|$)/i.test(rel)) failures.push(`${rel}: version label in the file path`);

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    for (const [name, ch] of DASHES) {
      if (line.includes(ch)) failures.push(`${at}: ${name} found`);
    }

    if (EMOJI.test(line)) failures.push(`${at}: emoji found`);

    // Version labels, no exceptions: names, paths, packages, URLs, folders, or UI copy.
    const label = line.match(/(^|[^a-z0-9])v\d+(\.\d+)*\b/i);
    if (label) failures.push(`${at}: version label "${label[0].trim()}"`);

    const lower = line.toLowerCase();
    for (const word of HYPE) {
      // Whole words only, so that "locked" does not match inside another word.
      const re = new RegExp('(^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)');
      if (re.test(lower)) failures.push(`${at}: hype word "${word}"`);
    }

    // No third party resources anywhere.
    const resource = line.match(/\s(?:src|href)="(https?:)?\/\/[^"]+"/i);
    if (resource) failures.push(`${at}: external resource ${resource[0].trim()}`);
  });
}

console.log(`files scanned                      ${scanned}`);
console.log(`style failures                     ${failures.length}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
