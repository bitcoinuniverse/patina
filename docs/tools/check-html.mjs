#!/usr/bin/env node
// Structure and accessibility checker for the PATINA documentation.
// Not a full HTML validator. It checks the things that actually break these
// pages: unbalanced tags, stray markup characters, duplicate ids, missing shell
// parts, heading order, and unlabelled controls.
// Run: node docs/tools/check-html.mjs

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

const REQUIRED = [
  [/^<!doctype html>/i, 'doctype on the first line'],
  [/<html lang="[a-z-]+"/i, 'html element with a lang attribute'],
  [/<meta charset="utf-8">/i, 'charset declaration'],
  [/<meta name="viewport"[^>]*width=device-width/i, 'responsive viewport'],
  [/<title>[^<]+<\/title>/i, 'non empty title'],
  [/<meta name="description" content="[^"]{40,}"/i, 'description of at least 40 characters'],
  [/<body[^>]+data-page="[^"]+"/i, 'data-page on body'],
  [/<body[^>]+data-root="[^"]*"/i, 'data-root on body'],
  [/<a class="skip" href="#content">/, 'skip link'],
  [/<header class="topbar">/, 'topbar'],
  [/<aside class="sidebar" id="sidebar">/, 'sidebar mount'],
  [/<nav id="nav"[^>]*aria-label=/, 'labelled nav mount'],
  [/<main class="content" id="content">/, 'main content landmark'],
  [/<nav class="crumb" id="crumb"[^>]*aria-label=/, 'breadcrumb mount'],
  [/<nav class="pager" id="pager"[^>]*aria-label=/, 'pager mount'],
  [/<aside class="toc" id="toc"[^>]*aria-label=/, 'on this page mount'],
  [/<article>/, 'article element'],
  [/assets\/style\.css/, 'stylesheet link'],
  [/assets\/nav-data\.js/, 'nav data script'],
  [/assets\/search-index\.js/, 'search index script'],
  [/assets\/shell\.js/, 'shell script'],
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tools') continue;
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const files = (await walk(ROOT)).sort();
const failures = [];
let tagsChecked = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const text = await readFile(file, 'utf8');
  const fail = (msg) => failures.push(`${rel}: ${msg}`);

  for (const [re, name] of REQUIRED) {
    if (!re.test(text)) fail(`missing ${name}`);
  }

  // ---- tag balance
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    const [, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (VOID.has(name)) continue;
    if (attrs.trim().endsWith('/')) continue;
    tagsChecked += 1;
    if (!closing) {
      stack.push({ name, at: lineOf(text, m.index) });
    } else {
      const open = stack.pop();
      if (!open) fail(`line ${lineOf(text, m.index)}: closing </${name}> with nothing open`);
      else if (open.name !== name) {
        fail(`line ${lineOf(text, m.index)}: </${name}> closes <${open.name}> opened on line ${open.at}`);
      }
    }
  }
  for (const open of stack) fail(`line ${open.at}: <${open.name}> is never closed`);

  // ---- stray markup characters in text content
  const body = text.replace(/<[^>]*>/g, (t) => ' '.repeat(t.length));
  const amp = /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g;
  while ((m = amp.exec(body))) {
    fail(`line ${lineOf(text, m.index)}: bare & in text, write &amp;`);
  }
  const lt = /<(?![a-zA-Z/!])/g;
  while ((m = lt.exec(body))) {
    fail(`line ${lineOf(text, m.index)}: bare < in text, write &lt;`);
  }

  // ---- duplicate ids
  const seen = new Map();
  const idRe = /\sid="([^"]+)"/g;
  while ((m = idRe.exec(text))) {
    const id = m[1];
    if (seen.has(id)) fail(`duplicate id "${id}" on lines ${seen.get(id)} and ${lineOf(text, m.index)}`);
    else seen.set(id, lineOf(text, m.index));
  }

  // ---- headings
  const h1s = text.match(/<h1[^>]*>/g) || [];
  if (h1s.length !== 1) fail(`expected exactly one h1, found ${h1s.length}`);
  const order = [...text.matchAll(/<h([1-4])[^>]*>/g)].map((x) => Number(x[1]));
  for (let i = 1; i < order.length; i += 1) {
    if (order[i] > order[i - 1] + 1) fail(`heading level jumps from h${order[i - 1]} to h${order[i]}`);
  }

  // ---- accessibility
  for (const svg of text.match(/<svg[^>]*>/g) || []) {
    if (!/aria-hidden="true"/.test(svg) && !/role="img"/.test(svg)) {
      fail('svg without aria-hidden or role="img"');
    }
  }
  for (const img of text.match(/<img[^>]*>/g) || []) {
    if (!/\salt="/.test(img)) fail('img without alt text');
  }
  for (const btn of text.match(/<button[^>]*>\s*<\/button>/g) || []) {
    if (!/aria-label=/.test(btn)) fail('empty button without aria-label');
  }
  for (const input of text.match(/<input[^>]*>/g) || []) {
    const id = /\sid="([^"]+)"/.exec(input);
    const labelled = /aria-label=/.test(input) || (id && new RegExp(`<label for="${id[1]}"`).test(text));
    if (!labelled) fail(`input without a label: ${input.slice(0, 60)}`);
  }
  for (const table of text.match(/<table>[\s\S]*?<\/table>/g) || []) {
    if (!/<caption>/.test(table)) fail('table without a caption');
    if (!/<th[ >]/.test(table)) fail('table without header cells');
  }
  const anchors = text.match(/<a\s[^>]*>\s*<\/a>/g) || [];
  if (anchors.length) fail(`${anchors.length} empty link(s)`);
}

console.log(`pages checked      ${files.length}`);
console.log(`elements balanced  ${tagsChecked}`);
console.log(`structure failures ${failures.length}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
