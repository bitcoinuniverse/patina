#!/usr/bin/env node
/*
 * Serves the assembled PATINA tree for local preview.
 *
 * Run: node site/tools/serve.mjs [port]
 *
 * The published tree puts site/ at the root and docs/ at /docs, so this server
 * maps the same two directories the same way. That makes a local preview an
 * accurate one: the links that cross between the public site and the
 * documentation resolve here exactly as they resolve once published.
 *
 * Node standard library only, no dependencies, no network access beyond the
 * loopback listener it opens.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const REPO = resolve(SITE, '..');
const DOCS = join(REPO, 'docs');
const PORT = Number(process.argv[2] || 8081);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function locate(pathname) {
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return { root: DOCS, rest: pathname.slice('/docs'.length) || '/' };
  }
  return { root: SITE, rest: pathname };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const { root, rest } = locate(decodeURIComponent(url.pathname));
    let path = resolve(join(root, rest));

    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('outside the served roots');
      return;
    }

    let info = null;
    try {
      info = await stat(path);
    } catch {
      /* fall through to the not found page */
    }
    if (info && info.isDirectory()) {
      path = join(path, 'index.html');
      try {
        info = await stat(path);
      } catch {
        info = null;
      }
    }

    if (!info) {
      /* Serve the real 404 page so its layout can be checked too. */
      try {
        const body = await readFile(join(SITE, '404.html'));
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + url.pathname);
      }
      return;
    }

    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(err));
  }
});

server.listen(PORT, () => {
  console.log('PATINA preview, assembled the way it publishes');
  console.log('  site  ' + SITE + '  served at /');
  console.log('  docs  ' + DOCS + '  served at /docs');
  console.log('');
  console.log('http://localhost:' + PORT + '/index.html');
});
