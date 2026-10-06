#!/usr/bin/env node
// tools/tests/install-info.test.mjs
//
// «Instalar en la computadora y en el teléfono»: la tabla del índice (#instalar),
// el resumen corto junto a «Descargar» en cada landing y la pregunta del FAQ.
// Todo el texto sale de `install` en data/instrumentos.json.
//
//   1. archivo: la tabla tiene una fila por sistema/navegador de `install.rows` con la
//      regla («cada instrumento se instala por separado… un HTML descargado no se
//      instala»); cada landing lleva el resumen y un link a index.html#instalar, que
//      existe; el FAQ tiene «¿Puedo instalarlo en mi computadora?»; el paso 03 de
//      «Cómo se usa» lleva a la tabla;
//   2. los textos de la oferta de instalar coinciden con el código (SPEC 3.1.9): el
//      botón «↓ Instalar» y «Compartir → Agregar a inicio» existen en zd-pwa y en los 5
//      instrumentos;
//   3. navegador: la tabla cabe en 360 px sin scroll horizontal de la página, el link
//      de la landing llega a la tabla y el header sigue en una fila entre 320 y 1440 px.
//
//   node tools/tests/install-info.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const { install } = data;
const SLUGS = data.order;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const text = (html) => unesc(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
const MAX_HEADER = 72;

test('install: cubre los sistemas y navegadores verificados (MDN, caniuse, notas de Firefox)', () => {
  const have = install.rows.map((r) => `${r.os} | ${r.browser}`);
  for (const want of [
    'Windows · macOS · Linux | Chrome, Edge o Brave',
    'macOS | Safari 17 o más nuevo',
    'Windows | Firefox 143 o más nuevo',
    'macOS · Linux | Firefox',
    'Android | Chrome',
    'iPhone · iPad | Safari',
  ]) assert.ok(have.includes(want), `falta la fila «${want}»`);
  const how = (os, br) => install.rows.find((r) => r.os === os && r.browser.startsWith(br)).how;
  assert.match(how('macOS', 'Safari'), /Archivo → Agregar al Dock/);
  assert.match(how('Android', 'Chrome'), /Instalar app/);
  assert.match(how('iPhone · iPad', 'Safari'), /Compartir → Agregar a inicio/);
  assert.match(how('macOS · Linux', 'Firefox'), /HTML descargado/);
  assert.match(install.rule, /por separado/);
  assert.match(install.rule, /HTML descargado no se instala/);
  assert.match(install.rule, /versión web/);
});

test('index.html · sección #instalar: una fila por entrada de install.rows y la regla', () => {
  const html = read('index.html');
  const sec = /<section class="wrap block" id="instalar">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(sec, 'existe <section id="instalar">');
  const body = text(sec[1]);
  assert.ok(body.includes(install.title));
  assert.ok(body.includes(install.rule), 'la regla');
  assert.equal((sec[1].match(/<tr><th scope="row">/g) || []).length, install.rows.length, 'una fila por sistema/navegador');
  assert.equal((sec[1].match(/<th scope="col">/g) || []).length, 2, 'encabezados de columna');
  for (const r of install.rows) {
    assert.ok(body.includes(r.os) && body.includes(r.browser) && body.includes(r.how), `fila ${r.os} · ${r.browser}`);
  }
  for (const n of install.notes) assert.ok(body.includes(n), 'nota');
});

test('index.html · FAQ «¿Puedo instalarlo en mi computadora?» (con el texto de install.faq) y el paso 03 lleva a la tabla', () => {
  const html = read('index.html');
  assert.equal(install.faq.q, '¿Puedo instalarlo en mi computadora?');
  const faq = /<details><summary>¿Puedo instalarlo en mi computadora\?<\/summary><p>([\s\S]*?)<\/p><\/details>/.exec(html);
  assert.ok(faq, 'la pregunta está en el FAQ');
  assert.equal(unesc(faq[1]), install.faq.a);
  assert.match(install.faq.a, /Chrome, Edge o Brave/);
  assert.match(install.faq.a, /Archivo → Agregar al Dock/);
  assert.match(install.faq.a, /Firefox de escritorio/);
  assert.match(html, /03 · INSTALAR<\/span><p>[^<]*<a href="#instalar">/);
});

for (const slug of SLUGS) {
  const I = data.instruments[slug];
  test(`${I.page} · resumen de instalación junto a «Descargar», con link a index.html#instalar`, () => {
    const html = read(I.page);
    const dl = /<section class="wrap block" id="descargar">([\s\S]*?)<\/section>/.exec(html)[1];
    assert.ok(dl.includes('<div class="install-mini">'), 'hay un .install-mini dentro de #descargar');
    const t = text(dl);
    for (const s of install.summary) assert.ok(t.includes(`${s.t}. ${s.d}`), `resumen «${s.t}»`);
    assert.ok(t.includes(install.rule), 'la regla');
    assert.ok(dl.includes('<a href="index.html#instalar" class="install-mini__more">'), 'link a la tabla completa');
    assert.ok(/id="instalar"/.test(read('index.html')), 'index.html#instalar existe');
    assert.ok(!t.includes('Un HTML descargado no se instala como app'), 'el texto viejo ya no está');
  });
}

test('los textos de la oferta de instalar coinciden con el código (zd-pwa y los 5 instrumentos)', () => {
  const sources = { 'tools/blocks/zd-pwa.html': read('tools/blocks/zd-pwa.html') };
  for (const slug of SLUGS) sources[data.instruments[slug].file.replace(/^\.\//, '')] = read(data.instruments[slug].file.replace(/^\.\//, ''));
  for (const [file, src] of Object.entries(sources)) {
    assert.ok(src.includes("'↓ Instalar'"), `${file}: botón «↓ Instalar»`);
    assert.ok(src.includes('Compartir → Agregar a inicio'), `${file}: «Compartir → Agregar a inicio»`);
    assert.ok(src.includes("'Instalar app'"), `${file}: «Instalar app»`);
    assert.ok(src.includes('abrí la versión web'), `${file}: aviso del archivo local «abrí la versión web»`);
  }
  assert.match(install.summary[0].d, /↓ Instalar/);
  assert.match(install.summary[1].d, /Compartir → Agregar a inicio/);
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

for (const vp of [{ width: 360, height: 640 }, { width: 1440, height: 900 }]) {
  test(`index.html · ${vp.width}×${vp.height} · la tabla de instalación se ve completa, sin scroll horizontal de la página`, async () => {
    const page = await browser.newPage({ viewport: vp });
    try {
      await page.goto(`${srv.origin}/index.html#instalar`, { waitUntil: 'load' });
      const rows = page.locator('#instalar table.install tbody tr');
      assert.equal(await rows.count(), install.rows.length);
      for (let i = 0; i < install.rows.length; i++) assert.ok(await rows.nth(i).isVisible(), `fila ${i + 1} visible`);
      const m = await page.evaluate(() => {
        const t = document.querySelector('#instalar .table-wrap');
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, wrap: t.scrollWidth - t.clientWidth };
      });
      assert.equal(m.page, 0, 'la página no scrollea de costado');
      assert.equal(m.wrap, 0, 'la tabla entra en su caja (no hace falta scrollear la tabla)');
    } finally { await page.close(); }
  });
}

test('landing → «Todos los sistemas y navegadores» llega a la tabla del índice (≥44 px de alto)', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  try {
    await page.goto(`${srv.origin}/${data.instruments.cronbeat.page}`, { waitUntil: 'load' });
    const link = page.locator('.install-mini__more');
    assert.ok((await link.boundingBox()).height >= 44);
    await Promise.all([page.waitForURL(`${srv.origin}/index.html#instalar`), link.click()]);
    assert.ok(await page.locator('#instalar table.install').isVisible());
  } finally { await page.close(); }
});

test('el header sticky sigue en una fila entre 320 y 1440 px (índice y landing)', async () => {
  const seen = [];
  for (const w of [320, 360, 390, 768, 859, 860, 900, 960, 1024, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 } });
    try {
      for (const p of ['index.html', data.instruments.acid.page]) {
        await page.goto(`${srv.origin}/${p}`, { waitUntil: 'load' });
        const h = await page.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().height);
        assert.ok(h <= MAX_HEADER, `${p} @${w}: header de ${h} px (dos filas)`);
        seen.push(Math.round(h));
      }
    } finally { await page.close(); }
  }
  console.log(`  header: ${[...new Set(seen)].join(' / ')} px en ${seen.length / 2} anchos × 2 páginas`);
});
