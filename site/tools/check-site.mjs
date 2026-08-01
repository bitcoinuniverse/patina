#!/usr/bin/env node
/*
 * PATINA site checker.
 *
 * Run from anywhere:  node tools/check-site.mjs
 *
 * What it checks, per page:
 *   1. every internal link and asset reference resolves to a file that exists
 *   2. every fragment target exists in the page it points at
 *   3. a non empty title
 *   4. a meta description
 *   5. Open Graph title, description, url and image, plus a Twitter card
 *   6. the Open Graph image resolves to a real file in this directory
 *   7. exactly one h1
 *   8. no em dash anywhere in the file
 *   9. no occurrence of the string "v1"
 *  10. structural sanity: doctype, html lang, balanced tags, unique ids,
 *      an alt attribute on every img
 *
 * Check 10 is a structural pass written here, not a full W3C validation.
 * There is no network access and no dependency to install.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SITE_ORIGIN = 'https://bitcoinuniverse.github.io/patina/';

const EM_DASH = '—';
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);
const EXTERNAL = /^(https?:|mailto:|tel:|data:|javascript:)/i;

const problems = [];
const notes = [];
let checksRun = 0;

function fail(file, message) {
  problems.push({ file, message });
}

function check(condition, file, message) {
  checksRun += 1;
  if (!condition) {
    fail(file, message);
  }
  return condition;
}

/* ------------------------------------------------------------- collectors */

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = listFiles(ROOT);
const htmlFiles = allFiles.filter((f) => f.endsWith('.html')).sort();
const textFiles = allFiles.filter((f) => /\.(html|css|js|svg|mjs|json|xml|txt|webmanifest)$/.test(f));

if (htmlFiles.length === 0) {
  console.error('No HTML files found under ' + ROOT);
  process.exit(1);
}

/* ------------------------------------------------------------- extractors */

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function idsIn(html) {
  const ids = [];
  const re = /\sid\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

function metaContent(html, attr, value) {
  const re = new RegExp('<meta[^>]*\\s' + attr + '\\s*=\\s*"' + value + '"[^>]*>', 'i');
  const tag = html.match(re);
  if (!tag) {
    return null;
  }
  const content = tag[0].match(/\scontent\s*=\s*"([^"]*)"/i);
  return content ? content[1] : null;
}

function references(html) {
  const found = [];
  const re = /\s(?:href|src)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    found.push(m[1]);
  }
  return found;
}

const idIndex = new Map();
for (const file of htmlFiles) {
  idIndex.set(file, new Set(idsIn(stripComments(readFileSync(file, 'utf8')))));
}

/* ------------------------------------------------------------ tag balance */

function tagBalance(html, file) {
  const body = stripComments(html);
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const rest = m[3] || '';
    const selfClosing = rest.trimEnd().endsWith('/');
    if (VOID_TAGS.has(name) || selfClosing) {
      continue;
    }
    if (closing) {
      if (stack.length === 0) {
        fail(file, 'closing tag </' + name + '> with nothing open');
        return;
      }
      const open = stack.pop();
      if (open !== name) {
        fail(file, 'tag mismatch: <' + open + '> closed by </' + name + '>');
        return;
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    fail(file, 'unclosed tags: ' + stack.join(', '));
  }
}

/* ------------------------------------------------------------------ pages */

for (const file of htmlFiles) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const raw = readFileSync(file, 'utf8');
  const html = stripComments(raw);

  /* metadata */
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  check(title && title[1].trim().length > 0, rel, 'missing or empty <title>');

  const description = metaContent(html, 'name', 'description');
  check(description && description.trim().length > 0, rel, 'missing meta description');

  for (const property of ['og:title', 'og:description', 'og:url', 'og:image']) {
    const value = metaContent(html, 'property', property);
    check(value && value.trim().length > 0, rel, 'missing ' + property);
  }
  check(
    (metaContent(html, 'name', 'twitter:card') || '').length > 0,
    rel,
    'missing twitter:card'
  );
  check(
    (metaContent(html, 'name', 'twitter:image') || '').length > 0,
    rel,
    'missing twitter:image'
  );

  /* the og image has to be a file that exists here */
  const ogImage = metaContent(html, 'property', 'og:image');
  if (ogImage) {
    checksRun += 1;
    if (!ogImage.startsWith(SITE_ORIGIN)) {
      fail(rel, 'og:image does not start with the canonical origin: ' + ogImage);
    } else {
      const local = join(ROOT, ogImage.slice(SITE_ORIGIN.length));
      if (!existsSync(local)) {
        fail(rel, 'og:image points at a file that does not exist: ' + ogImage);
      }
    }
  }

  /* exactly one h1 */
  const h1s = html.match(/<h1[\s>]/gi) || [];
  check(h1s.length === 1, rel, 'expected exactly one h1, found ' + h1s.length);

  /* forbidden strings, checked against the raw file including comments */
  checksRun += 1;
  if (raw.includes(EM_DASH)) {
    const line = raw.slice(0, raw.indexOf(EM_DASH)).split('\n').length;
    fail(rel, 'em dash found on line ' + line);
  }
  checksRun += 1;
  const versionLabel = raw.match(/v[12]\b/i);
  if (versionLabel) {
    const line = raw.slice(0, versionLabel.index).split('\n').length;
    fail(rel, 'version label "' + versionLabel[0] + '" found on line ' + line);
  }

  /* structure */
  check(/^\s*<!doctype html>/i.test(raw), rel, 'missing <!doctype html>');
  check(/<html[^>]*\slang\s*=\s*"[^"]+"/i.test(html), rel, 'missing lang on <html>');

  const ids = idsIn(html);
  const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(duplicateIds.length === 0, rel, 'duplicate ids: ' + [...new Set(duplicateIds)].join(', '));

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  for (const img of imgs) {
    check(/\salt\s*=\s*"/i.test(img), rel, 'img without an alt attribute: ' + img.slice(0, 70));
  }

  checksRun += 1;
  tagBalance(html, rel);

  /* links and assets */
  for (const ref of references(html)) {
    if (ref === '' || EXTERNAL.test(ref)) {
      continue;
    }
    checksRun += 1;

    if (ref.startsWith('#')) {
      const id = ref.slice(1);
      if (id && !idIndex.get(file).has(id)) {
        fail(rel, 'fragment ' + ref + ' has no matching id on this page');
      }
      continue;
    }

    const [pathPart, fragment] = ref.split('#');
    const target = resolve(dirname(file), pathPart.split('?')[0]);

    if (!existsSync(target)) {
      fail(rel, 'broken reference: ' + ref);
      continue;
    }
    if (fragment && target.endsWith('.html')) {
      const targetIds = idIndex.get(target) || new Set(idsIn(stripComments(readFileSync(target, 'utf8'))));
      if (!targetIds.has(fragment)) {
        fail(rel, 'fragment ' + ref + ' has no matching id in the target page');
      }
    }
  }
}

/* ------------------------------------------- em dash sweep over every file */

for (const file of textFiles) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (rel.endsWith('tools/check-site.mjs')) {
    continue;
  }
  checksRun += 1;
  const raw = readFileSync(file, 'utf8');
  if (raw.includes(EM_DASH)) {
    const line = raw.slice(0, raw.indexOf(EM_DASH)).split('\n').length;
    fail(rel, 'em dash found on line ' + line);
  }
}

/* ------------------------------------------------- sitemap covers the site */

const sitemapPath = join(ROOT, 'sitemap.xml');
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  for (const file of htmlFiles) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (rel === '404.html') {
      continue;
    }
    checksRun += 1;
    if (!sitemap.includes(SITE_ORIGIN + rel)) {
      fail('sitemap.xml', rel + ' is not listed');
    }
  }
} else {
  fail('sitemap.xml', 'file is missing');
}

/* ------------------------------------------------------------------ report */

const pageList = htmlFiles.map((f) => relative(ROOT, f).split(sep).join('/'));
console.log('PATINA site check');
console.log('root   ' + ROOT);
console.log('pages  ' + pageList.length + ': ' + pageList.join(', '));
console.log('files  ' + allFiles.length + ' total');
console.log('checks ' + checksRun);
console.log('');

if (notes.length) {
  for (const note of notes) {
    console.log('note   ' + note);
  }
  console.log('');
}

if (problems.length === 0) {
  console.log('PASS, no problems found.');
  process.exit(0);
}

console.log('FAIL, ' + problems.length + ' problem(s):');
for (const problem of problems) {
  console.log('  ' + problem.file + ': ' + problem.message);
}
process.exit(1);
