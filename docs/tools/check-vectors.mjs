#!/usr/bin/env node
// Proves that every byte example printed in the documentation was computed,
// not typed. It recomputes the canonical values, then checks that every hex run
// of 8 or more characters appearing in any page is part of one of them.
// A single wrong digit fails this check.
// Run: node docs/tools/check-vectors.mjs

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const sha256 = (b) => createHash('sha256').update(b).digest();
const hex = (b) => Buffer.from(b).toString('hex');
const ascii = (s) => Buffer.from(s, 'ascii');
const tagged = (tag, b) => {
  const t = sha256(ascii(tag));
  return sha256(Buffer.concat([t, t, b]));
};

// ------------------------------------------------------------- recompute
const claimant = sha256(ascii('PATINA docs example claimant 0'));
const salt = sha256(ascii('PATINA docs example salt')).subarray(0, 16);
const commitment = sha256(Buffer.concat([ascii('PTNA/commit'), claimant, salt]));
const leaf = Buffer.concat([
  Buffer.from([0x20]), claimant,
  Buffer.from([0xac, 0x20]), commitment,
  Buffer.from([0x75]),
]);
const leafHash = tagged('TapLeaf', Buffer.concat([Buffer.from([0xc0, leaf.length]), leaf]));
const revealWire = sha256(ascii('PATINA docs example reveal transaction'));
const revealDisplay = Buffer.from(revealWire).reverse();
const voutLe = Buffer.alloc(4); voutLe.writeUInt32LE(1, 0);
const artifactPre = Buffer.concat([ascii('PTNA/artifact'), revealWire, voutLe]);
const artifactId = sha256(artifactPre);
const blockHash = sha256(ascii('PATINA docs example block hash'));

const seedPayload = Buffer.concat([salt, Buffer.from([0x00, 0x01])]);
const seedPush = Buffer.concat([ascii('PTNA'), Buffer.from([0x01, 0x01]), seedPayload]);
const seedScript = Buffer.concat([Buffer.from([0x6a, seedPush.length]), seedPush]);

function keep(entries) {
  const payload = Buffer.concat([Buffer.from([entries.length]), ...entries.map(([i, v]) => Buffer.from([i, v]))]);
  const push = Buffer.concat([ascii('PTNA'), Buffer.from([0x01, 0x02]), payload]);
  return { payload, push, script: Buffer.concat([Buffer.from([0x6a, push.length]), push]) };
}
const keep1 = keep([[0, 2]]);
const keep2 = keep([[0, 1], [2, 3]]);
const keep8 = keep([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]);

const ALLOWED = new Map([
  ['claimant_xonly', hex(claimant)],
  ['salt', hex(salt)],
  ['commitment', hex(commitment)],
  ['commit leaf script', hex(leaf)],
  ['tapleaf hash', hex(leafHash)],
  ['reveal txid, display order', hex(revealDisplay)],
  ['reveal txid, wire order', hex(revealWire)],
  ['artifact id preimage', hex(artifactPre)],
  ['artifact id', hex(artifactId)],
  ['block hash', hex(blockHash)],
  ['commit preimage', hex(Buffer.concat([ascii('PTNA/commit'), claimant, salt]))],
  ['attestation body', hex(artifactId) + hex(blockHash)],
  ['SEED payload', hex(seedPayload)],
  ['SEED push', hex(seedPush)],
  ['SEED script', hex(seedScript)],
  ['KEEP 1 payload', hex(keep1.payload)],
  ['KEEP 1 push', hex(keep1.push)],
  ['KEEP 1 script', hex(keep1.script)],
  ['KEEP 2 payload', hex(keep2.payload)],
  ['KEEP 2 push', hex(keep2.push)],
  ['KEEP 2 script', hex(keep2.script)],
  ['KEEP 8 payload', hex(keep8.payload)],
  ['KEEP 8 push', hex(keep8.push)],
  ['KEEP 8 script', hex(keep8.script)],
  ['tag PTNA/commit', hex(ascii('PTNA/commit'))],
  ['tag PTNA/artifact', hex(ascii('PTNA/artifact'))],
  ['tag PTNA/event', hex(ascii('PTNA/event'))],
  ['tag PTNA/state', hex(ascii('PTNA/state'))],
  ['tag PTNA/attest', hex(ascii('PTNA/attest'))],
  ['placeholder hash', '0'.repeat(64)],
]);
const VALUES = [...ALLOWED.values()];

// --------------------------------------------------------------- tiers
const TIERS = [
  [0, 'Raw', 0], [1, 'Sheen', 1008], [2, 'Cast', 4032], [3, 'Verdigris', 12960],
  [4, 'Umber', 26280], [5, 'Bronze', 52560], [6, 'Oxide', 105120], [7, 'Elder', 210000],
];

// --------------------------------------------------------------- scan
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tools' || entry.name === 'assets') continue;
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = (await walk(ROOT)).sort();
const failures = [];
const found = new Set();
let runs = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  // Scanned as written. No hex value in these pages is wrapped across lines,
  // which is what makes a run of hex characters unambiguous.
  const text = await readFile(file, 'utf8');

  for (const m of text.matchAll(/[0-9a-f]{8,}/g)) {
    const run = m[0];
    runs += 1;
    const owners = VALUES.filter((v) => v.includes(run));
    if (!owners.length) {
      failures.push(`${rel}: hex run not derived from any computed value: ${run.slice(0, 72)}`);
    } else {
      for (const [name, value] of ALLOWED) if (owners.includes(value)) found.add(name);
    }
  }
}

// --------------------------------------------------- tier table arithmetic
const tierPage = await readFile(join(ROOT, 'protocol', 'depth-and-tiers.html'), 'utf8');
for (const [index, name, blocks] of TIERS) {
  const days = (blocks * 10 / 60 / 24).toFixed(2);
  const years = (blocks * 10 / 60 / 24 / 365.25).toFixed(2);
  const row = new RegExp(
    `<td>${index}</td><td>${name}</td><td>${blocks}</td><td>${days === '0.00' ? '0' : days}</td><td>${years === '0.00' ? '0' : years}</td>`
  );
  if (!row.test(tierPage.replace(/\s*\n\s*/g, ''))) {
    failures.push(`protocol/depth-and-tiers.html: tier row for ${name} does not match blocks ${blocks}, days ${days}, years ${years}`);
  }
}

console.log(`pages scanned            ${files.length}`);
console.log(`hex runs verified        ${runs}`);
console.log(`computed values in use   ${found.size} of ${ALLOWED.size}`);
console.log(`vector failures          ${failures.length}`);

const unused = [...ALLOWED.keys()].filter((k) => !found.has(k));
if (unused.length) console.log(`not printed anywhere:    ${unused.join(', ')}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
