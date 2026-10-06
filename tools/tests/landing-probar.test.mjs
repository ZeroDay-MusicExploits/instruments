#!/usr/bin/env node
// tools/tests/landing-probar.test.mjs
//
// «▶ Probar ahora» de cada landing abre el instrumento (./descargables/<Archivo>.html,
// misma pestaña) y no solo baja a #probar. Los dos botones del hero —«DESCARGAR
// GRATIS» y «▶ Probar ahora»— se ven sin hacer scroll y miden ≥44 px a 360×640 y a
// 1440×900; el header sticky queda en una fila y «Probalo acá» sigue igual.
//
//   1. archivo: la landing generada es la que produce templates/landing.mjs, el
//      href de «Probar ahora» es el `file` de data/instrumentos.json y apunta a un
//      archivo que existe en descargables/, y no hay <a> anidados (el parser del
//      navegador los desarma en silencio, por eso se cuentan sobre el texto);
//   2. navegador, 360×640 y 1440×900: ambos botones visibles, dentro de la
//      pantalla sin scroll, ≥44 px de alto; sin scroll horizontal; header en una
//      fila; el href se resuelve a un 200 de descargables/;
//   3. navegador: el click abre el instrumento en la misma pestaña;
//   4. navegador: «Probalo acá» intacto (iframe diferido en ≥1024 px, «Abrir en
//      pantalla completa» en móvil).
//
//   node tools/tests/landing-probar.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';
import { buildLandingPage } from '../../templates/landing.mjs';

const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const SLUGS = data.order;
const VIEWPORTS = [{ width: 360, height: 640 }, { width: 1440, height: 900 }];
const MIN_TARGET = 44;
const MAX_HEADER = 72; // una fila: 48 px de barra + padding; dos filas pasan de 100

/** Profundidad máxima de <a> abiertos a la vez (1 = sin anidar). */
export function maxAnchorDepth(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  let depth = 0, max = 0;
  for (const m of body.matchAll(/<a(?=[\s>])[^>]*>|<\/a\s*>/gi)) {
    depth += m[0][1] === '/' ? -1 : 1;
    max = Math.max(max, depth);
  }
  return max;
}

test('maxAnchorDepth detecta <a> anidados', () => {
  assert.equal(maxAnchorDepth('<a href="x">uno</a><a href="y">dos</a>'), 1);
  assert.equal(maxAnchorDepth('<a href="x"><span>uno <a href="y">dos</a></span></a>'), 2);
  assert.equal(maxAnchorDepth('<script>"<a>"</script><!-- <a> --><a href="x">uno</a>'), 1);
});

for (const slug of SLUGS) {
  const I = data.instruments[slug];
  const file = I.file.replace(/^\.\//, '');

  test(`${I.page} · generada desde la plantilla, «Probar ahora» → ${file}, sin <a> anidados`, () => {
    const html = readFileSync(join(ROOT, I.page), 'utf8');
    assert.equal(html, buildLandingPage(data, slug), 'la landing no coincide con templates/landing.mjs: correr node tools/build-site.mjs');
    const hero = html.slice(html.indexOf('class="hero__ctas'), html.indexOf('</div>', html.indexOf('class="hero__ctas')));
    const m = /<a href="([^"]+)"[^>]*>▶ Probar ahora<\/a>/.exec(hero);
    assert.ok(m, 'el hero tiene el link «▶ Probar ahora»');
    assert.equal(m[1], I.file, 'el href es el `file` de data/instrumentos.json');
    assert.ok(!/target=/.test(m[0]), 'misma pestaña: sin target');
    assert.ok(existsSync(resolve(ROOT, m[1])), `existe ${m[1]}`);
    assert.ok(resolve(ROOT, m[1]).startsWith(join(ROOT, 'descargables') + '/'), 'está en descargables/');
    assert.equal(maxAnchorDepth(html), 1, '<a> anidados');
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

for (const slug of SLUGS) {
  const I = data.instruments[slug];
  const file = I.file.replace(/^\.\//, '');

  for (const vp of VIEWPORTS) {
    test(`${I.page} · ${vp.width}×${vp.height} · los dos botones visibles sin scroll y ≥${MIN_TARGET} px`, async () => {
      const page = await browser.newPage({ viewport: vp });
      try {
        await page.goto(`${srv.origin}/${I.page}`, { waitUntil: 'load' });
        const ctas = page.locator('.hero__ctas a');
        assert.equal(await ctas.count(), 2, 'dos botones en el hero');
        const buttons = [
          { name: 'DESCARGAR GRATIS', loc: ctas.filter({ hasText: 'DESCARGAR GRATIS' }) },
          { name: '▶ Probar ahora', loc: ctas.filter({ hasText: 'Probar ahora' }) },
        ];
        const seen = [];
        for (const { name, loc } of buttons) {
          assert.equal(await loc.count(), 1, name);
          assert.ok(await loc.isVisible(), `${name} visible`);
          const box = await loc.boundingBox();
          seen.push(`${name} ${Math.round(box.y)}–${Math.round(box.y + box.height)} (${Math.round(box.height)} px)`);
          assert.ok(box.height >= MIN_TARGET, `${name}: ${box.height} px de alto`);
          assert.ok(box.width >= MIN_TARGET, `${name}: ${box.width} px de ancho`);
          assert.ok(box.y >= 0 && box.y + box.height <= vp.height, `${name} entra en ${vp.height} px sin scroll (${box.y}–${box.y + box.height})`);
          assert.ok(box.x >= 0 && box.x + box.width <= vp.width, `${name} entra en ${vp.width} px de ancho`);
        }
        const m = await page.evaluate(() => ({
          header: document.querySelector('.site-header').getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollY: window.scrollY,
        }));
        assert.equal(m.scrollY, 0);
        assert.ok(m.header <= MAX_HEADER, `header sticky en una fila: ${m.header} px`);
        assert.equal(m.overflow, 0, 'sin scroll horizontal');
        console.log(`  ${I.page} ${vp.width}×${vp.height}: ${seen.join(' · ')} · header ${Math.round(m.header)} px`);
      } finally { await page.close(); }
    });
  }

  test(`${I.page} · el href de «Probar ahora» responde 200 en descargables/ y el click abre en la misma pestaña`, async () => {
    const page = await browser.newPage({ viewport: VIEWPORTS[0] });
    try {
      await page.goto(`${srv.origin}/${I.page}`, { waitUntil: 'load' });
      const link = page.locator('.hero__ctas a', { hasText: 'Probar ahora' });
      const url = new URL(await link.getAttribute('href'), page.url());
      assert.equal(url.pathname, `/${file}`);
      const res = await page.request.get(url.href);
      assert.equal(res.status(), 200);
      assert.match(res.headers()['content-type'], /text\/html/);
      let popups = 0;
      page.context().on('page', () => popups++);
      await Promise.all([page.waitForURL(url.href), link.click()]);
      assert.equal(page.url(), url.href, 'navegó en la misma pestaña');
      assert.equal(popups, 0, 'sin pestañas nuevas');
    } finally { await page.close(); }
  });

  test(`${I.page} · «Probalo acá» intacto: iframe diferido en ≥1024 px y pantalla completa en móvil`, async () => {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: vp });
      try {
        await page.goto(`${srv.origin}/${I.page}`, { waitUntil: 'load' });
        const full = page.locator('#probar a', { hasText: /pantalla completa/i }).first();
        assert.equal(await full.getAttribute('href'), I.file);
        assert.equal(await full.getAttribute('target'), '_blank');
        assert.equal(await page.locator('#probar iframe').count(), 0, 'sin iframe hasta que se pide');
        if (vp.width >= 1024) {
          assert.ok(await page.locator('#probar [data-preview-load]').isVisible(), 'botón «Cargar» visible');
          assert.ok(!(await page.locator('#probar .preview__mobile').isVisible()), 'sin el bloque móvil');
          await page.locator('#probar [data-preview-load]').click();
          assert.equal(await page.locator('#probar iframe').count(), 1, 'el click carga el iframe');
          assert.equal(await page.locator('#probar iframe').getAttribute('loading'), 'lazy');
        } else {
          assert.ok(await page.locator('#probar .preview__mobile .btn').isVisible(), '«Abrir en pantalla completa» visible');
          assert.ok(!(await page.locator('#probar [data-preview-frame]').isVisible()), 'sin iframe en móvil');
        }
      } finally { await page.close(); }
    }
  });
}
