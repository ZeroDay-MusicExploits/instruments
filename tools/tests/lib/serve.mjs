// Servidor estático mínimo para los tests de navegador: los instrumentos tienen
// que correr sobre http:// para que `zd-pwa` no tome la rama de file://.
// Sin dependencias.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { ROOT } from './load-block.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8',
};

/** Sirve ROOT en un puerto libre. -> { origin, close() } */
export async function serveRoot(root = ROOT) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (rel.endsWith('/')) rel += 'index.html';
      const file = join(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403).end('403'); return; }
      const info = await stat(file);
      if (info.isDirectory()) { res.writeHead(404).end('404'); return; }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/** Carga playwright con un mensaje claro si no está instalado. */
export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (err) {
    throw new Error(
      'Este test necesita Playwright (no es dependencia del runtime, solo de los tests):\n' +
      '  npm i -D playwright && npx playwright install chromium\n' + err.message
    );
  }
}
