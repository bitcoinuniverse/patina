#!/usr/bin/env node
// Reads the colour tokens out of the two stylesheets that make up PATINA and
// checks every pair the pages actually use against WCAG AA: 4.5 for body text,
// 3.0 for large text and interface edges. Both themes, both stylesheets.
//
// docs/assets/style.css and site/assets/site.css declare the same token names
// with the same values on purpose. Checking both here means a colour change on
// the public site cannot quietly fall below the bar the documentation holds.
// Run: node docs/tools/check-contrast.mjs

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = resolve(ROOT, '..');

const SHEETS = [
  ['docs', join(ROOT, 'assets', 'style.css')],
  ['site', join(REPO, 'site', 'assets', 'site.css')],
];

function block(css, startRe, where) {
  const at = css.search(startRe);
  if (at < 0) throw new Error(`could not find block ${startRe} in ${where}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open, close);
}

function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hexColour) {
  const n = parseInt(hexColour.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const TIERS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];

// Body text pairs. Every one of these is a real foreground on a real ground.
const TEXT = [
  ['ink', 'bg'], ['ink', 'bg-deep'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink', 'plate'],
  ['ink-2', 'bg'], ['ink-2', 'bg-deep'], ['ink-2', 'surface'], ['ink-2', 'surface-2'], ['ink-2', 'plate'],
  ['ink-3', 'bg'], ['ink-3', 'bg-deep'], ['ink-3', 'surface'], ['ink-3', 'surface-2'], ['ink-3', 'plate'],
  ['bronze', 'bg'], ['bronze', 'bg-deep'], ['bronze', 'surface'], ['bronze', 'surface-2'], ['bronze', 'plate'],
  ['verdigris', 'bg'], ['verdigris', 'surface'], ['verdigris', 'surface-2'],
  ['alert', 'bg'], ['alert', 'surface'],
  ['umber', 'surface'], ['umber', 'surface-2'],
  ['code-ink', 'code-bg'],
  // Tier names are set in their own tier colour on every ground that carries one.
  ...TIERS.flatMap((t) => [[t, 'surface'], [t, 'surface-2'], [t, 'plate'], [t, 'bg']]),
];

// Borders of interactive controls and the focus ring. Decorative hairlines
// (--rule, --rule-strong) are deliberately not in this list: they separate
// content, they do not bound a control.
const UI = [
  ['focus', 'bg'], ['focus', 'surface'], ['focus', 'bg-deep'],
  ['edge', 'bg'], ['edge', 'bg-deep'], ['edge', 'surface'], ['edge', 'surface-2'],
  ['bronze', 'surface'],
  ['verdigris-deep', 'surface'],
  ['code-accent', 'code-bg'],
];

const failures = [];
const rows = [];

for (const [sheetName, path] of SHEETS) {
  const css = await readFile(path, 'utf8');
  const themes = [
    ['dark', tokens(block(css, /^:root \{/m, sheetName))],
    ['light', tokens(block(css, /^:root\[data-theme="light"\] \{/m, sheetName))],
  ];

  for (const [themeName, theme] of themes) {
    for (const [set, floor, kind] of [[TEXT, 4.5, 'text'], [UI, 3.0, 'interface']]) {
      for (const [fg, bg] of set) {
        if (!theme[fg] || !theme[bg]) {
          failures.push(`${sheetName} ${themeName}: missing token --${fg} or --${bg}`);
          continue;
        }
        const r = ratio(theme[fg], theme[bg]);
        rows.push([sheetName, themeName, kind, `${fg} on ${bg}`, theme[fg], theme[bg], r.toFixed(2), r >= floor ? 'pass' : 'FAIL']);
        if (r < floor) failures.push(`${sheetName} ${themeName}: ${fg} on ${bg} is ${r.toFixed(2)}, needs ${floor}`);
      }
    }
  }
}

// The two sheets must agree, token for token, on everything they share.
const shared = [];
{
  const read = async (path) => {
    const css = await readFile(path, 'utf8');
    return {
      dark: tokens(block(css, /^:root \{/m, path)),
      light: tokens(block(css, /^:root\[data-theme="light"\] \{/m, path)),
    };
  };
  const a = await read(SHEETS[0][1]);
  const b = await read(SHEETS[1][1]);
  for (const theme of ['dark', 'light']) {
    for (const name of Object.keys(a[theme])) {
      if (!(name in b[theme])) continue;
      shared.push(name);
      if (a[theme][name] !== b[theme][name]) {
        failures.push(`shared token --${name} differs in ${theme}: docs ${a[theme][name]}, site ${b[theme][name]}`);
      }
    }
  }
}

const worst = rows
  .filter((r) => r[2] === 'text')
  .sort((a, b) => Number(a[6]) - Number(b[6]))
  .slice(0, 8);

console.log(`pairs checked   ${rows.length}`);
console.log(`shared tokens   ${new Set(shared).size}`);
console.log(`failures        ${failures.length}`);
console.log('\ntightest text pairs:');
for (const r of worst) console.log(`  ${r[0].padEnd(4)} ${r[1].padEnd(5)} ${r[3].padEnd(22)} ${r[4]} on ${r[5]}  ${r[6]}  ${r[7]}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
