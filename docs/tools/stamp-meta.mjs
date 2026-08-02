#!/usr/bin/env node
// Writes the sharing metadata and the scriptless navigation into every
// documentation page.
//
// Run: node docs/tools/stamp-meta.mjs
//
// Titles and descriptions belong to each page and are read out of it, never
// invented here. Everything else is derived: the canonical URL and og:url come
// from the file path, and the social card comes from the section the page sits
// in, so a page can never point at a card for a different subject.
//
// The second block is a noscript contents list. The sidebar, the breadcrumb and
// the pager are all built by assets/shell.js, so without scripts a reader would
// otherwise land on a page with no way out of it. The list is generated from
// the same nav data the shell uses, so the two can never disagree.
//
// Both blocks are delimited, so rerunning replaces them rather than stacking
// copies. docs/tools/check-html.mjs proves the result is present and consistent
// on every page, which is what makes this safe to rerun.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SITE = join(resolve(ROOT, '..'), 'site');
const ORIGIN = 'https://bitcoinuniverse.github.io/patina/';

const OPEN = '<!-- sharing metadata, written by docs/tools/stamp-meta.mjs -->';
const CLOSE = '<!-- end sharing metadata -->';
const NAV_OPEN = '<!-- scriptless contents, written by docs/tools/stamp-meta.mjs -->';
const NAV_CLOSE = '<!-- end scriptless contents -->';

function delimited(open, close) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(esc(open) + '[\\s\\S]*?' + esc(close));
}

/* Which card fits which section. One card per subject, never a generic banner. */
const CARDS = {
  start: 'og-firstlight.svg',
  using: 'og-mint.svg',
  protocol: 'og-protocol.svg',
  api: 'og-docs.svg',
  compat: 'og-docs.svg',
  operator: 'og-docs.svg',
  creator: 'og-tiers.svg',
  launch: 'og-docs.svg',
  reference: 'og-docs.svg',
};

const CARD_ALT = {
  'og-firstlight.svg': 'The Firstlight seal mark, a cut section with its kerf opened so light reaches the core.',
  'og-mint.svg': 'Two transactions on a block height line with a gap of at least 144 blocks between them.',
  'og-protocol.svg': 'The twenty six bytes of a PATINA marker, drawn as a grid with the magic bytes picked out.',
  'og-tiers.svg': 'Eight tier discs in a row, from cold raw metal through cast bronze and earth into deep verdigris.',
  'og-docs.svg': 'Stacked engraved plates, one per section of the PATINA documentation.',
  'og-depth.svg': 'A PATINA artifact record with its depth, tier and completed rings labelled beside a cut section.',
};

/* Where each page sits, read from the same list the shell navigates by. */
const navSrc = await readFile(join(ROOT, 'assets', 'nav-data.js'), 'utf8');
const fake = {};
new Function('window', navSrc)(fake);

const SECTION_OF = new Map();
for (const section of fake.PATINA_NAV) {
  for (const page of section.pages) SECTION_OF.set(page.path, section.id);
}

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

function pick(html, re) {
  const m = html.match(re);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function escapeAttr(s) {
  return s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;').replace(/"/g, '&quot;');
}

const files = (await walk(ROOT)).sort();
const problems = [];
let stamped = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  let html = await readFile(file, 'utf8');

  const title = pick(html, /<title>([^<]+)<\/title>/i);
  const description = pick(html, /<meta name="description" content="([^"]+)"/i);

  if (!title) { problems.push(`${rel}: no title to derive metadata from`); continue; }
  if (description.length < 40) { problems.push(`${rel}: description is too short to share`); continue; }

  const section = SECTION_OF.get(rel);
  if (!section) { problems.push(`${rel}: not listed in assets/nav-data.js`); continue; }

  const card = CARDS[section];
  if (!existsSync(join(SITE, 'assets', 'brand', card))) {
    problems.push(`${rel}: the card ${card} does not exist in site/assets/brand`);
    continue;
  }

  const url = ORIGIN + 'docs/' + rel;
  const image = ORIGIN + 'assets/brand/' + card;
  const shortTitle = title.replace(/\s*\|\s*PATINA docs$/, '');

  const block = [
    OPEN,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="PATINA">`,
    `<meta property="og:title" content="${escapeAttr(shortTitle)}, PATINA documentation">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:alt" content="${escapeAttr(CARD_ALT[card])}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(shortTitle)}, PATINA documentation">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="theme-color" content="#14110d">`,
    `<link rel="icon" href="${'../'.repeat(rel.split('/').length - 1)}../assets/brand/favicon.svg" type="image/svg+xml">`,
    CLOSE,
  ].join('\n');

  const existing = delimited(OPEN, CLOSE);

  if (existing.test(html)) {
    html = html.replace(existing, block);
  } else {
    const anchor = /<link rel="stylesheet" href="[^"]*style\.css">/;
    if (!anchor.test(html)) { problems.push(`${rel}: no stylesheet link to anchor the metadata to`); continue; }
    html = html.replace(anchor, (m) => block + '\n' + m);
  }

  /* The contents list, for a reader whose browser is not running our scripts. */
  const up = '../'.repeat(rel.split('/').length - 1);
  const sections = fake.PATINA_NAV.map((section) => {
    const items = section.pages
      .map((page) => `      <li><a href="${up}${page.path}">${page.title}</a></li>`)
      .join('\n');
    return `    <h2>${section.title}</h2>\n    <ul>\n${items}\n    </ul>`;
  }).join('\n');

  const navBlock = [
    NAV_OPEN,
    '<noscript>',
    '  <nav class="noscript-nav" aria-label="Documentation contents">',
    `    <p>The contents list, the breadcrumb and the previous and next links on this site are built by a small script. With scripts unavailable, here is every page.</p>`,
    `    <p><a href="${up}../index.html">The public PATINA site</a></p>`,
    sections,
    '  </nav>',
    '</noscript>',
    NAV_CLOSE,
  ].join('\n');

  const navExisting = delimited(NAV_OPEN, NAV_CLOSE);
  if (navExisting.test(html)) {
    html = html.replace(navExisting, navBlock);
  } else {
    const anchor = /<aside class="sidebar" id="sidebar">[\s\S]*?<\/aside>/;
    if (!anchor.test(html)) { problems.push(`${rel}: no sidebar to anchor the scriptless contents to`); continue; }
    html = html.replace(anchor, (m) => m + '\n' + navBlock);
  }

  await writeFile(file, html, 'utf8');
  stamped += 1;
}

console.log(`pages stamped      ${stamped}`);
console.log(`problems           ${problems.length}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
