#!/usr/bin/env node
// Reads the colour tokens out of assets/style.css and checks every pair the
// pages actually use against WCAG AA: 4.5 for body text, 3.0 for large text and
// interface edges. Both themes are checked.
// Run: node docs/tools/check-contrast.mjs

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const css = await readFile(join(ROOT, 'assets', 'style.css'), 'utf8');

function block(startRe) {
  const at = css.search(startRe);
  if (at < 0) throw new Error(`could not find block ${startRe}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open, close);
}

function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const dark = tokens(block(/^:root \{/m));
const light = tokens(block(/^:root\[data-theme="light"\] \{/m));

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

const TEXT = [
  ['ink', 'bg'], ['ink', 'bg-deep'], ['ink', 'surface'], ['ink', 'surface-2'],
  ['ink-2', 'bg'], ['ink-2', 'bg-deep'], ['ink-2', 'surface'], ['ink-2', 'surface-2'],
  ['ink-3', 'bg'], ['ink-3', 'bg-deep'], ['ink-3', 'surface'], ['ink-3', 'surface-2'],
  ['bronze', 'bg'], ['bronze', 'bg-deep'], ['bronze', 'surface'], ['bronze', 'surface-2'],
  ['verdigris', 'bg'], ['verdigris', 'surface'],
  ['alert', 'bg'], ['alert', 'surface'],
  ['umber', 'surface'],
  ['code-ink', 'code-bg'],
];

// Borders of interactive controls and the focus ring. Decorative hairlines
// (--rule, --rule-strong) are deliberately not in this list: they separate
// content, they do not bound a control.
const UI = [
  ['focus', 'bg'], ['focus', 'surface'], ['focus', 'bg-deep'],
  ['edge', 'bg'], ['edge', 'bg-deep'], ['edge', 'surface'], ['edge', 'surface-2'],
  ['bronze', 'surface'],
];

const failures = [];
const rows = [];

for (const [themeName, theme] of [['dark', dark], ['light', light]]) {
  for (const [set, floor, kind] of [[TEXT, 4.5, 'text'], [UI, 3.0, 'interface']]) {
    for (const [fg, bg] of set) {
      if (!theme[fg] || !theme[bg]) { failures.push(`${themeName}: missing token --${fg} or --${bg}`); continue; }
      const r = ratio(theme[fg], theme[bg]);
      rows.push([themeName, kind, `${fg} on ${bg}`, theme[fg], theme[bg], r.toFixed(2), r >= floor ? 'pass' : 'FAIL']);
      if (r < floor) failures.push(`${themeName}: ${fg} on ${bg} is ${r.toFixed(2)}, needs ${floor}`);
    }
  }
}

const worst = rows
  .filter((r) => r[1] === 'text')
  .sort((a, b) => Number(a[5]) - Number(b[5]))
  .slice(0, 6);

console.log(`pairs checked   ${rows.length}`);
console.log(`failures        ${failures.length}`);
console.log('\ntightest text pairs:');
for (const r of worst) console.log(`  ${r[0].padEnd(5)} ${r[2].padEnd(22)} ${r[3]} on ${r[4]}  ${r[5]}  ${r[6]}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
