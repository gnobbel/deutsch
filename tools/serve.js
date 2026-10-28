// Tiny static server that serves the app at /deutsch/, like GitHub Pages does.
// Usage: node tools/serve.js [--port 8080] [--root <dir>]. Dev tool only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const BASE = '/deutsch/';

export function startServer({ root, port = 8080, quiet = false }) {
  const rootDir = resolve(root);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(302, { Location: BASE }).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(rootDir, rel));
    if (!file.startsWith(rootDir) || /(^|\/)(\.git|node_modules|tools\/sources)(\/|$)/.test(rel)) {
      res.writeHead(404).end('not found');
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`Deutsch: http://localhost:${server.address().port}${BASE}`);
    ok(server);
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  startServer({ root: arg('--root', fileURLToPath(new URL('..', import.meta.url))), port: Number(arg('--port', 8080)) });
}
