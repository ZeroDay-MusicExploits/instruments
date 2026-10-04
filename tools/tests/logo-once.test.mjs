#!/usr/bin/env node
// tools/tests/logo-once.test.mjs
//
// El logo en base64 (JPEG 420×316, 39,9 KB como data: URI) va UNA sola vez en
// cada instrumento (reports/D1-barrido.md, e; reports/E1.md, tarea 6). J4 y
// MonoMoon lo traían dos veces (header y pantalla de encendido): la segunda
// copia ahora es un <img data-zd-logo> sin src que toma el de la primera al
// cargar. Tiene que seguir siendo un HTML autocontenido: en file:// no hay
// pedidos de red y todos los logos se ven.
//
//   1. archivo: el base64 del logo aparece una sola vez en los 5;
//   2. http, 390×844 (shell) y 1280×860: cada logo (img.zd-logo y el de la
//      barra del shell, .zd-tlogo) está decodificado (420 px de ancho
//      natural) y todos usan el mismo src;
//   3. file://: lo mismo, sin ningún pedido que no sea file: o data:.
//
// La comparación visual antes/después (capturas) está en reports/E1.md.
//
//   node tools/tests/logo-once.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const FILES = readdirSync(join(ROOT, 'descargables')).filter((f) => f.endsWith('.html')).sort();
const LOGOS = () => Array.from(document.querySelectorAll('img.zd-logo, img.zd-tlogo')).map((i) => ({
  where: i.closest('#powerOvl, #power') ? 'encendido' : i.closest('#zd-top') ? 'barra del shell' : i.closest('.brand, header') ? 'header' : (i.parentElement && i.parentElement.className) || '?',
  ok: i.complete && i.naturalWidth === 420, src: (i.getAttribute('src') || '').slice(0, 40) + '…' + (i.getAttribute('src') || '').length,
}));

test('el logo en base64 va una sola vez en cada instrumento', () => {
  const counts = {};
  for (const f of FILES) {
    const src = readFileSync(join(ROOT, 'descargables', f), 'utf8');
    counts[f] = (src.match(/data:image\/jpeg;base64,\/9j\/4AAQSkZJRgABAQAAAQABAAD/g) || []).length;
  }
  console.log('  copias del logo: ' + JSON.stringify(counts));
  assert.deepEqual(counts, Object.fromEntries(FILES.map((f) => [f, 1])));
});

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

for (const f of ['J4-Sirens_Station.html', 'MonoMoon70.html']) {
  for (const [label, url, vp] of [
    ['http 390×844', (o) => `${o}/descargables/${f}`, { width: 390, height: 844, mobile: true }],
    ['http 1280×860', (o) => `${o}/descargables/${f}`, { width: 1280, height: 860, mobile: false }],
    ['file:// 390×844', () => pathToFileURL(join(ROOT, 'descargables', f)).href, { width: 390, height: 844, mobile: true }],
  ]) {
    test(`${f} · ${label} · todos los logos se ven y usan la misma imagen`, async () => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile });
      const page = await ctx.newPage();
      const errors = [], net = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e));
      page.on('request', (r) => { if (!/^(data|file|blob):/.test(r.url())) net.push(r.url()); });
      try {
        await page.goto(url(srv.origin), { waitUntil: 'load' });
        await page.waitForTimeout(300);
        const logos = await page.evaluate(LOGOS);
        console.log(`  ${label}: ${logos.map((l) => `${l.where} ${l.ok ? 'ok' : 'SIN IMAGEN'}`).join(' · ')}`);
        assert.ok(logos.length >= (vp.mobile ? 3 : 2), `tiene que haber logos en el header, en la pantalla de encendido${vp.mobile ? ' y en la barra del shell' : ''}`);
        assert.deepEqual(logos.filter((l) => !l.ok).map((l) => l.where), [], 'todos los logos decodificados (420 px de ancho natural)');
        assert.equal(new Set(logos.map((l) => l.src)).size, 1, 'todos con el mismo src');
        if (label.startsWith('file')) assert.deepEqual(net, [], 'en file:// no puede haber pedidos de red');
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    });
  }
}
