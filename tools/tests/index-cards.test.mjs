#!/usr/bin/env node
// tools/tests/index-cards.test.mjs
//
// Cada card de instrumento del índice tiene «▶ Probar» (abre la HTML de
// descargables/ en la misma pestaña) y el link al manual y la descarga (la
// landing). Son dos <a> hermanos, no uno dentro del otro: la card es un
// <article> y el link a la landing se estira sobre toda la card.
//
//   1. archivo: index.html es lo que genera templates/index.mjs; ninguna página
//      generada tiene <a> anidados; cada card apunta a un archivo de descargables/
//      y a su landing, que existen; el hero conserva «DESCARGAR LOS 5» y «Probar
//      ahora» (#probar);
//   2. navegador, 360×640 y 1440×900: «▶ Probar» y el link al manual son visibles y
//      miden ≥44 px; sin scroll horizontal;
//   3. navegador: clic en «▶ Probar» → la HTML en la misma pestaña; clic en el texto
//      de la card → la landing; con teclado, «▶ Probar» y el manual son dos paradas.
//
//   node tools/tests/index-cards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';
import { maxAnchorDepth } from './lib/anchors.mjs';
import { buildIndexPage } from '../../templates/index.mjs';

const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const SLUGS = data.order;
const VIEWPORTS = [{ width: 360, height: 640 }, { width: 1440, height: 900 }];
const MIN_TARGET = 44;
const PAGES = ['index.html', ...SLUGS.map((s) => data.instruments[s].page), 'privacidad.html', '404.html'];

test('index.html es lo que genera templates/index.mjs', () => {
  assert.equal(readFileSync(join(ROOT, 'index.html'), 'utf8'), buildIndexPage(data), 'correr node tools/build-site.mjs');
});

for (const p of PAGES) {
  test(`${p} · sin <a> anidados`, () => {
    assert.equal(maxAnchorDepth(readFileSync(join(ROOT, p), 'utf8')), 1);
  });
}

test('index.html · cada card: «▶ Probar» → descargables/ y manual → su landing, sin <a> dentro de <a>', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const cards = [...html.matchAll(/<article class="card"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]);
  assert.equal(cards.length, SLUGS.length, 'una card por instrumento (la de C2 es card--soon)');
  cards.forEach((c, i) => {
    const I = data.instruments[SLUGS[i]];
    const hrefs = [...c.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, [I.file, I.page], `${I.name}: «Probar» y manual, en ese orden`);
    assert.ok(existsSync(resolve(ROOT, I.file)) && resolve(ROOT, I.file).startsWith(join(ROOT, 'descargables') + '/'), `${I.file} existe en descargables/`);
    assert.ok(existsSync(join(ROOT, I.page)), `${I.page} existe`);
    assert.ok(!/<a [^>]*target=/.test(c), 'misma pestaña');
  });
});

test('index.html · el hero conserva «DESCARGAR LOS 5 · GRATIS» (#descargar) y «▶ Probar ahora» (#probar)', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const i = html.indexOf('class="hero__ctas"');
  const ctas = html.slice(i, html.indexOf('</div>', i));
  assert.match(ctas, /<a href="#descargar" class="btn btn--accent">DESCARGAR LOS 5 · GRATIS<\/a>/);
  assert.match(ctas, /<a href="#probar" class="btn btn--outline">▶ Probar ahora<\/a>/);
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

for (const vp of VIEWPORTS) {
  test(`index.html · ${vp.width}×${vp.height} · «▶ Probar» y el manual de cada card visibles y ≥${MIN_TARGET} px`, async () => {
    const page = await browser.newPage({ viewport: vp });
    try {
      await page.goto(`${srv.origin}/index.html`, { waitUntil: 'load' });
      const cards = page.locator('article.card:not(.card--soon)');
      assert.equal(await cards.count(), SLUGS.length);
      const seen = [];
      for (let i = 0; i < SLUGS.length; i++) {
        const I = data.instruments[SLUGS[i]];
        const card = cards.nth(i);
        await card.scrollIntoViewIfNeeded();
        const play = card.locator('a.card__play');
        const manual = card.locator('a.card__go');
        for (const [name, loc] of [['Probar', play], ['manual', manual]]) {
          assert.ok(await loc.isVisible(), `${I.name}: ${name} visible`);
          const box = await loc.boundingBox();
          assert.ok(box.height >= MIN_TARGET, `${I.name}: ${name} mide ${box.height} px de alto`);
          assert.ok(box.width >= MIN_TARGET, `${I.name}: ${name} mide ${box.width} px de ancho`);
          const cardBox = await card.boundingBox();
          assert.ok(box.x >= cardBox.x && box.x + box.width <= cardBox.x + cardBox.width + 0.5, `${I.name}: ${name} dentro de la card`);
        }
        // nombres accesibles distintos por instrumento (los 5 textos visibles son iguales)
        assert.match(await play.innerText(), /▶\s*Probar/);
        assert.equal(await play.getAttribute('href'), I.file);
        seen.push(`${I.name} ${Math.round((await play.boundingBox()).height)}/${Math.round((await manual.boundingBox()).height)}`);
      }
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(ov, 0, 'sin scroll horizontal');
      console.log(`  index ${vp.width}×${vp.height}: alto Probar/manual ${seen.join(' · ')}`);
    } finally { await page.close(); }
  });
}

test('index.html · cada card: nombres accesibles distintos, clic en «▶ Probar» → HTML, clic en la card → landing', async () => {
  for (let i = 0; i < SLUGS.length; i++) {
    const I = data.instruments[SLUGS[i]];
    const page = await browser.newPage({ viewport: VIEWPORTS[0] });
    try {
      page.context().on('page', () => assert.fail('no debe abrir pestañas nuevas'));
      await page.goto(`${srv.origin}/index.html`, { waitUntil: 'load' });
      const card = page.locator('article.card:not(.card--soon)').nth(i);
      const play = card.getByRole('link', { name: `Probar ${I.name}` });
      const manual = card.getByRole('link', { name: new RegExp(`^MANUAL Y DESCARGA DE ${I.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') });
      assert.equal(await play.count(), 1, `nombre accesible «Probar ${I.name}»`);
      assert.equal(await manual.count(), 1, `nombre accesible «Manual y descarga de ${I.name}»`);

      // el stretch link: un clic en el texto de la card (no en el botón) lleva a la landing
      await card.scrollIntoViewIfNeeded();
      const desc = await card.locator('.card__desc').boundingBox();
      await Promise.all([page.waitForURL(`${srv.origin}/${I.page}`), page.mouse.click(desc.x + 20, desc.y + 10)]);
      assert.equal(page.url(), `${srv.origin}/${I.page}`);

      // «▶ Probar» no lo tapa el link estirado
      await page.goto(`${srv.origin}/index.html`, { waitUntil: 'load' });
      const play2 = page.locator('article.card:not(.card--soon)').nth(i).locator('a.card__play');
      await play2.scrollIntoViewIfNeeded();
      const pb = await play2.boundingBox();
      await Promise.all([page.waitForURL(`${srv.origin}/${I.file.replace(/^\.\//, '')}`), page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)]);
      assert.equal(new URL(page.url()).pathname, `/${I.file.replace(/^\.\//, '')}`, 'abre la HTML en la misma pestaña');
    } finally { await page.close(); }
  }
});

test('index.html · teclado: «▶ Probar» y el manual de la card son dos paradas de Tab, en ese orden', async () => {
  const page = await browser.newPage({ viewport: VIEWPORTS[1] });
  try {
    await page.goto(`${srv.origin}/index.html`, { waitUntil: 'load' });
    await page.locator('article.card:not(.card--soon) a.card__play').first().focus();
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Probar/);
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /MANUAL Y DESCARGA/);
    await page.keyboard.press('Tab');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Probar/, 'la siguiente card');
  } finally { await page.close(); }
});
