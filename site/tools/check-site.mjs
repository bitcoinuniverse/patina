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
 *  11. the design tokens shared with the documentation still match, value for
 *      value, in both themes
 *
 * Check 10 is a structural pass written here, not a full W3C validation.
 * There is no network access and no dependency to install.
 *
 * The publish step copies site/ to the root of the published tree and docs/ to
 * <root>/docs, so a reference beginning with "docs/" is a real path once the
 * site is assembled. This checker resolves those against the repository's docs
 * directory rather than reporting them as broken, and it still checks that the
 * target file and any fragment actually exist. Nothing else may escape site/.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REPO = resolve(ROOT, '..');
const DOCS_ROOT = join(REPO, 'docs');
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

/*
 * Ids on a documentation page. The documentation shell gives every h2 and h3 an
 * id derived from its text at runtime, so a link into a docs heading is valid
 * even though the id is not written in the file. This mirrors the rule in
 * docs/tools/check-links.mjs, deliberately, so the two trees agree.
 */
const docIdCache = new Map();
function docIds(file) {
  if (docIdCache.has(file)) {
    return docIdCache.get(file);
  }
  const html = stripComments(readFileSync(file, 'utf8'));
  const ids = new Set(idsIn(html));
  const heads = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = heads.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) {
      ids.add(text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  }
  docIdCache.set(file, ids);
  return ids;
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
    const clean = pathPart.split('?')[0];

    /*
     * A reference into the documentation resolves against the repository docs
     * directory, because the publish step places docs/ inside the site root.
     * Only a reference written from a top level page can reach it, which is
     * the same rule the published tree enforces.
     */
    const intoDocs = clean.startsWith('docs/');
    let target;
    if (intoDocs) {
      if (dirname(file) !== ROOT) {
        fail(rel, 'a docs/ reference only resolves from a top level page: ' + ref);
        continue;
      }
      target = join(DOCS_ROOT, clean.slice('docs/'.length));
    } else {
      target = resolve(dirname(file), clean);
      if (!target.startsWith(ROOT)) {
        fail(rel, 'reference escapes the site root: ' + ref);
        continue;
      }
    }

    if (!existsSync(target)) {
      fail(rel, 'broken reference: ' + ref);
      continue;
    }
    if (fragment && target.endsWith('.html')) {
      const targetIds = idIndex.get(target) || docIds(target);
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

/* ------------------------------------------ the constants have one source */

/*
 * assets/config.js carries the protocol constants the pages do arithmetic
 * with. They are frozen values that already exist in src/constants.ts, and the
 * site cannot import TypeScript because it has no build step and has to open
 * from disk. So the copy stays, and this check makes it a copy that cannot
 * quietly go wrong: every value here is read out of the real source and
 * compared. src/constants.ts wins every disagreement.
 */
{
  const constantsPath = join(REPO, 'src', 'constants.ts');
  const configPath = join(ROOT, 'assets', 'config.js');

  if (!existsSync(constantsPath) || !existsSync(configPath)) {
    fail('assets/config.js', 'cannot compare protocol constants, a source file is missing');
  } else {
    const ts = readFileSync(constantsPath, 'utf8');
    const js = readFileSync(configPath, 'utf8');

    /* Some constants are written in hex, because that is how they appear on the wire. */
    const fromTs = (name) => {
      const m = ts.match(new RegExp('export const ' + name + '\\s*=\\s*(0x[0-9a-fA-F]+|[0-9]+);'));
      return m ? Number(m[1]) : null;
    };
    const fromConfig = (key) => {
      const m = js.match(new RegExp('\\b' + key + ':\\s*([0-9]+)'));
      return m ? Number(m[1]) : null;
    };

    const PAIRS = [
      ['COMMIT_MIN_AGE', 'commitMinAge'],
      ['WINDOW_LENGTH', 'windowLength'],
      ['GRACE_LENGTH', 'graceLength'],
      ['MIN_CARRIER_FOUNDING', 'minCarrierFounding'],
      ['MIN_CARRIER_OPEN', 'minCarrierOpen'],
      ['MIN_SUCCESSOR', 'minSuccessor'],
      ['MAX_KEEP_ENTRIES', 'maxKeepEntries'],
      ['CONFIRMATIONS_FINAL', 'confirmationsFinal'],
      ['MARKER_VERSION', 'markerVersion'],
    ];

    for (const [tsName, configKey] of PAIRS) {
      checksRun += 1;
      const a = fromTs(tsName);
      const b = fromConfig(configKey);
      if (a === null) {
        fail('assets/config.js', 'could not read ' + tsName + ' out of src/constants.ts');
      } else if (b === null) {
        fail('assets/config.js', 'no ' + configKey + ' to compare against ' + tsName);
      } else if (a !== b) {
        fail('assets/config.js', configKey + ' is ' + b + ', but src/constants.ts says ' + tsName + ' is ' + a);
      }
    }

    /* The tier ladder, name for name and threshold for threshold. */
    const tsTiers = [...ts.matchAll(/\{ index: (\d+), name: '([A-Za-z]+)', threshold: (null|\d+) \}/g)]
      .map((m) => ({ index: Number(m[1]), name: m[2], threshold: m[3] === 'null' ? 0 : Number(m[3]) }));
    const jsTiers = [...js.matchAll(/\{ index: (\d+), name: '([A-Za-z]+)', threshold: (\d+) \}/g)]
      .map((m) => ({ index: Number(m[1]), name: m[2], threshold: Number(m[3]) }));

    checksRun += 1;
    if (tsTiers.length !== 8 || jsTiers.length !== 8) {
      fail('assets/config.js', 'expected eight tiers in both files, found ' + tsTiers.length + ' and ' + jsTiers.length);
    } else {
      for (let i = 0; i < 8; i += 1) {
        checksRun += 1;
        /*
         * Tier 0 has no threshold in the specification. The site writes it as 0
         * because it does arithmetic with it, and zero is what "no threshold"
         * means to a comparison against a depth that is never negative.
         */
        if (tsTiers[i].name !== jsTiers[i].name || tsTiers[i].threshold !== jsTiers[i].threshold) {
          fail(
            'assets/config.js',
            'tier ' + i + ' is ' + jsTiers[i].name + ' at ' + jsTiers[i].threshold +
            ', but src/constants.ts says ' + tsTiers[i].name + ' at ' + tsTiers[i].threshold
          );
        }
      }
    }
  }
}

/* ------------------------------------------- one design system, two trees */

/*
 * site/assets/site.css and docs/assets/style.css declare the same token names
 * with the same values on purpose. The public site and the documentation are
 * one product at two depths, and a colour that drifts in one of them turns
 * that claim into a lie. Every token the two files share must match in both
 * themes, and the tokens listed as required must exist in both.
 */
const REQUIRED_TOKENS = [
  'bg', 'bg-deep', 'surface', 'surface-2', 'plate',
  'rule', 'rule-strong', 'edge',
  'ink', 'ink-2', 'ink-3',
  'bronze', 'bronze-deep', 'verdigris', 'verdigris-deep', 'umber', 'alert', 'focus',
  'code-bg', 'code-ink', 'code-rule', 'code-accent',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'
];

function themeTokens(css, startRe, where) {
  const at = css.search(startRe);
  if (at < 0) {
    fail(where, 'could not find the token block ' + startRe);
    return null;
  }
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const out = {};
  for (const m of css.slice(open, close).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

{
  const sitePath = join(ROOT, 'assets', 'site.css');
  const docsPath = join(DOCS_ROOT, 'assets', 'style.css');

  if (!existsSync(sitePath) || !existsSync(docsPath)) {
    fail('assets/site.css', 'cannot compare design tokens, one of the stylesheets is missing');
  } else {
    const siteCss = readFileSync(sitePath, 'utf8');
    const docsCss = readFileSync(docsPath, 'utf8');

    for (const [theme, startRe] of [['dark', /^:root \{/m], ['light', /^:root\[data-theme="light"\] \{/m]]) {
      const a = themeTokens(siteCss, startRe, 'assets/site.css');
      const b = themeTokens(docsCss, startRe, '../docs/assets/style.css');
      if (!a || !b) {
        continue;
      }
      for (const name of REQUIRED_TOKENS) {
        checksRun += 1;
        if (!(name in a)) {
          fail('assets/site.css', theme + ' theme is missing the token --' + name);
        } else if (!(name in b)) {
          fail('../docs/assets/style.css', theme + ' theme is missing the token --' + name);
        } else if (a[name] !== b[name]) {
          fail(
            'assets/site.css',
            'shared token --' + name + ' differs in the ' + theme + ' theme: site ' + a[name] + ', docs ' + b[name]
          );
        }
      }
    }
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
