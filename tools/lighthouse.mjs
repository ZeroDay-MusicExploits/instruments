#!/usr/bin/env node
// Lighthouse móvil sobre las 7 páginas del sitio y los 5 instrumentos, servidos
// bajo /instruments/ como GitHub Pages (con 404.html para rutas inexistentes).
//   node tools/lighthouse.mjs [--only <texto>] [--out <carpeta>]
// Necesita Chromium (CHROME_PATH o el de Playwright) y red para `npx lighthouse@13`
// la primera vez. Imprime las 4 categorías y, si alguna queda <95, qué auditorías
// fallan. No falla el proceso: mide. Ver reports/D2-lighthouse.md.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT } from './tests/lib/load-block.mjs';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = arg('--only');
const OUT = arg('--out') || join(tmpdir(), 'zd-lighthouse');
mkdirSync(OUT, { recursive: true });

const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const pages = ['index.html', ...data.order.map((s) => data.instruments[s].page), 'privacidad.html',
  ...data.order.map((s) => data.instruments[s].file.replace(/^\.\//, ''))];

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8', '.zip': 'application/zip', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const notFound = async () => { const b = await readFile(join(ROOT, '404.html')); res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(b); };
  if (!p.startsWith('/instruments/')) return notFound();
  p = p.slice('/instruments'.length); if (p.endsWith('/')) p += 'index.html';
  try {
    const f = join(ROOT, p);
    if (!f.startsWith(ROOT) || (await stat(f)).isDirectory()) throw 0;
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'content-length': b.length, 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : b);
  } catch { await notFound(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const run = (page, file) => new Promise((ok) => {
  const env = { ...process.env, CHROME_PATH: process.env.CHROME_PATH || '/usr/bin/chromium' };
  spawn('npx', ['--yes', 'lighthouse@13', `${origin}/instruments/${page}`, '--quiet', '--output=json', `--output-path=${file}`,
    '--only-categories=performance,accessibility,best-practices,seo', '--chrome-flags=--headless=new --no-sandbox'],
    { stdio: 'ignore', env }).on('close', ok);
});

for (const page of pages) {
  if (only && !page.includes(only)) continue;
  const file = join(OUT, page.replace(/[/.]/g, '_') + '.json');
  await run(page, file);
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const c = j.categories, sc = (k) => Math.round(c[k].score * 100);
  console.log(`${page.padEnd(36)} perf ${sc('performance')}  a11y ${sc('accessibility')}  bp ${sc('best-practices')}  seo ${sc('seo')}`);
  for (const k of Object.keys(c)) {
    if (c[k].score >= 0.95) continue;
    for (const r of c[k].auditRefs) {
      const a = j.audits[r.id];
      if (r.weight > 0 && a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative') console.log(`    ${k} · ${r.id} (${a.score}) ${a.displayValue || ''}`);
    }
  }
}
server.close();
