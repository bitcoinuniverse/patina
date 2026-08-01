/* PATINA documentation shell.
   Plain browser JavaScript, no framework, no bundler, no network calls.
   Loaded as a classic script on purpose: module scripts are blocked by the
   browser when a page is opened straight from disk with a file:// URL, and
   these pages have to work from disk. */

(function () {
  'use strict';

  var body = document.body;
  var ROOT = body.getAttribute('data-root') || '';
  var PAGE = body.getAttribute('data-page') || 'index.html';
  var NAV = window.PATINA_NAV || [];

  /* ---------------------------------------------------------- helpers */
  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (kid) { node.appendChild(kid); });
    return node;
  }

  function flatten() {
    var out = [];
    NAV.forEach(function (sec) {
      sec.pages.forEach(function (page) {
        out.push({ path: page.path, title: page.title, blurb: page.blurb, section: sec.title, sectionId: sec.id });
      });
    });
    return out;
  }

  var FLAT = flatten();
  var here = FLAT.filter(function (p) { return p.path === PAGE; })[0] || null;

  /* ---------------------------------------------------------- theme */
  var THEME_KEY = 'patina-docs-theme';

  function readTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function applyTheme(value) {
    if (value === 'light' || value === 'dark') document.documentElement.setAttribute('data-theme', value);
    else document.documentElement.removeAttribute('data-theme');
  }

  function currentTheme() {
    var stored = readTheme();
    if (stored) return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  /* ---------------------------------------------------------- topbar */
  function buildTopbar() {
    var bar = document.querySelector('.topbar');
    if (!bar) return;

    bar.appendChild(el('span', { class: 'spacer' }));

    var input = el('input', {
      type: 'search',
      id: 'q',
      placeholder: 'Search the docs',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Search the documentation',
      'aria-controls': 'results',
      'aria-expanded': 'false'
    });
    var results = el('ul', { class: 'results', id: 'results', 'aria-label': 'Search results' });
    var search = el('div', { class: 'search' }, [input, results]);
    bar.appendChild(search);

    var themeBtn = el('button', { type: 'button', class: 'iconbtn', id: 'themebtn' });
    var setLabel = function () {
      var t = currentTheme();
      themeBtn.textContent = t === 'light' ? 'Dark' : 'Light';
      themeBtn.setAttribute('aria-label', 'Switch to ' + (t === 'light' ? 'dark' : 'light') + ' theme');
    };
    setLabel();
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage may be blocked */ }
      applyTheme(next);
      setLabel();
    });
    bar.appendChild(themeBtn);

    var menuBtn = el('button', {
      type: 'button',
      class: 'iconbtn menubtn',
      id: 'menubtn',
      'aria-controls': 'sidebar',
      'aria-expanded': 'false',
      text: 'Contents'
    });
    menuBtn.addEventListener('click', function () {
      var side = document.getElementById('sidebar');
      var open = side.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    bar.appendChild(menuBtn);

    wireSearch(input, results);
  }

  /* ---------------------------------------------------------- sidebar */
  function buildSidebar() {
    var mount = document.getElementById('nav');
    if (!mount) return;
    NAV.forEach(function (sec, i) {
      var list = el('ul');
      sec.pages.forEach(function (page) {
        var a = el('a', { href: ROOT + page.path, text: page.title });
        if (page.path === PAGE) a.setAttribute('aria-current', 'page');
        list.appendChild(el('li', null, [a]));
      });
      var heading = el('h2', null, [
        el('span', { class: 'idx', text: String(i + 1).padStart(2, '0') }),
        el('span', { text: sec.title })
      ]);
      mount.appendChild(el('section', { class: 'navsection' }, [heading, list]));
    });
  }

  /* ---------------------------------------------------------- breadcrumb */
  function buildCrumb() {
    var mount = document.getElementById('crumb');
    if (!mount || !here) return;
    var list = el('ol');
    list.appendChild(el('li', null, [el('a', { href: ROOT + 'index.html', text: 'Docs' })]));
    if (PAGE !== 'index.html') {
      var first = FLAT.filter(function (p) { return p.sectionId === here.sectionId; })[0];
      list.appendChild(el('li', null, [el('a', { href: ROOT + first.path, text: here.section })]));
      list.appendChild(el('li', { 'aria-current': 'page', text: here.title }));
    } else {
      list.appendChild(el('li', { 'aria-current': 'page', text: here.title }));
    }
    mount.appendChild(list);
  }

  /* ---------------------------------------------------------- pager */
  function buildPager() {
    var mount = document.getElementById('pager');
    if (!mount || !here) return;
    var i = FLAT.indexOf(here);
    var prev = i > 0 ? FLAT[i - 1] : null;
    var next = i > -1 && i < FLAT.length - 1 ? FLAT[i + 1] : null;
    if (prev) {
      mount.appendChild(el('a', { href: ROOT + prev.path, class: 'prev', rel: 'prev' }, [
        el('span', { class: 'dir', text: 'Previous' }),
        el('span', { class: 'ttl', text: prev.title })
      ]));
    }
    if (next) {
      mount.appendChild(el('a', { href: ROOT + next.path, class: 'next', rel: 'next' }, [
        el('span', { class: 'dir', text: 'Next' }),
        el('span', { class: 'ttl', text: next.title })
      ]));
    }
  }

  /* ---------------------------------------------------------- on this page */
  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function buildToc() {
    var article = document.querySelector('.content article');
    var mount = document.getElementById('toc');
    if (!article) return;
    var heads = [].slice.call(article.querySelectorAll('h2, h3'));
    heads.forEach(function (h) {
      if (!h.id) h.id = slug(h.textContent);
      var link = el('a', { class: 'anchor', href: '#' + h.id, 'aria-label': 'Link to this section', text: '#' });
      h.insertBefore(link, h.firstChild);
    });
    if (!mount || heads.length < 3) return;
    var list = el('ul');
    heads.forEach(function (h) {
      var a = el('a', { href: '#' + h.id, text: h.textContent.replace(/^#/, '').trim() });
      list.appendChild(el('li', { class: h.tagName === 'H3' ? 'lvl3' : 'lvl2' }, [a]));
    });
    mount.appendChild(el('h2', { text: 'On this page' }));
    mount.appendChild(list);
    trackToc(heads, list);
  }

  function trackToc(heads, list) {
    if (!window.IntersectionObserver) return;
    var links = {};
    [].slice.call(list.querySelectorAll('a')).forEach(function (a) {
      links[a.getAttribute('href').slice(1)] = a;
    });
    var seen = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { seen[entry.target.id] = entry.isIntersecting; });
      var active = null;
      heads.forEach(function (h) { if (seen[h.id] && !active) active = h.id; });
      Object.keys(links).forEach(function (id) { links[id].classList.toggle('here', id === active); });
    }, { rootMargin: '-10% 0px -70% 0px' });
    heads.forEach(function (h) { observer.observe(h); });
  }

  /* ---------------------------------------------------------- code blocks */
  function copyText(text, btn) {
    var done = function (ok) {
      btn.textContent = ok ? 'Copied' : 'Press Ctrl C';
      btn.setAttribute('data-state', ok ? 'done' : 'manual');
      window.setTimeout(function () {
        btn.textContent = 'Copy';
        btn.removeAttribute('data-state');
      }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }

  function enhanceCode() {
    [].slice.call(document.querySelectorAll('.content pre')).forEach(function (pre, i) {
      var wrap = el('div', { class: 'codewrap' });
      pre.parentNode.insertBefore(wrap, pre);
      var label = pre.getAttribute('data-label');
      if (label) {
        wrap.appendChild(el('div', { class: 'codelabel', text: label }));
      }
      wrap.appendChild(pre);
      if (pre.hidden) wrap.hidden = true;
      var name = label || 'code block ' + (i + 1);
      var btn = el('button', { type: 'button', class: 'copybtn', 'aria-label': 'Copy ' + name, text: 'Copy' });
      btn.addEventListener('click', function () { copyText(pre.textContent.replace(/\s+$/, ''), btn); });
      wrap.appendChild(btn);
    });
  }

  /* ---------------------------------------------------------- search */
  function tokenize(s) {
    return s.toLowerCase().split(/[^a-z0-9/._-]+/).filter(function (t) { return t.length > 1; });
  }

  function snippet(text, terms) {
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length && at < 0; i++) at = lower.indexOf(terms[i]);
    if (at < 0) at = 0;
    var start = Math.max(0, at - 45);
    var cut = text.slice(start, start + 150).trim();
    return (start > 0 ? '... ' : '') + cut + (start + 150 < text.length ? ' ...' : '');
  }

  function score(page, terms) {
    var total = 0;
    var title = page.t.toLowerCase();
    var heads = (page.h || []).join(' ').toLowerCase();
    var text = (page.x || '').toLowerCase();
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var hit = 0;
      if (title.indexOf(term) > -1) hit += 12;
      if (heads.indexOf(term) > -1) hit += 5;
      var count = 0, from = 0, at;
      while ((at = text.indexOf(term, from)) > -1 && count < 20) { count++; from = at + term.length; }
      hit += Math.min(count, 8);
      if (hit === 0) return 0;
      total += hit;
    }
    return total;
  }

  function wireSearch(input, results) {
    var index = (window.PATINA_SEARCH && window.PATINA_SEARCH.pages) || null;

    function clear() {
      results.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }

    function run() {
      var raw = input.value.trim();
      if (raw.length < 2) { clear(); return; }
      results.innerHTML = '';
      input.setAttribute('aria-expanded', 'true');

      if (!index) {
        results.appendChild(el('li', null, [el('p', {
          class: 'r-none',
          text: 'The search index is not loaded. Run node docs/tools/build-search-index.mjs, or use the contents list on the left.'
        })]));
        return;
      }
      var terms = tokenize(raw);
      if (!terms.length) { clear(); return; }
      var hits = index
        .map(function (p) { return { p: p, s: score(p, terms) }; })
        .filter(function (h) { return h.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8);

      if (!hits.length) {
        results.appendChild(el('li', null, [el('p', { class: 'r-none', text: 'Nothing matched "' + raw + '".' })]));
        return;
      }
      hits.forEach(function (hit) {
        var a = el('a', { href: ROOT + hit.p.p }, [
          el('span', { class: 'r-sec', text: hit.p.s }),
          el('span', { class: 'r-title', text: hit.p.t }),
          el('span', { class: 'r-snip', text: snippet(hit.p.x || '', terms) })
        ]);
        results.appendChild(el('li', null, [a]));
      });
    }

    input.addEventListener('input', run);
    input.addEventListener('focus', run);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; clear(); input.blur(); }
      if (e.key === 'ArrowDown') {
        var first = results.querySelector('a');
        if (first) { e.preventDefault(); first.focus(); }
      }
    });

    results.addEventListener('keydown', function (e) {
      var links = [].slice.call(results.querySelectorAll('a'));
      var at = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && at > -1 && at < links.length - 1) { e.preventDefault(); links[at + 1].focus(); }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (at > 0) links[at - 1].focus(); else input.focus();
      }
      if (e.key === 'Escape') { clear(); input.focus(); }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.search')) clear();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  /* ---------------------------------------------------------- boot */
  applyTheme(readTheme());
  buildTopbar();
  buildSidebar();
  buildCrumb();
  buildPager();
  buildToc();
  enhanceCode();
})();
