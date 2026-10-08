#!/usr/bin/env node
// tools/tests/icons-install.test.mjs
//
// Los íconos nuevos tienen que servirse y los 5 instrumentos tienen que seguir siendo
// instalables. Con Chromium (Playwright) sirviendo el repo bajo /instruments/, como GitHub
// Pages (tools/tests/lib/serve.mjs, opción `prefix`):
//
//   1. por instrumento: `Page.getInstallabilityErrors` da [] y `Page.getAppManifest` no trae
//      errores; los íconos del manifest (any 192 y 512, maskable 512) responden 200 con
//      `content-type: image/png` y son PNG del tamaño que declaran; lo mismo con el
//      <link rel="apple-touch-icon"> (180×180); y la carga no deja ninguna respuesta ≥ 400;
//   2. el sitio: los <link rel="icon"> y <link rel="apple-touch-icon"> de index, las 5
//      landings y privacidad responden 200 image/png con el tamaño de su `sizes`;
//   3. la 404 en una ruta anidada que no existe (GitHub Pages sirve 404.html ahí): los iconos
//      resuelven contra su <base href="/instruments/">, no contra la ruta anidada.
//
// Los archivos en sí (tamaño, opacidad, fondo, zona segura) los comprueba
// `node tools/check-icons.mjs`; esto comprueba que el navegador los recibe y que Chromium
// considera instalable la app.
//
//   node tools/tests/icons-install.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const PREFIX = '/instruments';
const NESTED_404 = `${PREFIX}/no/existe/para/nada`;
const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, { [NESTED_404]: { body: read('404.html') } }, { prefix: PREFIX });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** Pide `url` con el contexto y exige 200, image/png y un PNG de `w`×`h`. -> Buffer */
async function expectPng(ctx, url, w, h, what) {
  const res = await ctx.request.get(url);
  assert.equal(res.status(), 200, `${what}: ${url} respondió ${res.status()}`);
  assert.match(res.headers()['content-type'] || '', /^image\/png\b/, `${what}: content-type de ${url}`);
  const png = PNG.sync.read(await res.body());
  assert.deepEqual([png.width, png.height], [w, h], `${what}: ${url} mide ${png.width}×${png.height} y se esperaba ${w}×${h}`);
  return png;
}

for (const key of data.order) {
  const I = data.instruments[key];
  const file = I.file.replace(/^\.\//, '');
  test(`${I.name} · instalable y sus íconos responden 200 image/png`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const bad = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    try {
      await page.goto(`${srv.base}/${file}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.ZD && ZD.pwa && ZD.pwa.registered, null, { timeout: 15000 });

      const cdp = await ctx.newCDPSession(page);
      const inst = await cdp.send('Page.getInstallabilityErrors');
      assert.deepEqual(inst.installabilityErrors, [], 'Chromium no reporta errores de instalabilidad');
      const app = await cdp.send('Page.getAppManifest');
      assert.deepEqual(app.errors, [], 'el manifest no trae errores');
      const manifest = JSON.parse(app.data);

      const seen = [];
      for (const icon of manifest.icons) {
        const [w, h] = icon.sizes.split('x').map(Number);
        const url = new URL(icon.src, app.url).href;
        await expectPng(ctx, url, w, h, `${I.name} manifest (${icon.purpose})`);
        seen.push(`${icon.purpose || 'any'} ${icon.sizes}`);
      }
      assert.deepEqual(seen.sort(), ['any 192x192', 'any 512x512', 'maskable 512x512'], 'los íconos del manifest');

      const touch = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]').href);
      await expectPng(ctx, touch, 180, 180, `${I.name} apple-touch-icon`);
      assert.deepEqual(bad, [], 'respuestas ≥ 400 durante la carga');
      console.log(`  ${I.name}: instalable (0 errores) · manifest ${app.url.replace(srv.origin, '')} · ${seen.join(', ')} y apple-touch 180×180 · 200 image/png`);
    } finally { await ctx.close(); }
  });
}

/** <link rel="icon"> y <link rel="apple-touch-icon"> de la página abierta, ya resueltos. */
const iconLinks = (page) => page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
  .map((l) => ({ rel: l.getAttribute('rel'), sizes: l.getAttribute('sizes'), href: l.href })));

const SITE_PAGES = ['index.html', ...data.order.map((k) => data.instruments[k].page), 'privacidad.html'];
for (const page of SITE_PAGES) {
  test(`sitio · ${page} · favicon y apple-touch responden 200 image/png`, async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      await p.goto(`${srv.base}/${page}`, { waitUntil: 'domcontentloaded' });
      const links = await iconLinks(p);
      assert.deepEqual(links.map((l) => `${l.rel} ${l.sizes}`), ['icon 32x32', 'icon 64x64', 'apple-touch-icon 180x180']);
      for (const l of links) {
        const [w, h] = l.sizes.split('x').map(Number);
        await expectPng(ctx, l.href, w, h, page);
        assert.ok(l.href.startsWith(`${srv.base}/assets/`), `${l.href} cuelga de assets/`);
      }
    } finally { await ctx.close(); }
  });
}

for (const path of [`${PREFIX}/404.html`, NESTED_404]) {
  test(`sitio · 404 en ${path} · los íconos resuelven contra el <base>`, async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      await p.goto(srv.origin + path, { waitUntil: 'domcontentloaded' });
      assert.equal(await p.evaluate(() => document.baseURI), `${srv.base}/`, 'el <base href="/instruments/"> manda');
      const links = await iconLinks(p);
      assert.equal(links.length, 3);
      for (const l of links) {
        const [w, h] = l.sizes.split('x').map(Number);
        await expectPng(ctx, l.href, w, h, '404');
        assert.ok(l.href.startsWith(`${srv.base}/assets/`), `${l.href} no cuelga de ${srv.base}/assets/ (se resolvió contra la ruta anidada)`);
      }
      console.log(`  404 en ${path}: ${links.map((l) => l.href.replace(srv.origin, '')).join(' · ')}`);
    } finally { await ctx.close(); }
  });
}
