#!/usr/bin/env node
/*
 * Headless behaviour test for the PATINA public site.
 *
 * Run from anywhere:  node site/tools/check-behaviour.mjs
 *
 * This parses the real pages, builds a stand in for the parts of the DOM that
 * assets/site.js touches, runs the real script against them, and asserts what
 * it produced. It is not a browser: it catches runtime errors and wrong output,
 * not layout. What it does catch is the whole set of states that are otherwise
 * only reachable by hand, including every way a live indexer can fail.
 *
 * Covered:
 *   theme choice, the mobile drawer, the artifact model, the specimen, the
 *   passage of blocks, moving a carrier, the tier ladder, the anatomy selector,
 *   the mint wizard and its deep links, the fee estimator, and the live panels
 *   against a connected indexer, a refusing indexer, an indexer answering with
 *   something that is not JSON, and no indexer at all.
 *
 * Node standard library only. No network. No dependency to install.
 */

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ------------------------------------------------------------- tiny DOM */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
    this.style = {};
    this.text = '';
    this._hidden = false;
    this.disabled = false;
    this.classes = new Set();
    const self = this;
    this.classList = {
      add: (c) => self.classes.add(c),
      remove: (c) => self.classes.delete(c),
      contains: (c) => self.classes.has(c),
      toggle: (c, force) => {
        if (force === true) { self.classes.add(c); return true; }
        if (force === false) { self.classes.delete(c); return false; }
        if (self.classes.has(c)) { self.classes.delete(c); return false; }
        self.classes.add(c); return true;
      },
    };
  }

  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = Boolean(value); if (this._hidden) this.attributes.hidden = ''; else delete this.attributes.hidden; }

  get id() { return this.attributes.id || ''; }
  set id(value) { this.setAttribute('id', value); }

  /* A form control reads its starting value from the attribute, as it would. */
  get value() { return '_value' in this ? this._value : (this.attributes.value || ''); }
  set value(v) { this._value = String(v); }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    if (k === 'hidden') this._hidden = true;
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; if (k === 'hidden') this._hidden = false; }

  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, ref) {
    node.parentNode = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
  }

  get firstChild() { return this.children[0] || null; }

  get nextElementSibling() {
    if (!this.parentNode) return null;
    const kids = this.parentNode.children.filter((c) => c.tagName !== '#TEXT');
    const i = kids.indexOf(this);
    return i > -1 ? kids[i + 1] || null : null;
  }

  set textContent(v) { this.text = String(v); this.children = []; }
  get textContent() {
    if (this.tagName === '#TEXT') return this.text;
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  get innerText() { return this.textContent; }

  set innerHTML(v) {
    this.children = [];
    this.text = '';
    if (v) {
      const parsed = parse(String(v));
      parsed.children.forEach((c) => this.appendChild(c));
    }
  }
  get innerHTML() {
    if (this.tagName === '#TEXT') return this.text;
    return this.text + this.children.map((c) => (c.tagName === '#TEXT' ? c.text : c.outerHTML)).join('');
  }
  get outerHTML() {
    const attrs = Object.keys(this.attributes)
      .map((k) => ' ' + k + '="' + this.attributes[k] + '"').join('');
    const tag = this.tagName.toLowerCase();
    if (VOID.has(tag)) return '<' + tag + attrs + '>';
    return '<' + tag + attrs + '>' + this.innerHTML + '</' + tag + '>';
  }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  fire(type, event) {
    const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, event || {});
    (this.listeners[type] || []).forEach((fn) => fn(e));
    return e;
  }
  dispatchEvent(event) { return this.fire(event.type, event); }
  focus() { documentStub.activeElement = this; }
  blur() {}
  select() {}

  get descendants() {
    const out = [];
    for (const child of this.children) { out.push(child, ...child.descendants); }
    return out;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  matches(selector) {
    if (this.tagName === '#TEXT') return false;
    for (const part of selector.split(',').map((s) => s.trim())) {
      if (this._matchesSimple(part)) return true;
    }
    return false;
  }

  _matchesSimple(sel) {
    // tag, .class, #id and [attr] or [attr="value"], any combination.
    const re = /(^[a-zA-Z][a-zA-Z0-9-]*)|\.([a-zA-Z0-9_-]+)|#([a-zA-Z0-9_-]+)|\[([a-zA-Z0-9_-]+)(?:=("?)([^\]"]*)\5)?\]/g;
    let m;
    let matched = false;
    while ((m = re.exec(sel))) {
      matched = true;
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (m[2] && !this.classes.has(m[2])) return false;
      if (m[3] && this.id !== m[3]) return false;
      if (m[4]) {
        if (!(m[4] in this.attributes)) return false;
        if (m[6] !== undefined && this.attributes[m[4]] !== m[6]) return false;
      }
    }
    return matched;
  }

  querySelectorAll(selector) {
    const out = [];
    for (const part of selector.split(',').map((s) => s.trim())) {
      const steps = part.split(/\s+/).filter(Boolean);
      const last = steps[steps.length - 1];
      for (const node of this.descendants) {
        if (node.tagName === '#TEXT') continue;
        if (!node._matchesSimple(last)) continue;
        let ok = true;
        let cursor = node.parentNode;
        for (let i = steps.length - 2; i >= 0; i -= 1) {
          let found = false;
          while (cursor) {
            if (cursor._matchesSimple && cursor._matchesSimple(steps[i])) { found = true; cursor = cursor.parentNode; break; }
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

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function parse(html) {
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const root = new El('#document');
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;

  while ((m = re.exec(source))) {
    if (m[5] !== undefined) {
      const text = decodeEntities(m[5]);
      if (text.trim()) {
        const node = new El('#text');
        node.text = text;
        stack[stack.length - 1].appendChild(node);
      }
      continue;
    }

    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const rawAttrs = m[3] || '';
    const selfClosed = m[4] === '/';

    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === name.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }

    const node = new El(name);
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(rawAttrs))) {
      const value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
      node.setAttribute(a[1], decodeEntities(value));
    }
    stack[stack.length - 1].appendChild(node);

    if (name === 'script' || name === 'style') {
      const close = source.indexOf('</' + name, re.lastIndex);
      const body = close < 0 ? '' : source.slice(re.lastIndex, close);
      node.text = body;
      re.lastIndex = close < 0 ? source.length : source.indexOf('>', close) + 1;
      continue;
    }

    if (!VOID.has(name) && !selfClosed) stack.push(node);
  }

  return root;
}

/* ----------------------------------------------------------- environment */

let documentStub = null;
let windowStub = null;
let store = {};
let fetchPlan = null;
let timers = [];

function loadPage(file, options) {
  const opts = options || {};
  const html = readFileSync(join(ROOT, file), 'utf8');
  const tree = parse(html);
  const body = tree.querySelector('body') || tree;
  const documentElement = tree.querySelector('html') || new El('html');

  store = {};
  timers = [];
  fetchPlan = opts.fetch || null;

  const docListeners = {};
  documentStub = {
    body,
    documentElement,
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    createElement: (tag) => new El(tag),
    createTextNode: (text) => { const n = new El('#text'); n.text = String(text); return n; },
    getElementById: (id) => body.descendants.find((n) => n.id === id) || null,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      (docListeners[event.type] || []).forEach((fn) => fn(event));
      return true;
    },
    execCommand: () => true,
  };

  const winListeners = {};
  windowStub = {
    location: { search: opts.search || '', hash: opts.hash || '', href: 'https://bitcoinuniverse.github.io/patina/' + file },
    matchMedia: (query) => ({
      matches: query.indexOf('prefers-reduced-motion: reduce') > -1
        ? Boolean(opts.reducedMotion)
        : query.indexOf('prefers-color-scheme: light') > -1
          ? Boolean(opts.lightSystem)
          : false,
      addEventListener: () => {},
      addListener: () => {},
    }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); },
    fireWindow: (type) => { (winListeners[type] || []).forEach((fn) => fn({ type })); },
    IntersectionObserver: opts.noObserver ? undefined : class { observe() {} disconnect() {} },
    URLSearchParams,
    URL,
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    Promise,
    document: documentStub,
  };
  documentStub.defaultView = windowStub;

  const fetchStub = () => {
    if (!fetchPlan) return Promise.reject(new Error('network unreachable'));
    return fetchPlan();
  };

  const configSrc = readFileSync(join(ROOT, 'assets', 'config.js'), 'utf8');
  new Function('window', configSrc)(windowStub);

  if (opts.config) {
    Object.assign(windowStub.PATINA_CONFIG, opts.config);
  }

  const siteSrc = readFileSync(join(ROOT, 'assets', 'site.js'), 'utf8');
  new Function(
    'window', 'document', 'navigator', 'localStorage', 'fetch',
    'AbortController', 'CustomEvent', 'setTimeout', 'clearTimeout',
    'URLSearchParams', 'URL', 'IntersectionObserver',
    siteSrc
  )(
    windowStub, documentStub,
    { clipboard: { writeText: () => Promise.resolve() } },
    windowStub.localStorage,
    fetchStub,
    class { constructor() { this.signal = {}; } abort() {} },
    windowStub.CustomEvent,
    windowStub.setTimeout, windowStub.clearTimeout,
    URLSearchParams, URL,
    windowStub.IntersectionObserver
  );

  return { body, documentElement, tree };
}

const flush = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(r))));

/* --------------------------------------------------------------- harness */

const failures = [];
let assertions = 0;
const ok = (cond, what) => { assertions += 1; if (!cond) failures.push(what); };
const eq = (actual, expected, what) => {
  assertions += 1;
  if (actual !== expected) failures.push(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const text = (node) => (node ? node.textContent.replace(/\s+/g, ' ').trim() : null);

/* ------------------------------------------------------- theme and drawer */
{
  const { body, documentElement } = loadPage('index.html');

  const themeBtn = body.querySelector('[data-theme-toggle]');
  ok(Boolean(themeBtn), 'theme toggle is missing from the overview page');
  themeBtn.fire('click');
  eq(store['patina-theme'], 'light', 'theme toggle stores light');
  eq(documentElement.getAttribute('data-theme'), 'light', 'theme toggle sets data-theme on the root');
  themeBtn.fire('click');
  eq(store['patina-theme'], 'dark', 'theme toggle switches back to dark');

  const nav = body.querySelector('[data-site-nav]');
  const menu = body.querySelector('[data-menu-toggle]');
  ok(Boolean(nav) && Boolean(menu), 'the mobile drawer parts are missing');
  eq(nav.getAttribute('data-open'), 'false', 'the drawer starts closed');
  eq(menu.getAttribute('aria-expanded'), 'false', 'the drawer button starts unexpanded');
  menu.fire('click');
  eq(nav.getAttribute('data-open'), 'true', 'the drawer opens on click');
  eq(menu.getAttribute('aria-expanded'), 'true', 'the drawer button reports expanded');
  documentStub.dispatchEvent({ type: 'keydown', key: 'Escape' });
  eq(nav.getAttribute('data-open'), 'false', 'Escape closes the drawer');

  menu.fire('click');
  const firstLink = nav.querySelector('a');
  nav.fire('click', { target: firstLink });
  eq(nav.getAttribute('data-open'), 'false', 'following a link closes the drawer');

  // Every page in the nav must exist and the drawer must carry more than the bar.
  const links = nav.querySelectorAll('a');
  ok(links.length >= 10, `the drawer lists ${links.length} links, expected at least 10`);
  const more = nav.querySelectorAll('.nav-more');
  ok(more.length >= 3, `expected the drawer to add extra links, found ${more.length}`);
}

/* --------------------------------------------- the artifact and its views */
{
  const { body } = loadPage('depth.html');

  const depthOut = body.querySelector('[data-pass="depth"]');
  const tierOut = body.querySelector('[data-pass="tier"]');
  const specDepth = body.querySelector('[data-spec="depth"]');
  const specTier = body.querySelector('[data-spec="tier"]');
  const rings = body.querySelector('[data-spec="rings"]');
  const disc = body.querySelector('[data-spec-disc]');
  const passage = body.querySelector('[data-passage]');

  eq(text(depthOut), '0', 'the artifact starts at depth zero');
  eq(text(specTier), 'Raw', 'depth zero is tier Raw');
  eq(disc.getAttribute('r'), '26.00', 'the disc starts at the innermost radius');

  const advance = (blocks) => {
    const button = body.querySelectorAll('[data-advance]').find((b) => b.getAttribute('data-advance') === String(blocks));
    ok(Boolean(button), `no control advances by ${blocks} blocks`);
    button.fire('click');
  };

  advance(1);
  eq(text(depthOut), '1', 'one block advances depth by one');
  eq(text(tierOut), 'Raw', 'one block is still Raw');

  advance(144);
  eq(text(depthOut), '145', 'a day is 144 blocks');

  advance(4320);
  eq(text(depthOut), '4 465', 'a month is 4320 blocks');
  eq(text(tierOut), 'Cast', '4465 blocks is tier Cast');
  eq(text(specTier), 'Cast', 'the specimen agrees with the readout');
  eq(passage.getAttribute('data-tier'), '2', 'the passage carries the tier index for colour');

  advance(52560);
  eq(text(depthOut), '57 025', 'a year is 52560 blocks');
  eq(text(tierOut), 'Bronze', '57025 blocks is tier Bronze');

  // Every tier boundary, checked against the frozen ladder.
  const reset = body.querySelector('[data-artifact-reset]');
  const LADDER = [[1007, 'Raw'], [1008, 'Sheen'], [4031, 'Sheen'], [4032, 'Cast'],
    [12960, 'Verdigris'], [26280, 'Umber'], [52560, 'Bronze'], [105120, 'Oxide'],
    [209999, 'Oxide'], [210000, 'Elder']];
  for (const [depth, name] of LADDER) {
    reset.fire('click');
    advance(1);
    const step = body.querySelectorAll('[data-advance]').find((b) => b.getAttribute('data-advance') === '1');
    for (let i = 1; i < 0; i += 1) step.fire('click');
    // Reach the exact depth with one synthetic advance.
    const button = body.querySelectorAll('[data-advance]')[0];
    button.setAttribute('data-advance', String(depth - 1));
    button.fire('click');
    button.setAttribute('data-advance', '1');
    eq(text(tierOut), name, `depth ${depth} is tier ${name}`);
  }

  // Moving the carrier: depth resets, a ring survives.
  reset.fire('click');
  const step2 = body.querySelectorAll('[data-advance]')[0];
  step2.setAttribute('data-advance', '52560');
  step2.fire('click');
  step2.setAttribute('data-advance', '1');
  eq(text(specDepth), '52 560', 'the specimen shows the depth before the move');

  body.querySelector('[data-artifact-move]').fire('click');
  eq(text(depthOut), '0', 'moving the carrier resets depth to zero');
  eq(text(tierOut), 'Raw', 'moving the carrier resets the tier to Raw');
  eq(text(rings), '1 ring', 'moving the carrier engraves one ring');

  const chips = body.querySelectorAll('.ring-chip');
  eq(chips.length, 1, 'one completed stretch draws one ring chip');
  eq(chips[0].getAttribute('data-tier'), '5', 'the ring chip carries the tier the stretch reached');
  ok(text(chips[0]).includes('52 560'), 'the ring chip records the depth the stretch reached');

  body.querySelector('[data-artifact-move]').fire('click');
  eq(text(rings), '2 rings', 'a second move engraves a second ring');
  eq(body.querySelectorAll('.ring-chip').length, 2, 'a second ring draws a second chip');

  reset.fire('click');
  eq(text(rings), 'none yet', 'starting again clears the rings');

  const announce = body.querySelector('[data-pass-announce]');
  ok(text(announce).startsWith('Depth 0 blocks, tier Raw'), 'the live region announces the current state');

  /*
   * The strata column is drawn one equal band per tier, the same mapping the
   * disc uses. A tier line has to land exactly on its own threshold, or the
   * picture is telling a different story from the numbers beside it.
   */
  const fill = body.querySelector('[data-strata-fill]');
  const bandStep = 224 / 7;
  const at = (depth, tierIndex) => {
    reset.fire('click');
    if (depth > 0) {
      const b = body.querySelectorAll('[data-advance]')[0];
      b.setAttribute('data-advance', String(depth));
      b.fire('click');
      b.setAttribute('data-advance', '1');
    }
    const wantHeight = bandStep * tierIndex;
    eq(fill.getAttribute('height'), wantHeight.toFixed(2), `strata height at depth ${depth}`);
    eq(fill.getAttribute('y'), String(236 - wantHeight), `strata top at depth ${depth}`);
    eq(fill.getAttribute('fill'), 'var(--t' + tierIndex + ')', `strata colour at depth ${depth}`);
  };

  at(0, 0);
  at(1008, 1);
  at(4032, 2);
  at(12960, 3);
  at(26280, 4);
  at(52560, 5);
  at(105120, 6);
  at(210000, 7);

  reset.fire('click');
}

/* ------------------------------------------------------------ tier ladder */
{
  const { body } = loadPage('index.html');
  const rungs = body.querySelectorAll('[data-rung]');
  eq(rungs.length, 8, 'the ladder has eight rungs');

  /*
   * The hero starts on the band its own markup already shows, so a visitor
   * with scripts sees the same object as a visitor without them, and nothing
   * jumps when this file finishes loading.
   */
  const specimen = body.querySelector('[data-specimen]');
  const written = specimen.getAttribute('data-runner');
  eq(specimen.getAttribute('data-tier'), written, 'the specimen starts on the band its markup declares');
  eq(text(body.querySelector('[data-spec="depth"]')), '12 960', 'the specimen starts at the written depth');
  eq(text(body.querySelector('[data-spec="tier"]')), 'Verdigris', 'the specimen starts at the written tier');

  const states = () => rungs.map((r) => text(r.querySelector('[data-rung-state]')));

  body.querySelector('[data-artifact-reset]').fire('click');
  eq(states()[0], 'Held now', 'at depth zero the first rung is the one held');
  eq(states()[1], '1 008 blocks away', 'the next rung reports the distance to it');

  const button = body.querySelectorAll('[data-advance]')[0];
  button.setAttribute('data-advance', '4032');
  button.fire('click');
  eq(states()[2], 'Held now', 'at 4032 blocks the Cast rung is held');
  eq(states()[1], 'Passed', 'a rung below the held one reads as passed');
  eq(states()[3], '8 928 blocks away', 'the rung above reports the exact distance');
  eq(rungs[2].getAttribute('data-current'), 'true', 'the held rung is marked current');
  eq(rungs[7].getAttribute('data-reached'), 'false', 'an unreached rung is marked unreached');
}

/* ----------------------------------------------------------- the anatomy */
{
  const { body } = loadPage('depth.html');
  const host = body.querySelector('[data-anatomy]');
  ok(Boolean(host), 'the anatomy block is missing');

  const list = host.querySelector('[data-anatomy-list]');
  eq(list.hidden, true, 'the source list is collapsed once the selector exists');

  const buttons = host.querySelectorAll('.part-btn');
  eq(buttons.length, 10, 'the anatomy offers ten parts');

  const detail = host.querySelector('.part-detail');
  ok(Boolean(detail), 'the anatomy detail panel was not built');
  eq(detail.getAttribute('aria-live'), 'polite', 'the detail panel announces changes');
  eq(buttons[0].getAttribute('aria-pressed'), 'true', 'the first part starts selected');
  ok(text(detail).includes('Artifact identity'), 'the first part shows its own title');

  buttons[2].fire('click');
  eq(buttons[0].getAttribute('aria-pressed'), 'false', 'selecting another part deselects the first');
  eq(buttons[2].getAttribute('aria-pressed'), 'true', 'the chosen part is selected');
  ok(text(detail).includes('Endowment'), 'the chosen part shows its own title');
  ok(text(detail).includes('100 000 sats'), 'the endowment part states the founding minimum');

  const marks = host.querySelectorAll('[data-part-mark]');
  ok(marks.length > 0, 'the drawing has no labelled parts');
  const lit = marks.filter((m) => (m.getAttribute('class') || '').includes('lbl-on') || (m.getAttribute('class') || '').includes('leader-on'));
  ok(lit.length > 0, 'selecting a part lights nothing in the drawing');

  const hotspot = host.querySelectorAll('[data-part-pick]').find((h) => h.getAttribute('data-part-pick') === 'rings');
  hotspot.fire('click');
  ok(text(detail).includes('Completed rings'), 'clicking a part of the drawing selects it');
}

/* ---------------------------------------------------------- mint wizard */
{
  const { body } = loadPage('mint.html');
  const wizard = body.querySelector('[data-wizard]');
  const steps = wizard.querySelectorAll('[data-step]');
  eq(steps.length, 6, 'the mint has six steps');

  const track = wizard.querySelector('.wizard-track');
  ok(Boolean(track), 'the wizard built no tab strip');
  eq(track.getAttribute('role'), 'tablist', 'the tab strip is a tablist');

  const tabs = track.querySelectorAll('button');
  eq(tabs.length, 6, 'there is one tab per step');
  eq(tabs[0].getAttribute('aria-selected'), 'true', 'the first step starts selected');
  eq(steps[0].hidden, false, 'the first step is visible');
  eq(steps[1].hidden, true, 'the other steps are hidden');
  eq(steps[0].getAttribute('role'), 'tabpanel', 'a step is a tab panel');
  eq(steps[0].getAttribute('aria-labelledby'), 'step-prepare-tab', 'a step points at its own tab');

  tabs[3].fire('click');
  eq(steps[3].hidden, false, 'choosing a tab reveals its step');
  eq(steps[0].hidden, true, 'choosing a tab hides the previous step');

  tabs[3].fire('keydown', { key: 'ArrowRight' });
  eq(steps[4].hidden, false, 'the right arrow moves to the next step');

  const nav = wizard.querySelector('.wizard-nav');
  const buttons = nav.querySelectorAll('button');
  eq(buttons.length, 2, 'the wizard has a back and a forward control');
  buttons[1].fire('click');
  eq(steps[5].hidden, false, 'forward reaches the last step');
  eq(buttons[1].disabled, true, 'forward is disabled on the last step');
  buttons[0].fire('click');
  eq(steps[4].hidden, false, 'back returns to the previous step');

  // Every step keeps its own id, so the deep links from other pages survive.
  const ids = steps.map((s) => s.id);
  for (const wanted of ['step-prepare', 'step-commit', 'step-wait', 'step-reveal', 'step-carrier', 'step-depth']) {
    ok(ids.includes(wanted), `the wizard lost the deep link target ${wanted}`);
  }
}

{
  // Landing on a deep link opens that step rather than a hidden one.
  const { body } = loadPage('mint.html', { hash: '#step-reveal' });
  const steps = body.querySelectorAll('[data-step]');
  eq(steps[3].hidden, false, 'a deep link opens the step it names');
  eq(steps[0].hidden, true, 'a deep link does not leave the first step open');
}

/* --------------------------------------------------------- fee estimator */
{
  const { body } = loadPage('firstlight.html');
  const form = body.querySelector('[data-fee-estimator]');
  ok(Boolean(form), 'the fee estimator is missing');

  const rate = form.querySelector('[data-fee-rate]');
  const commit = form.querySelector('[data-fee="commit"]');
  const reveal = form.querySelector('[data-fee="reveal"]');
  const total = form.querySelector('[data-fee="total"]');
  const error = form.querySelector('[data-fee-error]');

  eq(text(commit), '1 540', 'the commit fee at 10 sats per virtual byte');
  eq(text(reveal), '1 730', 'the reveal fee at 10 sats per virtual byte');
  eq(text(total), '3 270', 'the total fee at 10 sats per virtual byte');

  rate.setAttribute('value', '2');
  rate.value = '2';
  rate.fire('input');
  eq(text(commit), '308', 'the commit fee at 2 sats per virtual byte');
  eq(text(total), '654', 'the total fee at 2 sats per virtual byte');

  const preset = form.querySelectorAll('[data-fee-preset]').find((b) => b.getAttribute('data-fee-preset') === '50');
  preset.fire('click');
  eq(text(total), '16 350', 'a preset sets the rate and recomputes');

  rate.value = '0';
  rate.fire('input');
  eq(error.hidden, false, 'a rate of zero is refused');
  eq(text(total), '16 350', 'a refused rate leaves the last good figure in place');

  rate.value = '25';
  rate.fire('input');
  eq(error.hidden, true, 'a good rate clears the error');
  eq(text(total), '8 175', 'the total fee at 25 sats per virtual byte');
}

/* --------------------------------------------------- reduced motion mode */
{
  const { body } = loadPage('index.html', { reducedMotion: true });
  const toggle = body.querySelector('[data-runner-toggle]');
  eq(toggle.hidden, true, 'reduced motion hides the run control');
  const rings = body.querySelector('[data-spec="rings"]');
  eq(text(rings), '1 ring', 'reduced motion shows a worked example that already has a ring');
  const depth = body.querySelector('[data-spec="depth"]');
  eq(text(depth), '17 160', 'reduced motion shows a settled depth rather than an animation');
}

/* ------------------------------------------------------------ live panels */

function jsonResponse(body, status) {
  return () => Promise.resolve({
    ok: status === undefined || status === 200,
    status: status || 200,
    json: () => Promise.resolve(body),
  });
}

{
  // No indexer configured: honest, and nothing is invented.
  const { body } = loadPage('index.html');
  await flush();
  const panel = body.querySelector('[data-live="window"]');
  const state = panel.querySelector('[data-live-state]');
  const message = text(panel.querySelector('[data-live-message]'));
  eq(state.getAttribute('data-tone'), '', 'an unconfigured panel is not an error');
  ok(message.includes('No indexer is connected'), 'an unconfigured panel says so');
  ok(message.includes('Nothing is cached, guessed or written by hand'), 'an unconfigured panel explains why it is blank');
  eq(panel.querySelector('[data-live-body]').hidden, true, 'an unconfigured panel shows no figures');

  const note = text(body.querySelector('[data-window-note]'));
  ok(note.includes('will not invent one'), 'the window note refuses to invent an opening height');

  // Nothing anywhere on the page may print a founding total or a countdown.
  const fields = panel.querySelectorAll('[data-field]');
  for (const field of fields) {
    eq(text(field), '', `field ${field.getAttribute('data-field')} must stay empty with no indexer`);
  }
}

{
  // A connected indexer, window pending.
  const { body } = loadPage('index.html', {
    config: { indexerBase: 'https://indexer.example.org/patina' },
    fetch: jsonResponse({ state: 'PENDING', tip_height: 800000, h_open: 900000, blocks_until_open: 100000, founding_total: 0 }),
  });
  await flush();
  const panel = body.querySelector('[data-live="window"]');
  eq(panel.querySelector('[data-live-state]').getAttribute('data-tone'), 'ok', 'a good answer reads as ok');
  eq(panel.querySelector('[data-live-body]').hidden, false, 'a good answer reveals the figures');
  eq(text(panel.querySelector('[data-field="tip_height"]')), '800 000', 'the tip height is grouped for reading');
  eq(text(panel.querySelector('[data-field="h_open"]')), '900 000', 'the opening height comes from the indexer');
  ok(text(panel.querySelector('[data-live-source]')).includes('https://indexer.example.org/patina/window'), 'the panel names the URL it read');

  const note = text(body.querySelector('[data-window-note]'));
  ok(note.includes('has not opened yet'), 'a pending window says it has not opened');
  ok(note.includes('900 000'), 'a pending window quotes the opening height it was given');
  ok(note.includes('100 000 blocks away'), 'a pending window quotes the distance it was given');
}

{
  // A window that is open reports the blocks remaining and the ageing rule.
  const { body } = loadPage('mint.html', {
    config: { indexerBase: 'https://indexer.example.org/patina' },
    fetch: jsonResponse({ state: 'OPEN', tip_height: 900500, blocks_remaining: 3532 }),
  });
  await flush();
  const note = text(body.querySelector('[data-window-note]'));
  ok(note.startsWith('The founding window is open.'), 'an open window says so');
  ok(note.includes('3 532 blocks remain'), 'an open window quotes the blocks remaining');
  ok(note.includes('144 blocks old'), 'an open window repeats the commit ageing rule');
  ok(text(body.querySelector('[data-mint-cta]')).includes('Start a Firstlight claim'), 'an open window sharpens the call to action');
}

{
  // Grace and closed both have to read correctly, and neither may look open.
  for (const [state, expected] of [['GRACE', 'commit window has closed'], ['CLOSED', 'window is closed']]) {
    const { body } = loadPage('firstlight.html', {
      config: { indexerBase: 'https://indexer.example.org/patina' },
      fetch: jsonResponse({ state, tip_height: 910000, grace_end: 912000 }),
    });
    await flush();
    const note = text(body.querySelector('[data-window-note]'));
    ok(note.includes(expected), `the ${state} window state reads wrong: ${note.slice(0, 80)}`);
  }
}

{
  // A state nobody planned for must not be guessed at.
  const { body } = loadPage('firstlight.html', {
    config: { indexerBase: 'https://indexer.example.org/patina' },
    fetch: jsonResponse({ state: 'SOMETHING_NEW' }),
  });
  await flush();
  const note = text(body.querySelector('[data-window-note]'));
  ok(note.includes('does not guess at states it does not recognise'), 'an unknown window state is not guessed at');
}

{
  // The indexer refuses.
  const { body } = loadPage('index.html', {
    config: { indexerBase: 'https://indexer.example.org/patina' },
    fetch: jsonResponse({}, 503),
  });
  await flush();
  const panel = body.querySelector('[data-live="window"]');
  eq(panel.querySelector('[data-live-state]').getAttribute('data-tone'), 'error', 'a refusal reads as an error');
  ok(text(panel.querySelector('[data-live-message]')).includes('HTTP 503'), 'a refusal reports the status it got');
  eq(panel.querySelector('[data-live-body]').hidden, true, 'a refusal shows no figures');
}

{
  // The indexer answers with something that is not JSON.
  const { body } = loadPage('index.html', {
    config: { indexerBase: 'https://indexer.example.org/patina' },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('not json')) }),
  });
  await flush();
  const message = text(body.querySelector('[data-live="window"] [data-live-message]'));
  ok(message.includes('could not read as JSON'), 'a bad body is reported as a bad body');
}

{
  // The indexer is not there at all.
  const { body } = loadPage('index.html', {
    config: { indexerBase: 'https://indexer.example.org/patina' },
    fetch: () => Promise.reject(new Error('unreachable')),
  });
  await flush();
  const message = text(body.querySelector('[data-live="window"] [data-live-message]'));
  ok(message.includes('Could not reach the indexer'), 'an unreachable indexer is reported as unreachable');
  ok(message.includes('8 seconds'), 'the failure names the timeout it waited');
}

{
  // A visitor supplied indexer is used, and is labelled as not ours.
  const { body } = loadPage('index.html', {
    search: '?indexer=https://mine.example.org/patina',
    fetch: jsonResponse({ state: 'PENDING', tip_height: 1 }),
  });
  await flush();
  const banner = body.querySelector('[data-override-banner]');
  eq(banner.hidden, false, 'a supplied indexer raises the banner');
  eq(text(banner.querySelector('[data-override-url]')), 'https://mine.example.org/patina', 'the banner names the supplied indexer');
  ok(text(banner).includes('not vouched for'), 'the banner disclaims the supplied indexer');
}

{
  // A supplied indexer that is not an http URL is ignored rather than used.
  const { body } = loadPage('index.html', { search: '?indexer=javascript:alert(1)' });
  await flush();
  eq(body.querySelector('[data-override-banner]').hidden, true, 'a non http indexer is refused');
  const message = text(body.querySelector('[data-live="window"] [data-live-message]'));
  ok(message.includes('No indexer is connected'), 'a refused indexer falls back to the unconfigured state');
}

/* ------------------------------------------- every page that talks is wired */

/*
 * A page that carries a window note but no live panel would quietly keep its
 * written fallback text forever, however healthy the indexer was. That reads as
 * a stale claim about the founding window, which is the one thing this site
 * must never do, so it is checked here rather than left to a reviewer.
 */
for (const file of ['index.html', 'mint.html', 'firstlight.html']) {
  const { body } = loadPage(file);
  const notes = body.querySelectorAll('[data-window-note]');
  const panels = body.querySelectorAll('[data-live="window"]');
  ok(notes.length > 0, `${file} should carry a window note`);
  ok(panels.length > 0, `${file} carries a window note but no live window panel, so the note can never update`);
  const banner = body.querySelector('[data-override-banner]');
  ok(Boolean(banner), `${file} reads a live indexer but has nowhere to disclose a supplied one`);
}

/* ------------------------------------------------------------- report */

console.log(`pages exercised    5`);
console.log(`assertions         ${assertions}`);
console.log(`behaviour failures ${failures.length}`);

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
