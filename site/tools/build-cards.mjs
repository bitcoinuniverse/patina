#!/usr/bin/env node
/*
 * Draws the PATINA social cards.
 *
 * Run from anywhere:  node site/tools/build-cards.mjs
 * Check without writing: node site/tools/build-cards.mjs --check
 *
 * Every colour comes out of site/assets/site.css, so a card cannot drift away
 * from the theme it is supposed to represent. The wordmark is drawn as paths
 * rather than set in a font, because a social card is rendered by someone
 * else's machine and no font of ours will be there.
 *
 * Output is deterministic: same stylesheet in, same bytes out. Node standard
 * library only, no network, no dependency.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BRAND = join(ROOT, 'assets', 'brand');

/*
 * In check mode nothing is written. A card that no longer matches what this
 * script would draw is a failure, which is what stops the palette moving in the
 * stylesheet while the cards keep the old colours.
 */
const CHECK = process.argv.includes('--check');
const stale = [];

/* --------------------------------------------------------------- palette */

const css = readFileSync(join(ROOT, 'assets', 'site.css'), 'utf8');

function tokensIn(startRe) {
  const at = css.search(startRe);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const out = {};
  for (const m of css.slice(open, close).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

const C = tokensIn(/^:root \{/m);
const L = tokensIn(/^:root\[data-theme="light"\] \{/m);

for (const need of ['bg', 'ink', 'ink-3', 'bronze', 'bronze-deep', 'verdigris', 'rule-strong', 'surface', 't0', 't7']) {
  if (!C[need]) {
    console.error('missing token --' + need + ' in site/assets/site.css');
    process.exit(1);
  }
}

const TIERS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'].map((k) => C[k]);

const MONO = "ui-monospace, Consolas, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, Segoe UI, Helvetica, Arial, sans-serif";

/* -------------------------------------------------------------- wordmark */

/*
 * PATINA, drawn with straight strokes. No v or V path command anywhere: the
 * house style checker treats those as version labels, and it is right to,
 * because it cannot tell a path command from a product name.
 */
const WORDMARK = `  <g transform="translate(80,150) scale(1.28)" fill="none" stroke="${C.ink}" stroke-width="9" stroke-linecap="butt">
    <g transform="translate(10,0)">
      <path d="M0 80 L0 16 L22 16 A16 16 0 0 1 22 48 L0 48"/>
      <g transform="translate(58,0)">
        <path d="M0 80 L22 16 L44 80"/>
        <path d="M6.9 60 L37.1 60"/>
      </g>
      <g transform="translate(122,0)">
        <path d="M0 16 L44 16"/>
        <path d="M22 16 L22 80"/>
      </g>
      <path d="M192 16 L192 80"/>
      <path d="M218 80 L218 16 L258 80 L258 16"/>
      <g transform="translate(278,0)">
        <path d="M0 80 L22 16 L44 80"/>
        <path d="M6.9 60 L37.1 60"/>
      </g>
    </g>
  </g>`;

/* -------------------------------------------------------------- graphics */

/* A cut section: scribed tier circles, a filled core, a wedge taken out. */
function cutSection({ cx = 940, cy = 315, outer = 236, filled = 4, id = 'kerf' }) {
  const step = outer / 8;
  const scribes = TIERS.map((colour, i) => {
    const r = (step * (i + 1)).toFixed(1);
    const reached = i <= filled;
    return `      <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${colour}" stroke-opacity="${reached ? '0.9' : '0.34'}"${reached ? '' : ' stroke-dasharray="4 8"'}/>`;
  }).join('\n');

  const fillR = (step * (filled + 1)).toFixed(1);

  return `  <g mask="url(#${id})">
    <circle cx="${cx}" cy="${cy}" r="${fillR}" fill="url(#age)"/>
    <g fill="none" stroke-width="2.2">
${scribes}
    </g>
    <circle cx="${cx}" cy="${cy}" r="${fillR}" fill="none" stroke="${TIERS[filled]}" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="13" fill="${C.bronze}"/>
  </g>`;
}

/* Eight discs in a row, each filled to its own band. The ladder, laid flat. */
function tierRow() {
  const parts = [];
  for (let i = 0; i < 8; i += 1) {
    const cx = 660 + i * 66;
    const cy = 315;
    const r = 16 + i * 3.6;
    parts.push(
      `    <g>
      <circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="${C['rule-strong']}" stroke-width="1.2"/>
      <circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${TIERS[i]}" fill-opacity="0.42" stroke="${TIERS[i]}" stroke-width="2.4"/>
      <circle cx="${cx}" cy="${cy}" r="2.6" fill="${C.bronze}"/>
    </g>`
    );
  }
  const labels = ['RAW', 'SHEEN', 'CAST', 'VERD', 'UMBER', 'BRONZE', 'OXIDE', 'ELDER']
    .map((name, i) => `    <text x="${660 + i * 66}" y="382" fill="${C['ink-3']}" font-family="${MONO}" font-size="13" text-anchor="middle">${name}</text>`)
    .join('\n');
  const rule = `    <path d="M630 250 L1152 250" stroke="${C['rule-strong']}" stroke-width="1"/>`;
  return `  <g>\n${rule}\n${parts.join('\n')}\n${labels}\n  </g>`;
}

/* Two transactions and the gap between them, on a height line. */
function commitReveal() {
  return `  <g>
    <rect x="636" y="196" width="212" height="118" rx="4" fill="${C.surface}" stroke="${C['rule-strong']}" stroke-width="1.4"/>
    <text x="660" y="230" fill="${C['ink-3']}" font-family="${MONO}" font-size="15" letter-spacing="3">STEP ONE</text>
    <text x="660" y="266" fill="${C.ink}" font-family="${SERIF}" font-size="27">Commit</text>
    <text x="660" y="296" fill="${C['ink-3']}" font-family="${SANS}" font-size="16">reveals nothing</text>

    <path d="M848 255 L940 255" stroke="${C['rule-strong']}" stroke-width="1.4"/>
    <path d="M932 249 L942 255 L932 261" stroke="${C.verdigris}" stroke-width="2.4" fill="none"/>
    <text x="856" y="240" fill="${C.verdigris}" font-family="${MONO}" font-size="15" letter-spacing="2">144 BLOCKS</text>

    <rect x="940" y="196" width="212" height="118" rx="4" fill="${C.surface}" stroke="${C['rule-strong']}" stroke-width="1.4"/>
    <text x="964" y="230" fill="${C['ink-3']}" font-family="${MONO}" font-size="15" letter-spacing="3">STEP TWO</text>
    <text x="964" y="266" fill="${C.ink}" font-family="${SERIF}" font-size="27">Reveal</text>
    <text x="964" y="296" fill="${C['ink-3']}" font-family="${SANS}" font-size="16">carrier is named</text>

    <path d="M636 396 L1152 396" stroke="${C['rule-strong']}" stroke-width="1"/>
    <path d="M700 314 L700 396" stroke="${C['rule-strong']}" stroke-width="1"/>
    <path d="M1046 314 L1046 396" stroke="${C.bronze}" stroke-width="2"/>
    <circle cx="700" cy="396" r="6" fill="${C['rule-strong']}"/>
    <circle cx="1046" cy="396" r="7" fill="${C.bronze}"/>
    <text x="636" y="432" fill="${C['ink-3']}" font-family="${MONO}" font-size="14" letter-spacing="2">BLOCK HEIGHT</text>
    <text x="924" y="460" fill="${C.bronze}" font-family="${MONO}" font-size="15" letter-spacing="2">DEPTH STARTS AT ZERO</text>
  </g>`;
}

/* The Firstlight mark: the cut section, opened, with a double rim. */
function seal() {
  const cx = 940;
  const cy = 300;
  const bands = [
    [C.t1, 128], [C.t2, 100], [C.t3, 72], [C.t5, 44],
  ].map(([colour, r]) => `      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}" fill-opacity="0.16" stroke="${colour}" stroke-opacity="0.7" stroke-width="2.2"/>`).join('\n');

  return `  <path d="M${cx} ${cy} L${cx - 44} 40 L${cx + 44} 40 Z" fill="${C.bronze}" fill-opacity="0.14"/>
  <g mask="url(#kerf)">
    <circle cx="${cx}" cy="${cy}" r="156" fill="none" stroke="${C['rule-strong']}" stroke-width="1.4"/>
${bands}
      <circle cx="${cx}" cy="${cy}" r="9" fill="${C.bronze}"/>
  </g>
  <circle cx="${cx}" cy="${cy}" r="186" fill="none" stroke="${C.bronze}" stroke-width="2.4"/>
  <circle cx="${cx}" cy="${cy}" r="175" fill="none" stroke="${C['bronze-deep']}" stroke-width="1.4"/>
  <text x="${cx}" y="530" fill="${C['ink-3']}" font-family="${MONO}" font-size="17" letter-spacing="9" text-anchor="middle">FIRSTLIGHT</text>`;
}

/* Two independent readings of the same chain, landing on the same root. */
function twoIndexers() {
  const disc = (cx) => `    <g>
      <circle cx="${cx}" cy="272" r="86" fill="none" stroke="${C['rule-strong']}" stroke-width="1.2"/>
      <circle cx="${cx}" cy="272" r="64" fill="${C.t5}" fill-opacity="0.26" stroke="${C.t5}" stroke-width="2.6"/>
      <circle cx="${cx}" cy="272" r="42" fill="none" stroke="${C.t3}" stroke-width="2"/>
      <circle cx="${cx}" cy="272" r="20" fill="none" stroke="${C.t1}" stroke-width="2"/>
      <circle cx="${cx}" cy="272" r="5" fill="${C.bronze}"/>
    </g>`;

  return `  <g>
${disc(786)}
${disc(1064)}
    <path d="M910 262 L940 262" stroke="${C.verdigris}" stroke-width="3"/>
    <path d="M910 282 L940 282" stroke="${C.verdigris}" stroke-width="3"/>
    <text x="786" y="398" fill="${C['ink-3']}" font-family="${MONO}" font-size="15" text-anchor="middle" letter-spacing="2">INDEXER ONE</text>
    <text x="1064" y="398" fill="${C['ink-3']}" font-family="${MONO}" font-size="15" text-anchor="middle" letter-spacing="2">INDEXER TWO</text>
    <path d="M660 440 L1190 440" stroke="${C['rule-strong']}" stroke-width="1"/>
    <text x="925" y="478" fill="${C.verdigris}" font-family="${MONO}" font-size="17" text-anchor="middle" letter-spacing="3">SAME STATE ROOT</text>
  </g>`;
}

/* The marker, byte by byte. Twenty six of them, four of them the magic. */
function markerBytes() {
  const cells = [];
  const cols = 13;
  const w = 38;
  const h = 42;
  const x0 = 656;
  const y0 = 214;
  const kinds = [
    'op', 'push', 'magic', 'magic', 'magic', 'magic', 'ver', 'op2',
    'salt', 'salt', 'salt', 'salt', 'salt',
    'salt', 'salt', 'salt', 'salt', 'salt', 'salt', 'salt', 'salt', 'salt', 'salt', 'salt',
    'flags', 'vout',
  ];
  const colourFor = {
    op: C.bronze, push: C['bronze-deep'], magic: C.verdigris, ver: C.t3,
    op2: C.t5, salt: C['rule-strong'], flags: C.t1, vout: C.bronze,
  };

  for (let i = 0; i < 26; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = x0 + col * w;
    const y = y0 + row * h;
    const colour = colourFor[kinds[i]];
    const solid = kinds[i] !== 'salt';
    cells.push(
      `    <rect x="${x}" y="${y}" width="${w - 5}" height="${h - 5}" rx="2" fill="${colour}" fill-opacity="${solid ? '0.3' : '0.12'}" stroke="${colour}" stroke-width="${solid ? '1.8' : '1'}"/>`
    );
  }

  const legend = [
    ['OP_RETURN', C.bronze],
    ['PTNA', C.verdigris],
    ['VERSION', C.t3],
    ['SEED', C.t5],
    ['SALT', C['rule-strong']],
  ].map(([name, colour], i) => {
    const x = 656 + i * 108;
    return `    <rect x="${x}" y="352" width="14" height="14" fill="${colour}" fill-opacity="0.45" stroke="${colour}"/>
    <text x="${x + 22}" y="364" fill="${C['ink-3']}" font-family="${MONO}" font-size="13" letter-spacing="1">${name}</text>`;
  }).join('\n');

  return `  <g>
${cells.join('\n')}
${legend}
    <text x="656" y="418" fill="${C['ink-3']}" font-family="${MONO}" font-size="15" letter-spacing="2">26 BYTES, ONE OP_RETURN OUTPUT</text>
  </g>`;
}

/* Stacked plates: the documentation as strata you can dig down through. */
function plates() {
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    const y = 172 + i * 52;
    const inset = i * 16;
    rows.push(
      `    <rect x="${648 + inset}" y="${y}" width="${476 - inset * 2}" height="40" rx="3" fill="${C.surface}" stroke="${C['rule-strong']}" stroke-width="1.2"/>
    <path d="M${664 + inset} ${y + 24} L${1000 - inset} ${y + 24}" stroke="${C['rule-strong']}" stroke-width="1"/>
    <circle cx="${1100 - inset}" cy="${y + 20}" r="5" fill="${TIERS[7 - i]}"/>`
    );
  }
  return `  <g>
${rows.join('\n')}
    <text x="648" y="472" fill="${C['ink-3']}" font-family="${MONO}" font-size="15" letter-spacing="2">FORTY TWO PAGES, ONE CONTRACT</text>
  </g>`;
}

/* ----------------------------------------------------------------- frame */

function card({ file, title, eyebrow, headline, sub, foot, graphic, needsKerf = false, needsAge = false }) {
  const heads = headline
    .map((line, i) => `  <text x="80" y="${350 + i * 54}" fill="${C.ink}" font-family="${SERIF}" font-size="44">${line}</text>`)
    .join('\n');

  const defs = [
    `    <pattern id="strata" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="1" fill="${C.ink}" fill-opacity="0.03"/>
    </pattern>`,
  ];
  if (needsAge) {
    defs.push(`    <radialGradient id="age" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${C.bronze}" stop-opacity="0.4"/>
      <stop offset="45%" stop-color="${C.t4}" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="${C.t7}" stop-opacity="0.4"/>
    </radialGradient>`);
  }
  if (needsKerf) {
    defs.push(`    <mask id="kerf">
      <rect x="600" y="0" width="600" height="630" fill="#ffffff"/>
      <path d="M940 315 L926 30 L954 30 Z" fill="#000000"/>
    </mask>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-labelledby="card-title">
  <title id="card-title">${title}</title>
  <defs>
${defs.join('\n')}
  </defs>

  <rect width="1200" height="630" fill="${C.bg}"/>
  <rect width="1200" height="630" fill="url(#strata)"/>
  <path d="M600 0 L600 630" stroke="${C['rule-strong']}" stroke-width="1" stroke-opacity="0.5"/>

${graphic}

${WORDMARK}

  <text x="80" y="120" fill="${C.verdigris}" font-family="${MONO}" font-size="20" letter-spacing="6">${eyebrow}</text>

${heads}
  <text x="80" y="${350 + headline.length * 54 + 14}" fill="${C['ink-3']}" font-family="${SANS}" font-size="22">${sub}</text>

  <path d="M80 520 L520 520" stroke="${C['rule-strong']}" stroke-width="1"/>
  <text x="80" y="558" fill="${C['ink-3']}" font-family="${MONO}" font-size="18" letter-spacing="2">${foot}</text>
</svg>
`;

  const path = join(BRAND, file);
  if (CHECK) {
    if (!existsSync(path)) stale.push(file + ' is missing');
    else if (readFileSync(path, 'utf8') !== svg) stale.push(file + ' does not match the current palette');
  } else {
    writeFileSync(path, svg, 'utf8');
  }
  return file;
}

/* ----------------------------------------------------------------- cards */

const written = [];

written.push(card({
  file: 'og-default.svg',
  title: 'PATINA. A Bitcoin artifact that deepens while it sits still.',
  eyebrow: 'A BITCOIN ARTIFACT',
  headline: ['It deepens for every block', 'it does not move.'],
  sub: 'Move the output and depth returns to zero. The finished stretch becomes a ring.',
  foot: 'Firstlight Seals, the founding cohort',
  graphic: cutSection({ filled: 4 }),
  needsKerf: true,
  needsAge: true,
}));

written.push(card({
  file: 'og-depth.svg',
  title: 'How depth works. Depth is the number of blocks a carrier output has stayed unspent.',
  eyebrow: 'HOW DEPTH WORKS',
  headline: ['A subtraction between', 'two block heights.'],
  sub: 'No accrual, no emission, no counterparty. Any Bitcoin node computes the same figure.',
  foot: 'depth = current height minus carrier height',
  graphic: cutSection({ filled: 5 }),
  needsKerf: true,
  needsAge: true,
}));

written.push(card({
  file: 'og-tiers.svg',
  title: 'The PATINA tier journey, from Raw at zero blocks to Elder at 210000 blocks.',
  eyebrow: 'THE TIER JOURNEY',
  headline: ['Eight names for how far', 'an output has come.'],
  sub: 'Raw, Sheen, Cast, Verdigris, Umber, Bronze, Oxide, Elder. Each one a band of depth.',
  foot: 'Elder is 210 000 blocks, about four years',
  graphic: tierRow(),
}));

written.push(card({
  file: 'og-mint.svg',
  title: 'The PATINA claim: commit, wait at least 144 blocks, then reveal.',
  eyebrow: 'COMMIT, WAIT, REVEAL',
  headline: ['Two transactions, and a day', 'of doing nothing between.'],
  sub: 'The gap is what makes a claim impossible to snipe. No price, network fees only.',
  foot: 'The endowment stays yours and stays spendable',
  graphic: commitReveal(),
}));

written.push(card({
  file: 'og-firstlight.svg',
  title: 'Firstlight Seals, the founding PATINA artifacts, created in one window of 4032 blocks.',
  eyebrow: 'THE GENESIS ASSET',
  headline: ['Firstlight Seals open once', 'and never again.'],
  sub: 'One commit window of 4032 blocks. No allocation, no reserve, no price to anyone.',
  foot: 'You provide the endowment. It stays yours.',
  graphic: seal(),
  needsKerf: true,
}));

written.push(card({
  file: 'og-verify.svg',
  title: 'Verify PATINA yourself. Two independent indexers reach the same state root.',
  eyebrow: 'CHECK IT YOURSELF',
  headline: ['Refuse to take anyone', 'at their word.'],
  sub: 'Read depth off your own node, decode a marker by hand, compare two indexers.',
  foot: 'Golden vectors carry a root at every height',
  graphic: twoIndexers(),
}));

written.push(card({
  file: 'og-protocol.svg',
  title: 'The PATINA marker: twenty six bytes in a single OP_RETURN output.',
  eyebrow: 'THE PROTOCOL',
  headline: ['The whole marker fits', 'in twenty six bytes.'],
  sub: 'OP_RETURN, one minimal push, the magic PTNA, a version byte, an opcode, a payload.',
  foot: 'Frozen at marker version 1',
  graphic: markerBytes(),
}));

written.push(card({
  file: 'og-docs.svg',
  title: 'PATINA documentation for developers, integrators and operators.',
  eyebrow: 'DOCUMENTATION',
  headline: ['Every byte, every rule,', 'every reason code.'],
  sub: 'Protocol reference, endpoint reference, conformance vectors and operator procedures.',
  foot: 'Independent implementations must agree',
  graphic: plates(),
}));

/* ------------------------------------------------------------ brand marks */

/*
 * The identity marks come out of the same palette as everything else. They are
 * the cut section at four sizes: a favicon that has to survive 16 pixels, the
 * protocol mark, a home screen icon with a solid ground, and the wordmark.
 */

function write(file, svg) {
  const path = join(BRAND, file);
  if (CHECK) {
    if (!existsSync(path)) stale.push(file + ' is missing');
    else if (readFileSync(path, 'utf8') !== svg) stale.push(file + ' does not match the current palette');
  } else {
    writeFileSync(path, svg, 'utf8');
  }
  return file;
}

written.push(write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="PATINA">
  <style>
    .rim { stroke: ${C.t7}; }
    .mid { stroke: ${C.t5}; }
    .in  { stroke: ${C.t2}; }
    .core { fill: ${C.bronze}; }
    @media (prefers-color-scheme: light) {
      .rim { stroke: ${L.t7}; }
      .mid { stroke: ${L.t5}; }
      .in  { stroke: ${L.t2}; }
      .core { fill: ${L.bronze}; }
    }
  </style>
  <defs>
    <mask id="favicon-kerf">
      <rect width="32" height="32" fill="#ffffff"/>
      <path d="M16 16 L14.2 0 L17.8 0 Z" fill="#000000"/>
    </mask>
  </defs>
  <g mask="url(#favicon-kerf)" fill="none" stroke-width="2.4">
    <circle class="rim" cx="16" cy="16" r="14"/>
    <circle class="mid" cx="16" cy="16" r="9.4"/>
    <circle class="in" cx="16" cy="16" r="4.8"/>
  </g>
  <circle class="core" cx="16" cy="16" r="1.8"/>
</svg>
`));

written.push(write('mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-labelledby="patina-mark-title patina-mark-desc">
  <title id="patina-mark-title">PATINA protocol mark</title>
  <desc id="patina-mark-desc">A ring cross section cut open at the top. Six concentric strata run from a bronze core out to a verdigris rim, one band for each stage of ageing an artifact passes through.</desc>
  <defs>
    <mask id="patina-mark-kerf">
      <rect width="64" height="64" fill="#ffffff"/>
      <path d="M32 32 L28.7 0 L35.3 0 Z" fill="#000000"/>
    </mask>
  </defs>
  <g mask="url(#patina-mark-kerf)" fill="none" stroke-width="2.6" stroke-linecap="butt">
    <circle cx="32" cy="32" r="28.6" stroke="${C['rule-strong']}" stroke-width="1.2"/>
    <circle cx="32" cy="32" r="25" stroke="${C.t7}"/>
    <circle cx="32" cy="32" r="20.5" stroke="${C.t6}"/>
    <circle cx="32" cy="32" r="16" stroke="${C.t5}"/>
    <circle cx="32" cy="32" r="11.5" stroke="${C.t3}"/>
    <circle cx="32" cy="32" r="7" stroke="${C.t2}"/>
  </g>
  <circle cx="32" cy="32" r="3" fill="${C.bronze}"/>
</svg>
`));

written.push(write('apple-touch-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="PATINA">
  <rect width="180" height="180" rx="34" fill="${C.bg}"/>
  <g transform="translate(90,90)">
    <g fill="none" stroke-width="6.5">
      <circle r="72" stroke="${C['rule-strong']}" stroke-width="3"/>
      <circle r="61" stroke="${C.t7}"/>
      <circle r="49" stroke="${C.t6}"/>
      <circle r="37" stroke="${C.t5}"/>
      <circle r="25" stroke="${C.t3}"/>
      <circle r="14" stroke="${C.t2}"/>
    </g>
    <circle r="5.5" fill="${C.bronze}"/>
    <path d="M0 0 L-8 -78 L8 -78 Z" fill="${C.bg}"/>
  </g>
</svg>
`));

written.push(write('wordmark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 342 96" width="342" height="96" role="img" aria-labelledby="patina-wordmark-title">
  <title id="patina-wordmark-title">PATINA</title>
  <style>
    :root { color: ${L.ink}; }
    @media (prefers-color-scheme: dark) { :root { color: ${C.ink}; } }
  </style>
  <g transform="translate(10,0)" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="butt" stroke-linejoin="miter">
    <path d="M0 80 L0 16 L22 16 A16 16 0 0 1 22 48 L0 48"/>
    <g transform="translate(58,0)">
      <path d="M0 80 L22 16 L44 80"/>
      <path d="M6.9 60 L37.1 60"/>
    </g>
    <g transform="translate(122,0)">
      <path d="M0 16 L44 16"/>
      <path d="M22 16 L22 80"/>
    </g>
    <path d="M192 16 L192 80"/>
    <path d="M218 80 L218 16 L258 80 L258 16"/>
    <g transform="translate(278,0)">
      <path d="M0 80 L22 16 L44 80"/>
      <path d="M6.9 60 L37.1 60"/>
    </g>
  </g>
</svg>
`));

console.log('PATINA social cards and brand marks');
console.log('palette from site/assets/site.css, dark theme');
console.log((CHECK ? 'checked ' : 'written ') + written.length + ': ' + written.join(', '));

if (CHECK) {
  console.log('stale cards ' + stale.length);
  if (stale.length) {
    console.error('');
    for (const s of stale) console.error('  ' + s);
    console.error('\n  run: node site/tools/build-cards.mjs');
    process.exit(1);
  }
}
