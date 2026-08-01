/* Live prober for the endpoint reference page.
   It reads from an indexer that the reader supplies. There is no default host,
   no bundled data, and nothing is displayed until a real request succeeds.
   Nothing is sent anywhere except the URL the reader typed. */

(function () {
  'use strict';

  var KEY = 'patina-docs-indexer';
  var API = '/patina';
  var form = document.getElementById('probe-form');
  if (!form) return;

  var input = document.getElementById('probe-base');
  var state = document.getElementById('probe-state');
  var out = document.getElementById('probe-out');

  try {
    var saved = localStorage.getItem(KEY);
    if (saved) input.value = saved;
  } catch (e) { /* storage may be blocked, that is fine */ }

  function show(message) {
    state.textContent = message;
  }

  // The shell wraps every pre in a container that carries the copy button, so
  // both the pre and its wrapper have to be hidden together.
  function reveal(visible) {
    out.hidden = !visible;
    var wrap = out.parentNode;
    if (wrap && wrap.classList && wrap.classList.contains('codewrap')) wrap.hidden = !visible;
  }

  function normalise(raw) {
    var base = raw.trim().replace(/\s+/g, '');
    if (!base) return null;
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
    base = base.replace(/\/+$/, '');
    if (base.toLowerCase().slice(-API.length) === API) base = base.slice(0, -API.length);
    return base;
  }

  function get(base, path) {
    return fetch(base + API + path, {
      method: 'GET',
      headers: { accept: 'application/json' },
      mode: 'cors',
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (body) {
        return { path: path, status: res.status, ok: res.ok, body: body };
      });
    });
  }

  function pretty(result) {
    var head = 'GET ' + API + result.path + '  ->  ' + result.status;
    var body = result.body;
    try { body = JSON.stringify(JSON.parse(result.body), null, 2); } catch (e) { /* not json, print raw */ }
    return head + '\n' + body;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var base = normalise(input.value);
    reveal(false);
    out.textContent = '';

    if (!base) {
      show('Enter the base URL of an indexer, for example https://indexer.example.org');
      return;
    }
    try { localStorage.setItem(KEY, input.value.trim()); } catch (e) { /* ignore */ }

    show('Requesting ' + base + API + '/status and ' + API + '/window ...');

    Promise.all([get(base, '/status'), get(base, '/window')]).then(function (results) {
      out.textContent = results.map(pretty).join('\n\n');
      reveal(true);
      var failed = results.filter(function (r) { return !r.ok; });
      if (failed.length) {
        show('Answered, but ' + failed.length + ' of 2 requests returned an error status. The raw responses are below.');
      } else {
        show('Answered at ' + new Date().toISOString() + '. These are the raw responses, not our numbers.');
      }
    }).catch(function (err) {
      show(
        'No answer from ' + base + '. The request failed before any data arrived. ' +
        'Common causes: the indexer is not running, the URL is wrong, the page was opened from disk and the ' +
        'browser blocked a cross origin request, or the indexer does not send CORS headers for this page. ' +
        'Browser message: ' + (err && err.message ? err.message : String(err))
      );
    });
  });
})();
