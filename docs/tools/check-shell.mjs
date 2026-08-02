#!/usr/bin/env node
// Headless smoke test for the browser scripts.
// Builds a minimal stand in for the parts of the DOM that assets/shell.js
// touches, runs the real script against it, and asserts what it produced:
// sidebar, breadcrumb, previous and next, on this page, copy buttons, search.
// This is not a browser. It catches runtime errors and wrong output, not
// layout. Run: node docs/tools/check-shell.mjs

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* ----------------------------------------------------------- tiny DOM */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.own = '';
    this.listeners = {};
    this.hidden = false;
    this.style = {};
    this.parentNode = null;
    this.classes = new Set();
    const self = this;
    this.classList = {
      add: (c) => self.classes.add(c),
      remove: (c) => self.classes.delete(c),
      contains: (c) => self.classes.has(c),
      toggle: (c) => (self.classes.has(c) ? (self.classes.delete(c), false) : (self.classes.add(c), true)),
    };
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, ref) {
    node.parentNode = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? 0 : i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
  }
  get firstChild() { return this.children[0] || null; }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { if (v === '') { this.children = []; this.own = ''; } }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn(event || { preventDefault() {} })); }
  select() {}
  blur() {}
  focus() {}
  get descendants() {
    const out = [];
    for (const child of this.children) { out.push(child, ...child.descendants); }
    return out;
  }
  matches(sel) {
    if (sel.startsWith('.')) return this.classes.has(sel.slice(1));
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    return this.tagName === sel.toUpperCase();
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    for (const part of selector.split(',').map((s) => s.trim())) {
      const steps = part.split(/\s+/);
      const last = steps[steps.length - 1];
      for (const node of this.descendants) {
        if (!node.matches(last)) continue;
        let ok = true;
        let cursor = node.parentNode;
        for (let i = steps.length - 2; i >= 0; i -= 1) {
          let found = false;
          while (cursor) {
            if (cursor.matches(steps[i])) { found = true; cursor = cursor.parentNode; break; }
            cursor = cursor.parentNode;
          }
          if (!found) { ok = false; break; }
        }
        if (ok && !out.includes(node)) out.push(node);
      }
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makePage(dataPage, dataRoot) {
  const body = new El('body');
  body.setAttribute('data-page', dataPage);
  body.setAttribute('data-root', dataRoot);

  const topbar = new El('header');
  topbar.setAttribute('class', 'topbar');
  body.appendChild(topbar);

  const sidebar = new El('aside');
  sidebar.setAttribute('class', 'sidebar');
  sidebar.setAttribute('id', 'sidebar');
  const nav = new El('nav');
  nav.setAttribute('id', 'nav');
  sidebar.appendChild(nav);
  body.appendChild(sidebar);

  const main = new El('main');
  main.setAttribute('class', 'content');
  main.setAttribute('id', 'content');
  const crumb = new El('nav');
  crumb.setAttribute('id', 'crumb');
  main.appendChild(crumb);

  const article = new El('article');
  const h1 = new El('h1'); h1.textContent = 'Marker grammar'; article.appendChild(h1);
  for (const text of ['The shape', 'SEED, opcode 0x01', 'KEEP, opcode 0x02']) {
    const h = new El('h2'); h.textContent = text; article.appendChild(h);
  }
  const h3 = new El('h3'); h3.textContent = 'When an entry is void'; article.appendChild(h3);
  for (const label of ['Script template', 'SEED marker']) {
    const pre = new El('pre');
    pre.setAttribute('data-label', label);
    pre.textContent = 'example code for ' + label + '\n';
    article.appendChild(pre);
  }
  const bare = new El('pre');
  bare.textContent = 'no label here';
  article.appendChild(bare);
  main.appendChild(article);

  const pager = new El('nav');
  pager.setAttribute('id', 'pager');
  main.appendChild(pager);
  body.appendChild(main);

  const toc = new El('aside');
  toc.setAttribute('class', 'toc');
  toc.setAttribute('id', 'toc');
  body.appendChild(toc);

  return body;
}

/* ----------------------------------------------------------- harness */
const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };

const body = makePage('protocol/marker-grammar.html', '../');
const store = {};
const documentStub = {
  body,
  documentElement: new El('html'),
  createElement: (tag) => new El(tag),
  getElementById: (id) => body.descendants.find((n) => n.id === id) || null,
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: () => {},
  execCommand: () => true,
};
const windowStub = {
  matchMedia: () => ({ matches: false }),
  setTimeout: () => 0,
  IntersectionObserver: class { observe() {} },
};
const localStorageStub = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const navigatorStub = { clipboard: { writeText: () => Promise.resolve() } };

const navSrc = await readFile(join(ROOT, 'assets', 'nav-data.js'), 'utf8');
new Function('window', navSrc)(windowStub);
const indexSrc = await readFile(join(ROOT, 'assets', 'search-index.js'), 'utf8');
new Function('window', indexSrc)(windowStub);

const shellSrc = await readFile(join(ROOT, 'assets', 'shell.js'), 'utf8');
new Function('window', 'document', 'navigator', 'localStorage', 'IntersectionObserver', shellSrc)(
  windowStub, documentStub, navigatorStub, localStorageStub, windowStub.IntersectionObserver
);

/* ----------------------------------------------------------- asserts */
const pageCount = windowStub.PATINA_NAV.reduce((n, s) => n + s.pages.length, 0);

const navLinks = documentStub.getElementById('nav').querySelectorAll('a');
ok(navLinks.length === pageCount, `sidebar has ${navLinks.length} links, expected ${pageCount}`);
const current = navLinks.filter((a) => a.getAttribute('aria-current') === 'page');
ok(current.length === 1, `expected exactly one current page marker, found ${current.length}`);
ok(current[0] && current[0].textContent === 'Marker grammar', 'current marker is on the wrong page');
ok(navLinks[0].getAttribute('href') === '../index.html', `first link href is ${navLinks[0].getAttribute('href')}`);

const crumbItems = documentStub.getElementById('crumb').querySelectorAll('li');
ok(crumbItems.length === 3, `breadcrumb has ${crumbItems.length} items, expected 3`);
ok(crumbItems[1].textContent === 'Protocol reference', `breadcrumb section is "${crumbItems[1].textContent}"`);
ok(crumbItems[2].textContent === 'Marker grammar', `breadcrumb leaf is "${crumbItems[2].textContent}"`);

const pagerLinks = documentStub.getElementById('pager').querySelectorAll('a');
ok(pagerLinks.length === 2, `pager has ${pagerLinks.length} links, expected 2`);
ok(pagerLinks[0].textContent.includes('Identity and derivations'), 'previous link points at the wrong page');
ok(pagerLinks[1].textContent.includes('SEED rules'), 'next link points at the wrong page');

const tocLinks = documentStub.getElementById('toc').querySelectorAll('a');
ok(tocLinks.length === 4, `on this page has ${tocLinks.length} links, expected 4`);
ok(tocLinks[0].getAttribute('href') === '#the-shape', `first toc href is ${tocLinks[0].getAttribute('href')}`);

const wraps = body.querySelectorAll('.codewrap');
ok(wraps.length === 3, `expected 3 wrapped code blocks, found ${wraps.length}`);
const copyButtons = body.querySelectorAll('.copybtn');
ok(copyButtons.length === 3, `expected 3 copy buttons, found ${copyButtons.length}`);
ok(copyButtons.every((b) => (b.getAttribute('aria-label') || '').startsWith('Copy ')), 'a copy button has no aria-label');
const labels = body.querySelectorAll('.codelabel');
ok(labels.length === 2, `expected 2 code labels, found ${labels.length}`);
copyButtons[0].fire('click');

const topbar = body.querySelector('.topbar');
const input = topbar.querySelectorAll('input')[0];
const results = topbar.querySelector('.results');
ok(!!input && !!results, 'search box was not built');

function search(query) {
  input.value = query;
  input.fire('input');
  return results.querySelectorAll('.r-title').map((n) => n.textContent);
}

const cases = [
  ['commit too young', 'Reason codes'],
  ['relic', 'State machine'],
  ['tapleaf', 'Identity and derivations'],
  ['restore', 'Back up and restore'],
  ['no go', 'Go, conditional go, no go'],
];
for (const [query, expected] of cases) {
  const hits = search(query);
  ok(hits.length > 0, `search "${query}" returned nothing`);
  ok(hits.includes(expected), `search "${query}" did not surface "${expected}", got ${JSON.stringify(hits.slice(0, 3))}`);
}
const none = search('zzzznotaword');
ok(none.length === 0, 'search for a missing word returned results');
ok(results.textContent.includes('Nothing matched'), 'search has no empty state message');

/*
 * A search index that stops partway through a page is worse than a small one:
 * a search that finds nothing reads as proof the word is not there. Every page
 * has to be indexed to its own length.
 */
const indexed = (windowStub.PATINA_SEARCH && windowStub.PATINA_SEARCH.pages) || [];
ok(indexed.length > 0, 'the search index is empty');
for (const page of indexed) {
  ok(
    page.x.length === page.n,
    `the search index truncates ${page.p} at ${page.x.length} of ${page.n} characters`
  );
}

const theme = body.querySelector('.topbar').querySelectorAll('button')[0];
theme.fire('click');
ok(store['patina-docs-theme'] === 'light', `theme toggle stored "${store['patina-docs-theme']}"`);
theme.fire('click');
ok(store['patina-docs-theme'] === 'dark', 'theme toggle does not switch back');

/* ------------------------------------------------- the way back to the site */
const tosite = body.querySelector('.tosite');
ok(!!tosite, 'the topbar offers no route back to the public site');
ok(
  tosite && tosite.getAttribute('href') === '../../index.html',
  `the route back to the site points at ${tosite && tosite.getAttribute('href')}`
);

/* ------------------------------------------------------------- the drawer */
const menuBtn = documentStub.getElementById('menubtn');
const sidebar = documentStub.getElementById('sidebar');
const backdrop = body.querySelector('.backdrop');
ok(!!backdrop, 'the drawer has no backdrop');
ok(menuBtn.getAttribute('aria-expanded') === 'false', 'the drawer starts closed');
ok(backdrop && backdrop.hidden === true, 'the backdrop starts hidden');
ok(menuBtn.getAttribute('aria-label') === 'Open the contents', 'the closed drawer button is unlabelled');

menuBtn.fire('click');
ok(menuBtn.getAttribute('aria-expanded') === 'true', 'the drawer does not report itself open');
ok(sidebar.classList.contains('open'), 'the drawer does not open');
ok(backdrop.hidden === false, 'the backdrop stays hidden with the drawer open');

sidebar.fire('click', { target: navLinks[0], preventDefault() {} });
ok(menuBtn.getAttribute('aria-expanded') === 'false', 'choosing a page leaves the drawer open');
ok(backdrop.hidden === true, 'choosing a page leaves the backdrop up');

menuBtn.fire('click');
backdrop.fire('click');
ok(menuBtn.getAttribute('aria-expanded') === 'false', 'the backdrop does not close the drawer');

/* --------------------------------------------------------- the page meta */
const meta = documentStub.getElementById('crumb').querySelector('.pagemeta');
ok(!!meta, 'the page carries no kind, position or reading time');

const kindBadge = meta && meta.querySelector('.kind');
ok(kindBadge && kindBadge.textContent === 'generated', `marker grammar is marked "${kindBadge && kindBadge.textContent}", expected generated`);
ok(
  kindBadge && (kindBadge.getAttribute('title') || '').length > 20,
  'the kind badge does not explain what the kind means'
);

const where = meta && meta.querySelector('.where');
ok(where && where.textContent === 'page 2 of 10', `position reads "${where && where.textContent}", expected page 2 of 10`);

const read = meta && meta.querySelector('.read');
ok(read && /^\d+ minutes? read$/.test(read.textContent), `reading time reads "${read && read.textContent}"`);

/* Every kind used by the map has to have an explanation behind it. */
const kinds = windowStub.PATINA_KINDS || {};
const used = new Set();
windowStub.PATINA_NAV.forEach((s) => s.pages.forEach((p) => used.add(p.kind || 'introductory')));
for (const kind of used) {
  ok(typeof kinds[kind] === 'string' && kinds[kind].length > 10, `the kind "${kind}" has no explanation in PATINA_KINDS`);
}

/* Every section has to name the intent that brings a reader to it. */
for (const section of windowStub.PATINA_NAV) {
  ok(typeof section.intent === 'string' && section.intent.length > 8, `section "${section.title}" names no reader intent`);
  ok(typeof section.blurb === 'string' && section.blurb.length > 20, `section "${section.title}" has no summary`);
}

console.log(`nav links          ${navLinks.length}`);
console.log(`search cases       ${cases.length}`);
console.log(`shell failures     ${failures.length}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
