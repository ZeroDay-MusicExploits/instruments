#!/usr/bin/env node
// tools/tests/favicon.test.mjs
//
// Cada instrumento declara su favicon inline (reports/D2-lighthouse.md: sin
// <link rel="icon"> el navegador pide /favicon.ico y da 404, Best Practices
// 96; reports/E1.md, tarea 8): un PNG de 32×32 con paleta como data: URI, de
// unos 0,4 KB. Sin pedidos de red y sin archivos nuevos: anda igual en file://.
//
// Cómo se genera (lo entregó el diseño en src/brand/zeroday-brand-assets/favicons/
// y tools/make-favicons.mjs lo reproduce desde icons/<slug>-512.png):
//   1. se aísla la ventana oscura del ícono de 512 (el nombre y «ZERO DAY» no se
//      leen a 32 px y se descartan);
//   2. se reduce a unos 30 px de ancho y se centra sobre un cuadrado de 32 px del
//      color de acento;
//   3. se cuantiza a 24 colores, con el acento como entrada exacta de la paleta.
// Lo que este test exige es solo lo que importa, no el método:
//
//   1. archivo: un solo <link rel="icon"> con data:image/png, que decodifica a
//      32×32, pesa ≤ 2 KB y cuyo píxel (0,0) es el color de acento del ícono de 192;
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
  test(`${f} · favicon inline de 32×32, ≤ 2 KB, con el color de acento en (0,0)`, () => {
    const src = readFileSync(join(ROOT, 'descargables', f), 'utf8');
    const head = src.slice(0, src.indexOf('</head>'));
    const links = head.match(/<link[^>]+rel="(?:shortcut )?icon"[^>]*>/g) || [];
    assert.equal(links.length, 1, 'tiene que haber exactamente un <link rel="icon">');
    const m = /href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(links[0]);
    assert.ok(m, 'el favicon tiene que ser un PNG inline (data:image/png;base64)');
    const bytes = Buffer.from(m[1], 'base64');
    const png = PNG.sync.read(bytes);
    const slug = /href="\.\.\/icons\/([a-z0-9-]+)-apple-touch-180\.png"/.exec(src)[1];
    const icon = PNG.sync.read(readFileSync(join(ROOT, 'icons', `${slug}-192.png`)));
    const bg = (p) => [p.data[0], p.data[1], p.data[2]].join(',');
    console.log(`  ${f}: ${png.width}×${png.height} · ${bytes.length} B (${m[1].length} en base64) · píxel (0,0) ${bg(png)} (ícono ${slug}: ${bg(icon)})`);
    assert.deepEqual([png.width, png.height], [32, 32]);
    assert.ok(bytes.length <= 2048, `el favicon pesa ${bytes.length} B y el tope es 2048`);
    assert.equal(bg(png), bg(icon), 'el píxel (0,0) es el color de acento del ícono de la PWA');
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
