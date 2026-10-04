#!/usr/bin/env node
// tools/tests/favicon.test.mjs
//
// Cada instrumento declara su favicon inline (reports/D2-lighthouse.md: sin
// <link rel="icon"> el navegador pide /favicon.ico y da 404, Best Practices
// 96; reports/E1.md, tarea 8). Es un PNG de 32×32 como data: URI: el ícono
// de la PWA (icons/<slug>-192.png, isotipo sobre el color de acento)
// promediado en bloques de 6×6. Sin pedidos de red y sin archivos nuevos:
// anda igual en file://.
//
//   1. archivo: un solo <link rel="icon"> con data:image/png, que decodifica a
//      32×32 y cuyo fondo es el color de acento del ícono de 192;
//   2. navegador, http y file://: el link resuelve a data: y la imagen carga.
//
//   node tools/tests/favicon.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const FILES = readdirSync(join(ROOT, 'descargables')).filter((f) => f.endsWith('.html')).sort();

for (const f of FILES) {
  test(`${f} · favicon inline de 32×32 con el color de acento`, () => {
    const src = readFileSync(join(ROOT, 'descargables', f), 'utf8');
    const head = src.slice(0, src.indexOf('</head>'));
    const links = head.match(/<link[^>]+rel="(?:shortcut )?icon"[^>]*>/g) || [];
    assert.equal(links.length, 1, 'tiene que haber exactamente un <link rel="icon">');
    const m = /href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(links[0]);
    assert.ok(m, 'el favicon tiene que ser un PNG inline (data:image/png;base64)');
    const png = PNG.sync.read(Buffer.from(m[1], 'base64'));
    const slug = /href="\.\.\/icons\/([a-z0-9-]+)-apple-touch-180\.png"/.exec(src)[1];
    const icon = PNG.sync.read(readFileSync(join(ROOT, 'icons', `${slug}-192.png`)));
    const bg = (p) => [p.data[0], p.data[1], p.data[2]].join(',');
    console.log(`  ${f}: ${png.width}×${png.height} · ${m[1].length} B en base64 · fondo ${bg(png)} (ícono ${slug}: ${bg(icon)})`);
    assert.deepEqual([png.width, png.height], [32, 32]);
    assert.equal(bg(png), bg(icon), 'el fondo es el color de acento del ícono de la PWA');
  });
}

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT);
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

for (const f of FILES) {
  test(`${f} · el favicon resuelve a data: y carga (http y file://)`, async () => {
    for (const url of [`${srv.origin}/descargables/${f}`, pathToFileURL(join(ROOT, 'descargables', f)).href]) {
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: 'load' });
        const r = await page.evaluate(() => new Promise((ok) => {
          const l = document.querySelector('link[rel~="icon"]');
          if (!l) return ok({ href: null });
          const im = new Image(); im.onload = () => ok({ href: l.href.slice(0, 22), w: im.naturalWidth }); im.onerror = () => ok({ href: l.href.slice(0, 22), w: 0 }); im.src = l.href;
        }));
        assert.deepEqual(r, { href: 'data:image/png;base64,', w: 32 }, url.startsWith('file') ? 'file://' : 'http');
      } finally { await page.close(); }
    }
  });
}
