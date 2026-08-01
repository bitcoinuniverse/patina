#!/usr/bin/env node
// Serves the docs directory over http for local preview.
// Node standard library only, no dependencies.
// Run: node docs/tools/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = resolve(join(ROOT, decodeURIComponent(url.pathname)));
    if (path !== ROOT && !path.startsWith(ROOT + sep)) {
      res.writeHead(403).end('outside the docs root');
      return;
    }
    let info = null;
    try { info = await stat(path); } catch { /* fall through to 404 */ }
    if (info && info.isDirectory()) {
      path = join(path, 'index.html');
      try { info = await stat(path); } catch { info = null; }
    }
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + url.pathname);
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
  console.log(`docs served from ${ROOT}`);
  console.log(`http://localhost:${PORT}/index.html`);
});
