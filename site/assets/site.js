/*
 * PATINA public site behaviour.
 *
 * Classic script, no modules, no dependencies, so the pages also work when
 * they are opened straight from disk. Loaded after assets/config.js.
 *
 * Every piece of content lives in the HTML. This file adds state, never
 * meaning: it selects, highlights, counts and connects. A page with scripts
 * turned off loses the controls and keeps the words.
 *
 * Responsibilities:
 *   1. theme choice and the mobile navigation drawer
 *   2. configuration driven links and text
 *   3. live indexer panels, with a timeout and an honest failure state
 *   4. the artifact model and every view that reads from it
 *   5. the anatomy selector and the mint wizard
 *   6. copy buttons
 */
(function () {
  'use strict';

  var CONFIG = window.PATINA_CONFIG || {};
  var PROTOCOL = window.PATINA_PROTOCOL || {};
  var TIERS = PROTOCOL.tiers || [];
  var BLOCK_SECONDS = PROTOCOL.blockSeconds || 600;
  var BLOCKS_PER_DAY = 86400 / BLOCK_SECONDS;

  /* ------------------------------------------------------------- helpers */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') {
          node.textContent = attrs[key];
        } else if (attrs[key] !== null && attrs[key] !== undefined) {
          node.setAttribute(key, attrs[key]);
        }
      });
    }
    (kids || []).forEach(function (kid) {
      node.appendChild(kid);
    });
    return node;
  }

  function groupDigits(value) {
    var text = String(value);
    var negative = text.charAt(0) === '-';
    if (negative) {
      text = text.slice(1);
    }
    if (!/^[0-9]+$/.test(text)) {
      return String(value);
    }
    var out = '';
    var count = 0;
    for (var i = text.length - 1; i >= 0; i -= 1) {
      out = text.charAt(i) + out;
      count += 1;
      if (count % 3 === 0 && i > 0) {
        out = ' ' + out;
      }
    }
    return (negative ? '-' : '') + out;
  }

  function humanKey(key) {
    return String(key)
      .replace(/[_-]+/g, ' ')
      .replace(/^\s*[a-z]/, function (m) {
        return m.toUpperCase();
      });
  }

  function readPath(source, path) {
    var parts = String(path).split('.');
    var value = source;
    for (var i = 0; i < parts.length; i += 1) {
      if (value === null || typeof value !== 'object' || !(parts[i] in value)) {
        return undefined;
      }
      value = value[parts[i]];
    }
    return value;
  }

  /*
   * Blocks to a plain duration. Always hedged, because ten minutes a block is
   * the nominal target and never a promise. Depth itself is exact.
   */
  function blocksToDuration(blocks) {
    if (!isFinite(blocks) || blocks < 0) {
      return '';
    }
    var days = blocks / BLOCKS_PER_DAY;
    if (days < 1) {
      var hours = Math.round(days * 24);
      return 'about ' + hours + (hours === 1 ? ' hour' : ' hours');
    }
    if (days < 365) {
      var wholeDays = Math.round(days);
      return 'about ' + wholeDays + (wholeDays === 1 ? ' day' : ' days');
    }
    var years = Math.floor(days / 365);
    var restDays = Math.round(days - years * 365);
    var text = 'about ' + years + (years === 1 ? ' year' : ' years');
    if (restDays > 0) {
      text += ', ' + restDays + (restDays === 1 ? ' day' : ' days');
    }
    return text;
  }

  function tierForDepth(depth) {
    var found = TIERS[0];
    for (var i = 0; i < TIERS.length; i += 1) {
      if (depth >= TIERS[i].threshold) {
        found = TIERS[i];
      }
    }
    return found;
  }

  function nextTierForDepth(depth) {
    for (var i = 0; i < TIERS.length; i += 1) {
      if (TIERS[i].threshold > depth) {
        return TIERS[i];
      }
    }
    return null;
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ------------------------------------------------------------- theming */

  function effectiveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') {
      return explicit;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function paintThemeButton(button) {
    var current = effectiveTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    var label = $('[data-theme-label]', button);
    if (label) {
      label.textContent = next === 'light' ? 'Light' : 'Dark';
    }
    button.setAttribute('aria-label', 'Switch to the ' + next + ' theme');
    button.setAttribute('title', 'Switch to the ' + next + ' theme');
  }

  function initTheme() {
    var button = $('[data-theme-toggle]');
    if (!button) {
      return;
    }
    paintThemeButton(button);
    button.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        window.localStorage.setItem('patina-theme', next);
      } catch (error) {
        /* storage blocked, the choice simply does not persist */
      }
      paintThemeButton(button);
    });
    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-color-scheme: light)');
      var onChange = function () {
        paintThemeButton(button);
      };
      if (query.addEventListener) {
        query.addEventListener('change', onChange);
      } else if (query.addListener) {
        query.addListener(onChange);
      }
    }
  }

  /* -------------------------------------------------------- mobile drawer */

  function initMenu() {
    var toggle = $('[data-menu-toggle]');
    var nav = $('[data-site-nav]');
    if (!toggle || !nav) {
      return;
    }

    function setOpen(open) {
      nav.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    }

    setOpen(false);

    toggle.addEventListener('click', function () {
      setOpen(nav.getAttribute('data-open') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('a')) {
        setOpen(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    /* A drawer left open while the layout grows back to the wide nav is a trap. */
    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 66.01rem)');
      var onWide = function (event) {
        if (event.matches) {
          setOpen(false);
        }
      };
      if (wide.addEventListener) {
        wide.addEventListener('change', onWide);
      } else if (wide.addListener) {
        wide.addListener(onWide);
      }
    }
  }

  /* ------------------------------------------------- configuration values */

  function initConfigBindings() {
    $$('[data-config]').forEach(function (node) {
      var key = node.getAttribute('data-config');
      var value = CONFIG[key];
      if (!value) {
        var fallbackKey = node.getAttribute('data-config-fallback');
        if (fallbackKey) {
          value = CONFIG[fallbackKey];
        }
      }
      if (value) {
        node.textContent = value;
      }
    });

    $$('[data-config-href]').forEach(function (node) {
      var value = CONFIG[node.getAttribute('data-config-href')];
      if (value) {
        node.setAttribute('href', value);
      }
    });
  }

  /* --------------------------------------------------------- indexer base */

  var overrideBase = null;

  function resolveIndexerBase() {
    if (overrideBase !== null) {
      return overrideBase;
    }
    overrideBase = '';
    if (CONFIG.allowIndexerOverride) {
      try {
        var params = new URLSearchParams(window.location.search);
        var candidate = params.get('indexer');
        if (candidate) {
          var parsed = new URL(candidate);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            overrideBase = candidate.replace(/\/+$/, '');
          }
        }
      } catch (error) {
        overrideBase = '';
      }
    }
    if (overrideBase) {
      return overrideBase;
    }
    overrideBase = String(CONFIG.indexerBase || '').replace(/\/+$/, '');
    return overrideBase;
  }

  function usingOverride() {
    if (!CONFIG.allowIndexerOverride) {
      return false;
    }
    try {
      var params = new URLSearchParams(window.location.search);
      return Boolean(params.get('indexer')) && Boolean(resolveIndexerBase());
    } catch (error) {
      return false;
    }
  }

  function showOverrideBanner() {
    if (!usingOverride()) {
      return;
    }
    $$('[data-override-banner]').forEach(function (host) {
      host.hidden = false;
      var slot = $('[data-override-url]', host);
      if (slot) {
        slot.textContent = resolveIndexerBase();
      }
    });
  }

  function fetchJson(path) {
    var base = resolveIndexerBase();
    if (!base) {
      return Promise.reject({ kind: 'unconfigured' });
    }
    var url = base + path;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) {
        controller.abort();
      }
    }, CONFIG.requestTimeoutMs || 8000);

    return fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
      cache: 'no-store'
    })
      .then(function (response) {
        window.clearTimeout(timer);
        if (!response.ok) {
          return Promise.reject({ kind: 'status', status: response.status, url: url });
        }
        return response.json().then(
          function (data) {
            return { data: data, url: url };
          },
          function () {
            return Promise.reject({ kind: 'parse', url: url });
          }
        );
      })
      .catch(function (error) {
        window.clearTimeout(timer);
        if (error && error.kind) {
          return Promise.reject(error);
        }
        return Promise.reject({ kind: 'unreachable', url: url });
      });
  }

  /* ----------------------------------------------------------- live panels */

  function setPanelState(panel, tone, lines) {
    var state = $('[data-live-state]', panel);
    if (!state) {
      return;
    }
    state.setAttribute('data-tone', tone);
    var message = $('[data-live-message]', state);
    if (!message) {
      return;
    }
    message.textContent = '';
    lines.forEach(function (line) {
      var p = document.createElement('p');
      if (typeof line === 'string') {
        p.textContent = line;
      } else {
        p.appendChild(line);
      }
      message.appendChild(p);
    });
  }

  function fillFields(panel, data) {
    $$('[data-field]', panel).forEach(function (node) {
      var value = readPath(data, node.getAttribute('data-field'));
      var format = node.getAttribute('data-format') || 'text';
      if (value === undefined || value === null || value === '') {
        node.textContent = 'not reported';
        node.classList.add('faint');
        return;
      }
      node.classList.remove('faint');
      node.textContent = '';
      if (format === 'int' || format === 'height') {
        node.textContent = groupDigits(value);
      } else if (format === 'sats') {
        node.appendChild(document.createTextNode(groupDigits(value)));
        var unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = 'sats';
        node.appendChild(unit);
      } else if (format === 'bool') {
        node.textContent = value === true ? 'yes' : value === false ? 'no' : String(value);
      } else {
        node.textContent = String(value);
      }
    });
  }

  function noteSource(panel, url) {
    var note = $('[data-live-source]', panel);
    if (!note) {
      return;
    }
    var now = new Date();
    note.textContent = 'Read from ' + url + ' at ' + now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC.';
  }

  function failureLines(error, path) {
    var base = resolveIndexerBase();
    if (!error || error.kind === 'unconfigured') {
      return [
        'No indexer is connected, so this panel has nothing real to show.',
        'Every number on this site comes from a live request to a PATINA indexer. Nothing is cached, guessed or written by hand.',
        'To connect one, set indexerBase in assets/config.js, or add ?indexer= followed by your indexer base URL to this page address.'
      ];
    }
    if (error.kind === 'status') {
      return [
        'The indexer at ' + base + ' answered request ' + path + ' with HTTP ' + error.status + '.',
        'Nothing is filled in from cache or from guesses.'
      ];
    }
    if (error.kind === 'parse') {
      return [
        'The indexer at ' + base + ' answered ' + path + ' with a body this page could not read as JSON.',
        'Nothing is filled in from cache or from guesses.'
      ];
    }
    return [
      'Could not reach the indexer at ' + base + ' within ' + Math.round((CONFIG.requestTimeoutMs || 8000) / 1000) + ' seconds.',
      'Nothing is filled in from cache or from guesses. If you opened this page from a local file, the browser blocks the request before it leaves your machine.'
    ];
  }

  var renderers = {
    window: function (panel, data) {
      renderWindowState(data);
    },
    stats: function (panel, data) {
      renderDistribution(panel, data);
    }
  };

  function initLivePanels() {
    var panels = $$('[data-live]');
    if (!panels.length) {
      return;
    }
    showOverrideBanner();

    panels.forEach(function (panel) {
      var name = panel.getAttribute('data-live');
      var path = panel.getAttribute('data-live-path') || '/' + name;
      var body = $('[data-live-body]', panel);

      setPanelState(panel, '', ['Requesting live data from the connected indexer.']);

      fetchJson(path).then(
        function (result) {
          fillFields(panel, result.data);
          if (body) {
            body.hidden = false;
          }
          setPanelState(panel, 'ok', ['Live figures, read from the connected indexer just now.']);
          noteSource(panel, result.url);
          if (renderers[name]) {
            renderers[name](panel, result.data);
          }
        },
        function (error) {
          if (body) {
            body.hidden = true;
          }
          setPanelState(panel, error && error.kind === 'unconfigured' ? '' : 'error', failureLines(error, path));
          var note = $('[data-live-source]', panel);
          if (note) {
            note.textContent = '';
          }
          if (name === 'window') {
            renderWindowState(null);
          }
        }
      );
    });
  }

  /* ----------------------------------------------------- founding window */

  function renderWindowState(data) {
    var notes = $$('[data-window-note]');
    var ctas = $$('[data-mint-cta]');
    if (!notes.length) {
      return;
    }

    var appName = CONFIG.appName || 'app';

    function setCta(label) {
      ctas.forEach(function (cta) {
        cta.textContent = label;
      });
    }

    if (!data) {
      notes.forEach(function (note) {
        note.textContent =
          'This page cannot tell you whether the founding window is open, because it could not read a PATINA indexer. ' +
          'The opening height has not been announced here, and this page will not invent one. ' +
          'The Bitcoin Universe app checks the window before it builds anything, and refuses to build outside it.';
      });
      setCta('Open PATINA in the ' + appName);
      return;
    }

    var state = String(data.state || '').toLowerCase();
    var remaining = data.blocks_remaining;
    var untilOpen = data.blocks_until_open;
    var text;

    /*
     * The contract fixes the field but not the vocabulary, so match whole
     * words rather than substrings. Substring matching would read "pending"
     * as "ended". Order matters: "before_open" is pending, not open.
     */
    var words = state.split(/[^a-z]+/);
    var has = function (word) {
      return words.indexOf(word) !== -1;
    };
    var isGrace = has('grace');
    var isPending = has('pending') || has('before') || has('scheduled') || has('upcoming') || has('announced') || has('unopened');
    var isClosed = has('closed') || has('close') || has('ended') || has('finished') || has('complete') || has('past') || has('over');
    var isOpen = has('open') || has('active') || has('live');

    if (isGrace) {
      text =
        'The commit window has closed. Only reveals of commits that were made inside the window are still accepted, and only until height ' +
        (typeof data.grace_end === 'number' ? groupDigits(data.grace_end) : 'the end of the grace period') +
        '. No new founding commit can qualify. Nothing new can be minted into the founding cohort.';
      setCta('Reveal a founding commit in the ' + appName);
    } else if (isPending) {
      text = 'The founding window has not opened yet, so nothing can be minted right now.';
      if (typeof data.h_open === 'number') {
        text += ' It opens at height ' + groupDigits(data.h_open) + '.';
      }
      if (typeof untilOpen === 'number') {
        text += ' That is ' + groupDigits(untilOpen) + ' blocks away, ' + blocksToDuration(untilOpen) + ' at ten minutes per block.';
      }
      setCta('Open PATINA in the ' + appName);
    } else if (isClosed) {
      text = 'The founding window is closed. The Firstlight Seals cannot be minted any more. Anything offered as a new Firstlight Seal is not one.';
      setCta('Open PATINA in the ' + appName);
    } else if (isOpen) {
      text = 'The founding window is open.';
      if (typeof remaining === 'number') {
        text += ' ' + groupDigits(remaining) + ' blocks remain, ' + blocksToDuration(remaining) + ' at ten minutes per block.';
      }
      text += ' A commit must be at least ' + PROTOCOL.commitMinAge + ' blocks old before its reveal, so leave time for that.';
      setCta('Start a Firstlight claim in the ' + appName);
    } else {
      text =
        'The connected indexer reports the window state as "' +
        String(data.state) +
        '". This page does not guess at states it does not recognise. Treat the app as the check that matters.';
      setCta('Open PATINA in the ' + appName);
    }

    notes.forEach(function (note) {
      note.textContent = text;
    });
  }

  /* ------------------------------------------------ concentration figures */

  var DISTRIBUTION_KEYS = ['distribution', 'concentration', 'distribution_health', 'holders'];

  function renderDistribution(panel, data) {
    var host = $('[data-distribution]');
    if (!host) {
      return;
    }
    var block = null;
    for (var i = 0; i < DISTRIBUTION_KEYS.length; i += 1) {
      var candidate = data ? data[DISTRIBUTION_KEYS[i]] : null;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        block = candidate;
        break;
      }
    }

    host.textContent = '';

    if (!block) {
      var p = document.createElement('p');
      p.className = 'small faint';
      p.textContent =
        'The connected indexer answered, but its stats response carried no distribution block. ' +
        'Concentration figures appear here only when the indexer publishes them. Nothing is estimated in their place.';
      host.appendChild(p);
      return;
    }

    var wrap = el('div', { class: 'table-scroll' });
    var table = el('table');
    table.appendChild(el('caption', { text: 'Concentration as reported by the connected indexer.' }));

    var headRow = el('tr');
    ['Measure', 'Value'].forEach(function (label, index) {
      headRow.appendChild(el('th', { scope: 'col', class: index === 1 ? 'num' : null, text: label }));
    });
    table.appendChild(el('thead', null, [headRow]));

    var tbody = el('tbody');
    Object.keys(block).forEach(function (key) {
      var value = block[key];
      if (value === null || typeof value === 'object') {
        return;
      }
      var row = el('tr');
      row.appendChild(el('th', { scope: 'row', text: humanKey(key) }));
      row.appendChild(el('td', {
        class: 'num',
        text: typeof value === 'number' || /^[0-9]+$/.test(String(value)) ? groupDigits(value) : String(value)
      }));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* ---------------------------------------------------- the artifact model */

  /*
   * One simulated artifact, shared by every view on the page. It holds the
   * current stretch and the rings that earlier stretches left behind, which is
   * exactly the distinction the site has to make unmistakable.
   */
  function createArtifact() {
    var listeners = [];
    var state = {
      depth: 0,
      rings: [],
      moves: 0
    };

    function snapshot() {
      var tier = tierForDepth(state.depth);
      var next = nextTierForDepth(state.depth);
      var span = next ? next.threshold - tier.threshold : 0;
      return {
        depth: Math.floor(state.depth),
        rings: state.rings.slice(),
        moves: state.moves,
        tier: tier,
        next: next,
        toNext: next ? Math.max(0, next.threshold - Math.floor(state.depth)) : null,
        progress: next && span > 0 ? Math.min(1, Math.max(0, (state.depth - tier.threshold) / span)) : 1
      };
    }

    function emit() {
      var view = snapshot();
      listeners.forEach(function (fn) {
        fn(view);
      });
    }

    return {
      subscribe: function (fn) {
        listeners.push(fn);
        fn(snapshot());
      },
      read: snapshot,
      setDepth: function (value) {
        state.depth = Math.max(0, value);
        emit();
      },
      advance: function (blocks) {
        state.depth = Math.max(0, state.depth + blocks);
        emit();
      },
      /* Spending the carrier closes the stretch as a ring and starts a new one. */
      move: function () {
        var closing = Math.floor(state.depth);
        state.rings.push({
          index: state.rings.length,
          depth: closing,
          tier: tierForDepth(closing)
        });
        state.moves += 1;
        state.depth = 0;
        emit();
      },
      reset: function () {
        state.depth = 0;
        state.rings = [];
        state.moves = 0;
        emit();
      }
    };
  }

  /* ------------------------------------------------------------- specimen */

  var SPEC_MIN_R = 26;
  var SPEC_MAX_R = 152;

  /*
   * Radius uses one equal band per tier so the early tiers stay legible. The
   * picture is deliberately not linear in blocks, and the caption says so.
   */
  function specimenRadius(depth) {
    var last = TIERS[TIERS.length - 1];
    if (!last) {
      return SPEC_MIN_R;
    }
    if (depth >= last.threshold) {
      return SPEC_MAX_R;
    }
    var step = (SPEC_MAX_R - SPEC_MIN_R) / last.index;
    var tier = tierForDepth(depth);
    var next = nextTierForDepth(depth);
    var span = next.threshold - tier.threshold;
    var progress = span > 0 ? (depth - tier.threshold) / span : 0;
    return SPEC_MIN_R + step * (tier.index + progress);
  }

  function initSpecimen(artifact) {
    var host = $('[data-specimen]');
    if (!host) {
      return;
    }

    var disc = $('[data-spec-disc]', host);
    var edge = $('[data-spec-edge]', host);
    var rim = $('[data-spec-rim]', host);
    var desc = $('[data-spec-desc]', host);
    var scribes = $$('[data-scribe]', host);
    var out = {
      depth: $('[data-spec="depth"]', host),
      tier: $('[data-spec="tier"]', host),
      next: $('[data-spec="next"]', host),
      elapsed: $('[data-spec="elapsed"]', host),
      rings: $('[data-spec="rings"]', host)
    };
    var rail = $('[data-spec-rail]', host);
    var chipRow = $('[data-spec-chips]', host);

    artifact.subscribe(function (view) {
      var radius = specimenRadius(view.depth);

      if (disc) {
        disc.setAttribute('r', radius.toFixed(2));
      }
      if (edge) {
        edge.setAttribute('r', radius.toFixed(2));
        edge.setAttribute('stroke', 'var(--t' + view.tier.index + ')');
      }
      if (rim) {
        rim.setAttribute('stroke-dasharray', view.progress.toFixed(4) + ' 1');
      }

      host.setAttribute('data-tier', String(view.tier.index));

      scribes.forEach(function (circle) {
        var index = Number(circle.getAttribute('data-scribe'));
        var reached = TIERS[index] && view.depth >= TIERS[index].threshold;
        circle.setAttribute('stroke-opacity', reached ? '0.9' : '0.3');
        circle.setAttribute('stroke-dasharray', reached ? 'none' : '2 4');
      });

      if (out.depth) {
        out.depth.textContent = groupDigits(view.depth);
      }
      if (out.tier) {
        out.tier.textContent = view.tier.name;
      }
      if (out.elapsed) {
        out.elapsed.textContent = view.depth === 0 ? 'none yet' : blocksToDuration(view.depth);
      }
      if (out.next) {
        out.next.textContent = view.next
          ? groupDigits(view.toNext) + ' blocks to ' + view.next.name
          : 'Elder is the last tier';
      }
      if (out.rings) {
        out.rings.textContent = view.rings.length === 0
          ? 'none yet'
          : String(view.rings.length) + (view.rings.length === 1 ? ' ring' : ' rings');
      }
      if (rail) {
        rail.style.width = Math.round(view.progress * 100) + '%';
      }

      if (chipRow) {
        chipRow.textContent = '';
        view.rings.forEach(function (ring) {
          var chip = el('span', {
            class: 'ring-chip',
            'data-tier': String(ring.tier.index),
            title: 'A completed stretch of ' + groupDigits(ring.depth) + ' blocks, tier ' + ring.tier.name
          });
          chip.appendChild(el('span', { class: 'ring-chip-face', 'aria-hidden': 'true' }));
          chip.appendChild(el('span', { class: 'ring-chip-label', text: groupDigits(ring.depth) }));
          chipRow.appendChild(chip);
        });
      }

      if (desc) {
        desc.textContent =
          'A cut section at depth ' + groupDigits(view.depth) + ' blocks, tier ' + view.tier.name + '. ' +
          (view.rings.length
            ? view.rings.length + ' completed ' + (view.rings.length === 1 ? 'ring is' : 'rings are') + ' engraved beneath it.'
            : 'No stretch has closed yet, so there are no rings.');
      }
    });
  }

  /* ------------------------------------------------- the run of the clock */

  /*
   * The hero runs one artifact through a whole life so that a visitor sees the
   * idea rather than reads it: depth grows, tiers arrive, a move resets the
   * stretch and leaves a ring behind. Blocks are simulated and the panel says
   * so. Nothing here describes a real artifact.
   */
  function initRunner(artifact) {
    var host = $('[data-runner]');
    if (!host) {
      return;
    }
    var toggle = $('[data-runner-toggle]', host);
    var last = TIERS[TIERS.length - 1];
    if (!last) {
      return;
    }

    var running = false;
    var raf = null;
    var previous = 0;
    /* Seconds of wall clock for one tier band, so a life takes about half a minute. */
    var SECONDS_PER_BAND = 3.6;
    var HOLD_AT_ELDER = 2.6;
    /*
     * The band the page is already showing without scripts. Starting anywhere
     * else would make the specimen jump the moment this file loads, and the
     * written state would have been a lie for that instant.
     */
    var START_BAND = Number(host.getAttribute('data-runner')) || 0;
    var position = Math.min(last.index, Math.max(0, START_BAND));
    var holding = 0;

    function depthForPosition(p) {
      var index = Math.min(last.index, Math.floor(p));
      var frac = Math.min(1, Math.max(0, p - index));
      var tier = TIERS[index];
      var next = TIERS[index + 1];
      if (!next) {
        return last.threshold;
      }
      return tier.threshold + frac * (next.threshold - tier.threshold);
    }

    function frame(now) {
      if (!running) {
        return;
      }
      var delta = previous ? Math.min(0.25, (now - previous) / 1000) : 0;
      previous = now;

      if (holding > 0) {
        holding -= delta;
        if (holding <= 0) {
          artifact.move();
          position = 0;
        }
      } else {
        position += delta / SECONDS_PER_BAND;
        if (position >= last.index) {
          position = last.index;
          holding = HOLD_AT_ELDER;
        }
        artifact.setDepth(depthForPosition(position));
      }

      raf = window.requestAnimationFrame(frame);
    }

    function setRunning(next) {
      running = next;
      if (toggle) {
        toggle.setAttribute('aria-pressed', running ? 'true' : 'false');
        toggle.textContent = running ? 'Pause' : 'Run';
      }
      if (running) {
        previous = 0;
        raf = window.requestAnimationFrame(frame);
      } else if (raf !== null) {
        window.cancelAnimationFrame(raf);
        raf = null;
      }
    }

    /* Paint the written state before the first frame, so nothing flickers. */
    artifact.setDepth(depthForPosition(position));

    var handedOver = false;

    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', function () {
        handedOver = false;
        setRunning(!running);
      });
    }

    /* A run nobody can see is only a way to spend a battery. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && running) {
        setRunning(false);
      }
    });

    /* Once a visitor drives the artifact themselves, it stays theirs. */
    document.addEventListener('patina:manual', function () {
      handedOver = true;
      if (running) {
        setRunning(false);
      }
    });

    if (prefersReducedMotion()) {
      /*
       * Reduced motion gets the same story told at rest: a worked example that
       * has already lived through one stretch and is partway through another.
       */
      artifact.setDepth(TIERS[2] ? TIERS[2].threshold : 0);
      artifact.move();
      artifact.setDepth(12960 + 4200);
      if (toggle) {
        toggle.hidden = true;
      }
      return;
    }

    if (window.IntersectionObserver) {
      var observer = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !running && !handedOver && !document.hidden) {
            setRunning(true);
          } else if (!entry.isIntersecting && running) {
            setRunning(false);
          }
        });
      }, { threshold: 0.25 });
      observer.observe(host);
    } else {
      setRunning(true);
    }
  }

  /* --------------------------------------------------- passage of blocks */

  function initPassage(artifact) {
    var host = $('[data-passage]');
    if (!host) {
      return;
    }

    var out = {
      depth: $('[data-pass="depth"]', host),
      elapsed: $('[data-pass="elapsed"]', host),
      tier: $('[data-pass="tier"]', host),
      next: $('[data-pass="next"]', host),
      toNext: $('[data-pass="to-next"]', host),
      eta: $('[data-pass="eta"]', host)
    };
    var column = $('[data-strata]', host);
    var announce = $('[data-pass-announce]', host);

    /*
     * Any hand on the controls stops the hero running by itself. Two things
     * driving one artifact would fight each other, and the visitor should win.
     */
    function manual(run) {
      return function () {
        document.dispatchEvent(new CustomEvent('patina:manual'));
        run();
      };
    }

    $$('[data-advance]', host).forEach(function (button) {
      button.addEventListener('click', manual(function () {
        artifact.advance(Number(button.getAttribute('data-advance')));
      }));
    });

    $$('[data-artifact-move]', host).forEach(function (button) {
      button.addEventListener('click', manual(function () {
        artifact.move();
      }));
    });

    $$('[data-artifact-reset]', host).forEach(function (button) {
      button.addEventListener('click', manual(function () {
        artifact.reset();
      }));
    });

    artifact.subscribe(function (view) {
      host.setAttribute('data-tier', String(view.tier.index));

      if (out.depth) {
        out.depth.textContent = groupDigits(view.depth);
      }
      if (out.elapsed) {
        out.elapsed.textContent = view.depth === 0 ? 'none yet' : blocksToDuration(view.depth);
      }
      if (out.tier) {
        out.tier.textContent = view.tier.name;
      }
      if (out.next) {
        out.next.textContent = view.next ? view.next.name : 'none, Elder is the last tier';
      }
      if (out.toNext) {
        out.toNext.textContent = view.next ? groupDigits(view.toNext) : 'not applicable';
      }
      if (out.eta) {
        out.eta.textContent = view.next ? blocksToDuration(view.toNext) : 'not applicable';
      }

      if (column) {
        paintStrata(column, view);
      }

      if (announce) {
        announce.textContent =
          'Depth ' + groupDigits(view.depth) + ' blocks, tier ' + view.tier.name +
          (view.next ? ', ' + groupDigits(view.toNext) + ' blocks to ' + view.next.name : ', the last tier') + '.';
      }
    });
  }

  /*
   * The strata column: the current stretch drawn as sediment, with the tier
   * thresholds scribed across it.
   *
   * The scale is one equal band per tier, the same mapping the disc uses, and
   * the caption says so. A linear scale would pack Raw through Verdigris into
   * the bottom seven percent of the column and leave five of the eight labels
   * unreadable, which would be accurate and useless at the same time.
   */
  function paintStrata(column, view) {
    var svg = $('svg', column);
    if (!svg) {
      return;
    }
    var layers = $('[data-strata-layers]', svg);
    var marker = $('[data-strata-marker]', svg);
    var label = $('[data-strata-label]', column);
    if (!layers) {
      return;
    }

    var last = TIERS[TIERS.length - 1];
    var position = last ? Math.min(last.index, view.tier.index + (view.next ? view.progress : 0)) : 0;
    var fraction = last && last.index > 0 ? position / last.index : 0;
    var top = 12;
    var bottom = 236;
    var height = (bottom - top) * fraction;

    var fill = $('[data-strata-fill]', layers);
    if (fill) {
      fill.setAttribute('y', String(bottom - height));
      fill.setAttribute('height', height.toFixed(2));
      fill.setAttribute('fill', 'var(--t' + view.tier.index + ')');
    }
    if (marker) {
      marker.setAttribute('transform', 'translate(0 ' + (bottom - height).toFixed(2) + ')');
    }
    if (label) {
      label.textContent = groupDigits(view.depth) + ' blocks';
    }
  }

  /* --------------------------------------------------------- tier ladder */

  function initLadder(artifact) {
    var host = $('[data-ladder]');
    if (!host) {
      return;
    }
    var rungs = $$('[data-rung]', host);

    artifact.subscribe(function (view) {
      rungs.forEach(function (rung) {
        var index = Number(rung.getAttribute('data-rung'));
        var tier = TIERS[index];
        var reached = tier && view.depth >= tier.threshold;
        rung.setAttribute('data-reached', reached ? 'true' : 'false');
        rung.setAttribute('data-current', index === view.tier.index ? 'true' : 'false');
        var state = $('[data-rung-state]', rung);
        if (state) {
          if (index === view.tier.index) {
            state.textContent = 'Held now';
          } else if (reached) {
            state.textContent = 'Passed';
          } else if (view.next && index === view.next.index) {
            state.textContent = groupDigits(view.toNext) + ' blocks away';
          } else {
            state.textContent = 'Ahead';
          }
        }
      });
    });
  }

  /* ------------------------------------------------------------- anatomy */

  /*
   * The parts of an artifact live in the page as a definition list, so they
   * read without scripts. Here that list becomes a selector: one part at a
   * time, with the matching label lit in the drawing.
   */
  function initAnatomy() {
    var host = $('[data-anatomy]');
    if (!host) {
      return;
    }
    var list = $('[data-anatomy-list]', host);
    var figure = $('[data-anatomy-figure]', host);
    if (!list) {
      return;
    }

    var terms = $$('dt', list);
    if (!terms.length) {
      return;
    }

    var parts = terms.map(function (dt, index) {
      var body = [];
      var node = dt.nextElementSibling;
      while (node && node.tagName === 'DD') {
        body.push(node);
        node = node.nextElementSibling;
      }
      return {
        index: index,
        key: dt.getAttribute('data-part') || String(index),
        label: dt.getAttribute('data-part-label') || dt.textContent.trim(),
        title: dt.textContent.trim(),
        value: dt.getAttribute('data-part-value') || '',
        dt: dt,
        body: body
      };
    });

    var buttons = el('ul', { class: 'anatomy-parts' });
    var detail = el('div', { class: 'part-detail', id: 'anatomy-detail', role: 'region', 'aria-live': 'polite' });
    list.parentNode.insertBefore(buttons, list);
    list.parentNode.insertBefore(detail, list);
    list.hidden = true;

    function show(part) {
      detail.textContent = '';
      detail.appendChild(el('h3', { text: part.title }));
      if (part.value) {
        detail.appendChild(el('p', { class: 'part-value', text: part.value }));
      }
      part.body.forEach(function (dd) {
        var p = el('p');
        p.innerHTML = dd.innerHTML;
        detail.appendChild(p);
      });

      $$('.part-btn', buttons).forEach(function (btn) {
        btn.setAttribute('aria-pressed', btn.getAttribute('data-for') === part.key ? 'true' : 'false');
      });

      if (figure) {
        $$('[data-part-mark]', figure).forEach(function (mark) {
          var on = mark.getAttribute('data-part-mark') === part.key;
          mark.setAttribute('class', mark.getAttribute('data-base-class') + (on ? ' ' + mark.getAttribute('data-on-class') : ''));
        });
      }
    }

    parts.forEach(function (part) {
      var button = el('button', {
        type: 'button',
        class: 'part-btn',
        'data-for': part.key,
        'aria-pressed': 'false',
        'aria-controls': 'anatomy-detail',
        text: part.label
      });
      button.addEventListener('click', function () {
        show(part);
      });
      buttons.appendChild(el('li', null, [button]));
    });

    if (figure) {
      $$('[data-part-mark]', figure).forEach(function (mark) {
        mark.setAttribute('data-base-class', mark.getAttribute('class') || '');
        mark.setAttribute('data-on-class', mark.getAttribute('data-on-class') || 'lbl-on');
      });
      $$('[data-part-pick]', figure).forEach(function (hot) {
        hot.addEventListener('click', function () {
          var key = hot.getAttribute('data-part-pick');
          var match = parts.filter(function (p) {
            return p.key === key;
          })[0];
          if (match) {
            show(match);
          }
        });
      });
    }

    show(parts[0]);
  }

  /* ---------------------------------------------------------- mint wizard */

  /*
   * The mint steps are ordinary sections in the page. With scripts available
   * they become a tab set, so the journey is one step at a time instead of one
   * long wall.
   */
  function initWizard() {
    var host = $('[data-wizard]');
    if (!host) {
      return;
    }
    var steps = $$('[data-step]', host);
    if (steps.length < 2) {
      return;
    }

    var track = el('div', { class: 'wizard-track', role: 'tablist', 'aria-label': 'Mint steps' });
    host.insertBefore(track, host.firstChild);

    var nav = el('div', { class: 'wizard-nav' });
    var back = el('button', { type: 'button', class: 'btn btn-small', text: 'Back' });
    var forward = el('button', { type: 'button', class: 'btn btn-small btn-primary', text: 'Next step' });
    nav.appendChild(back);
    nav.appendChild(forward);
    host.appendChild(nav);

    var current = 0;

    function select(index) {
      current = Math.min(steps.length - 1, Math.max(0, index));
      steps.forEach(function (step, i) {
        step.hidden = i !== current;
      });
      $$('button', track).forEach(function (tab, i) {
        tab.setAttribute('aria-selected', i === current ? 'true' : 'false');
        tab.setAttribute('tabindex', i === current ? '0' : '-1');
      });
      back.disabled = current === 0;
      forward.disabled = current === steps.length - 1;
      back.setAttribute('aria-disabled', current === 0 ? 'true' : 'false');
      forward.setAttribute('aria-disabled', current === steps.length - 1 ? 'true' : 'false');
    }

    steps.forEach(function (step, index) {
      /* A step that already has an id keeps it, so deep links stay valid. */
      var id = step.id || 'wizard-step-' + (index + 1);
      step.id = id;
      step.setAttribute('role', 'tabpanel');
      step.setAttribute('tabindex', '0');
      step.setAttribute('aria-labelledby', id + '-tab');

      var tab = el('button', {
        type: 'button',
        role: 'tab',
        id: id + '-tab',
        'aria-controls': id,
        'aria-selected': 'false',
        tabindex: '-1'
      });
      tab.appendChild(el('span', { class: 'n', text: 'Step ' + (index + 1) }));
      tab.appendChild(el('span', { class: 's', text: step.getAttribute('data-step') }));
      tab.addEventListener('click', function () {
        select(index);
      });
      tab.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          var next = index + (event.key === 'ArrowRight' ? 1 : -1);
          if (next >= 0 && next < steps.length) {
            select(next);
            $$('button', track)[next].focus();
          }
        }
      });
      track.appendChild(tab);
    });

    back.addEventListener('click', function () {
      select(current - 1);
      steps[current].focus();
    });
    forward.addEventListener('click', function () {
      select(current + 1);
      steps[current].focus();
    });

    /*
     * A link from another page can name a step. Landing on a step that the
     * wizard has hidden would look like a broken page, so honour the fragment.
     */
    function selectFromHash() {
      var wanted = String(window.location.hash || '').slice(1);
      if (!wanted) {
        return false;
      }
      for (var i = 0; i < steps.length; i += 1) {
        if (steps[i].id === wanted) {
          select(i);
          return true;
        }
      }
      return false;
    }

    window.addEventListener('hashchange', selectFromHash);

    if (!selectFromHash()) {
      select(0);
    }
  }

  /* ------------------------------------------------------- fee estimator */

  /*
   * What the two mint transactions cost in miner fees at a fee rate the
   * visitor picks. Nothing is fetched: this is arithmetic over the transaction
   * sizes in config.js, and the page says so. The endowment is not a fee and
   * is deliberately not added in here.
   */
  function initFeeEstimator() {
    var host = $('[data-fee-estimator]');
    if (!host) {
      return;
    }
    var input = $('[data-fee-rate]', host);
    var sizes = PROTOCOL.mintVbytes || { commit: 154, reveal: 173, total: 327 };
    var out = {
      commit: $('[data-fee="commit"]', host),
      reveal: $('[data-fee="reveal"]', host),
      total: $('[data-fee="total"]', host)
    };
    var error = $('[data-fee-error]', host);

    function paint() {
      var rate = input ? Number(input.value) : NaN;
      var valid = isFinite(rate) && rate > 0 && rate <= 5000;

      if (error) {
        if (input && input.value !== '' && !valid) {
          error.textContent = 'Enter a fee rate between 1 and 5000 satoshis per virtual byte.';
          error.hidden = false;
        } else {
          error.textContent = '';
          error.hidden = true;
        }
      }

      if (!valid) {
        return;
      }

      if (out.commit) {
        out.commit.textContent = groupDigits(Math.ceil(sizes.commit * rate));
      }
      if (out.reveal) {
        out.reveal.textContent = groupDigits(Math.ceil(sizes.reveal * rate));
      }
      if (out.total) {
        out.total.textContent = groupDigits(Math.ceil(sizes.total * rate));
      }
    }

    if (input) {
      input.addEventListener('input', paint);
      input.addEventListener('change', paint);
    }

    $$('[data-fee-preset]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        if (input) {
          input.value = button.getAttribute('data-fee-preset');
        }
        paint();
      });
    });

    host.addEventListener('submit', function (event) {
      event.preventDefault();
      paint();
    });

    paint();
  }

  /* -------------------------------------------------------- copy buttons */

  function initCopyButtons() {
    $$('[data-copy]').forEach(function (button) {
      var target = document.getElementById(button.getAttribute('data-copy'));
      if (!target) {
        return;
      }
      button.hidden = false;
      var original = button.textContent;
      button.addEventListener('click', function () {
        var text = target.innerText;
        var done = function (ok) {
          button.textContent = ok ? 'Copied' : 'Copy failed';
          button.classList.toggle('copy-ok', ok);
          window.setTimeout(function () {
            button.textContent = original;
            button.classList.remove('copy-ok');
          }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () {
              done(true);
            },
            function () {
              done(false);
            }
          );
        } else {
          done(false);
        }
      });
    });
  }

  /* ------------------------------------------------------------- startup */

  function start() {
    initTheme();
    initMenu();
    initConfigBindings();
    initCopyButtons();

    var artifact = createArtifact();
    initSpecimen(artifact);
    initLadder(artifact);
    initPassage(artifact);
    initRunner(artifact);
    initAnatomy();
    initWizard();
    initFeeEstimator();

    initLivePanels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
