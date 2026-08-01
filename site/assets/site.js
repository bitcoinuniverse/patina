/*
 * PATINA site behaviour.
 *
 * Classic script, no modules, no dependencies, so the pages also work when
 * they are opened straight from disk. Loaded after assets/config.js.
 *
 * Responsibilities:
 *   1. theme toggle
 *   2. configuration driven links and text
 *   3. live data panels, with a timeout and an honest failure state
 *   4. the hold since simulator on the homepage
 *   5. copy buttons on code blocks
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

  /* Blocks to a plain duration, always hedged because 10 minutes is nominal. */
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
    var host = $('[data-override-banner]');
    if (!host) {
      return;
    }
    host.hidden = false;
    var slot = $('[data-override-url]', host);
    if (slot) {
      slot.textContent = resolveIndexerBase();
    }
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

  /* Panel specific rendering that goes beyond filling fields. */
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
    var note = $('[data-window-note]');
    var cta = $('[data-mint-cta]');
    if (!note) {
      return;
    }

    if (!data) {
      note.textContent =
        'This page cannot tell you whether the founding window is open, because it could not read a PATINA indexer. ' +
        'The Bitcoin Universe app checks the window before it builds anything, and refuses to build outside it.';
      if (cta) {
        cta.textContent = 'Open PATINA in the ' + (CONFIG.appName || 'app');
      }
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
      if (cta) {
        cta.textContent = 'Reveal a founding commit in the ' + (CONFIG.appName || 'app');
      }
    } else if (isPending) {
      text = 'The founding window has not opened yet, so nothing can be minted right now.';
      if (typeof data.h_open === 'number') {
        text += ' It opens at height ' + groupDigits(data.h_open) + '.';
      }
      if (typeof untilOpen === 'number') {
        text += ' That is ' + groupDigits(untilOpen) + ' blocks away, ' + blocksToDuration(untilOpen) + ' at ten minutes per block.';
      }
      if (cta) {
        cta.textContent = 'Open PATINA in the ' + (CONFIG.appName || 'app');
      }
    } else if (isClosed) {
      text = 'The founding window is closed. The Firstlight Seals cannot be minted any more. Anything offered as a new Firstlight Seal is not one.';
      if (cta) {
        cta.textContent = 'Open PATINA in the ' + (CONFIG.appName || 'app');
      }
    } else if (isOpen) {
      text = 'The founding window is open.';
      if (typeof remaining === 'number') {
        text += ' ' + groupDigits(remaining) + ' blocks remain, ' + blocksToDuration(remaining) + ' at ten minutes per block.';
      }
      text += ' A commit must be at least ' + PROTOCOL.commitMinAge + ' blocks old before its reveal, so leave time for that.';
      if (cta) {
        cta.textContent = 'Start a Firstlight claim in the ' + (CONFIG.appName || 'app');
      }
    } else {
      text =
        'The connected indexer reports the window state as "' +
        String(data.state) +
        '". This page does not guess at states it does not recognise. Treat the app as the check that matters.';
      if (cta) {
        cta.textContent = 'Open PATINA in the ' + (CONFIG.appName || 'app');
      }
    }

    note.textContent = text;
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

    var wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    var table = document.createElement('table');
    var caption = document.createElement('caption');
    caption.textContent = 'Concentration as reported by the connected indexer.';
    table.appendChild(caption);

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Measure', 'Value'].forEach(function (label, index) {
      var th = document.createElement('th');
      th.setAttribute('scope', 'col');
      if (index === 1) {
        th.className = 'num';
      }
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    Object.keys(block).forEach(function (key) {
      var value = block[key];
      if (value === null || typeof value === 'object') {
        return;
      }
      var row = document.createElement('tr');
      var th = document.createElement('th');
      th.setAttribute('scope', 'row');
      th.textContent = humanKey(key);
      var td = document.createElement('td');
      td.className = 'num';
      td.textContent = typeof value === 'number' || /^[0-9]+$/.test(String(value)) ? groupDigits(value) : String(value);
      row.appendChild(th);
      row.appendChild(td);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* ---------------------------------------------------------- simulator */

  var RING_MIN = 18;
  var RING_MAX = 142;

  function ringRadius(depth) {
    var last = TIERS[TIERS.length - 1];
    if (!last) {
      return RING_MIN;
    }
    var step = (RING_MAX - RING_MIN) / last.index;
    if (depth >= last.threshold) {
      return RING_MAX;
    }
    var tier = tierForDepth(depth);
    var next = nextTierForDepth(depth);
    var span = next.threshold - tier.threshold;
    var progress = span > 0 ? (depth - tier.threshold) / span : 0;
    return RING_MIN + step * (tier.index + progress);
  }

  function initSimulator() {
    var form = $('[data-simulator]');
    if (!form) {
      return;
    }

    var input = $('#sim-date', form);
    var errorBox = $('[data-sim-error]', form);
    var out = {
      blocks: $('[data-sim="blocks"]'),
      elapsed: $('[data-sim="elapsed"]'),
      tier: $('[data-sim="tier"]'),
      next: $('[data-sim="next"]'),
      toNext: $('[data-sim="to-next"]'),
      eta: $('[data-sim="eta"]')
    };
    var ringFill = $('#ring-fill');
    var ringEdge = $('#ring-edge');
    var ringDepthLabel = $('#ring-depth-label');
    var ringTierLabel = $('#ring-tier-label');
    var ladderItems = $$('[data-tier-item]');
    var scribes = $$('[data-tier-circle]');

    function toDateInputValue(date) {
      var month = String(date.getUTCMonth() + 1);
      var day = String(date.getUTCDate());
      if (month.length < 2) {
        month = '0' + month;
      }
      if (day.length < 2) {
        day = '0' + day;
      }
      return date.getUTCFullYear() + '-' + month + '-' + day;
    }

    function setError(message) {
      if (!errorBox) {
        return;
      }
      if (message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
      } else {
        errorBox.textContent = '';
        errorBox.hidden = true;
      }
    }

    function paint(depth) {
      var tier = tierForDepth(depth);
      var next = nextTierForDepth(depth);

      if (out.blocks) {
        out.blocks.textContent = groupDigits(depth);
      }
      if (out.elapsed) {
        out.elapsed.textContent = depth === 0 ? 'none yet' : blocksToDuration(depth);
      }
      if (out.tier) {
        out.tier.textContent = tier.name;
      }
      if (out.next) {
        out.next.textContent = next ? next.name : 'none, Elder is the last tier';
      }
      if (out.toNext) {
        out.toNext.textContent = next ? groupDigits(next.threshold - depth) : 'not applicable';
      }
      if (out.eta) {
        out.eta.textContent = next ? blocksToDuration(next.threshold - depth) : 'not applicable';
      }
      if (ringDepthLabel) {
        ringDepthLabel.textContent = groupDigits(depth);
      }
      if (ringTierLabel) {
        ringTierLabel.textContent = tier.name;
      }

      var radius = ringRadius(depth);
      if (ringFill) {
        ringFill.setAttribute('r', radius.toFixed(2));
      }
      if (ringEdge) {
        ringEdge.setAttribute('r', radius.toFixed(2));
        ringEdge.setAttribute('stroke', 'var(--t' + tier.index + ')');
      }

      scribes.forEach(function (circle) {
        var index = Number(circle.getAttribute('data-tier-circle'));
        var reached = TIERS[index] && depth >= TIERS[index].threshold;
        circle.setAttribute('data-reached', reached ? 'true' : 'false');
        circle.setAttribute('stroke-opacity', reached ? '0.85' : '0.28');
        circle.setAttribute('stroke-dasharray', reached ? 'none' : '2 4');
      });

      ladderItems.forEach(function (item) {
        var index = Number(item.getAttribute('data-tier-item'));
        item.setAttribute('data-reached', depth >= TIERS[index].threshold ? 'true' : 'false');
        item.setAttribute('data-current', index === tier.index ? 'true' : 'false');
      });

      var figure = $('[data-ring-figure]');
      if (figure) {
        figure.setAttribute(
          'aria-label',
          'Ring cross section at depth ' + groupDigits(depth) + ' blocks, tier ' + tier.name + '.'
        );
      }
    }

    function recompute() {
      if (!input || !input.value) {
        setError('Pick a date to see the arithmetic.');
        return;
      }
      var parts = input.value.split('-');
      var chosen = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isFinite(chosen)) {
        setError('That date could not be read.');
        return;
      }

      /*
       * The input has day granularity, so the answer should too. Both ends are
       * midnight UTC, which makes the result exactly 144 blocks per whole day
       * and the same for everyone who picks the same date.
       */
      var today = new Date();
      var todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

      if (chosen > todayUtc) {
        setError('That date is in the future. Pick a date that has already happened.');
        paint(0);
        return;
      }
      var genesis = Date.UTC(2009, 0, 3);
      if (chosen < genesis) {
        setError('Bitcoin block zero was mined on 3 January 2009. Nothing can have been held longer than that.');
        chosen = genesis;
      } else {
        setError('');
      }
      var depth = Math.max(0, Math.floor((todayUtc - chosen) / 1000 / BLOCK_SECONDS));
      paint(depth);
    }

    if (input) {
      if (!input.value) {
        input.value = toDateInputValue(new Date(Date.now() - 365 * 86400000));
      }
      input.max = toDateInputValue(new Date());
      input.addEventListener('input', recompute);
      input.addEventListener('change', recompute);
    }

    $$('[data-sim-days]', form).forEach(function (button) {
      button.addEventListener('click', function () {
        var days = Number(button.getAttribute('data-sim-days'));
        if (input) {
          input.value = toDateInputValue(new Date(Date.now() - days * 86400000));
        }
        recompute();
      });
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      recompute();
    });

    recompute();
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
    initConfigBindings();
    initCopyButtons();
    initSimulator();
    initLivePanels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
