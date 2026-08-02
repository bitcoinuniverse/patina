#!/usr/bin/env node
// Link checker for the PATINA documentation.
// Every href and src must resolve to a real file. Fragments must match an id
// that exists, or a heading the shell will give that id at runtime.
// No network requests are made, and none are needed: these pages link to
// nothing outside the two directories the project publishes.
//
// The publish step copies site/ to the root of the published tree and docs/ to
// <root>/docs, so a documentation page that reaches one level above the docs
// root lands on the public site. Those links are allowed and are resolved
// against site/ here, because the two trees are one product and a reader deep
// in the protocol reference has to be able to get back out. Nothing may escape
// further than that, and a target that does not exist is still a failure.
// Run: node docs/tools/check-links.mjs

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = resolve(ROOT, '..');
const SITE = join(REPO, 'site');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tools') continue;
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function idsOf(html) {
  const ids = new Set();
  const explicit = /\sid="([^"]+)"/g;
  let m;
  while ((m = explicit.exec(html))) ids.add(m[1]);
  // The shell assigns ids to h2 and h3 from their text at runtime.
  const heads = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = heads.exec(html))) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) ids.add(slug(text));
  }
  return ids;
}

const files = (await walk(ROOT)).sort();
const cache = new Map();
async function html(file) {
  if (!cache.has(file)) cache.set(file, await readFile(file, 'utf8'));
  return cache.get(file);
}

let checked = 0;
let external = 0;
let crossed = 0;
const broken = [];

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const source = await html(file);
  const re = /\s(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(source))) {
    const raw = m[1];
    if (/^(https?:|mailto:|tel:|data:)/i.test(raw)) { external += 1; continue; }
    checked += 1;

    const [pathPart, fragment] = raw.split('#');
    let target = file;

    if (pathPart) {
      target = resolve(dirname(file), pathPart);
      if (!target.startsWith(ROOT)) {
        /*
         * A link that climbs above the docs root lands on the public site once
         * published, because docs/ sits inside the site root there. On disk the
         * two are siblings, so re-root the remainder at site/ and check that.
         * Anything that leaves the repository is a mistake wherever it points.
         */
        const above = relative(REPO, target);
        if (above.startsWith('..') || !above) {
          broken.push(`${rel} -> ${raw} (escapes the repository)`);
          continue;
        }
        target = join(SITE, above);
        crossed += 1;
      }
      try {
        const info = await stat(target);
        if (!info.isFile()) { broken.push(`${rel} -> ${raw} (not a file)`); continue; }
      } catch {
        broken.push(`${rel} -> ${raw} (missing)`);
        continue;
      }
    }

    if (fragment) {
      if (!target.endsWith('.html')) { broken.push(`${rel} -> ${raw} (fragment on a non page)`); continue; }
      const ids = idsOf(await html(target));
      if (!ids.has(fragment)) broken.push(`${rel} -> ${raw} (no such id or heading)`);
    }
  }
}

console.log(`pages scanned      ${files.length}`);
console.log(`internal links     ${checked}`);
console.log(`external links     ${external}`);
console.log(`links to the site  ${crossed}`);
console.log(`broken links       ${broken.length}`);

if (broken.length) {
  console.error('');
  for (const b of broken) console.error('  ' + b);
  process.exit(1);
}
