#!/usr/bin/env node
// tools/tests/zd-ui-prompt.test.mjs
//
// Pedido de J4 (reports/j4-block-request.md punto 2): `ZD.modal.prompt` enfoca
// el <input> pero no selecciona el valor inicial. En una perilla con valor
// 1400, tipear 2500 deja "14002500" y el valor se va al máximo. J4 lo esquiva
// seleccionando el input con un doble requestAnimationFrame; Acid, MonoMoon y
// Nebularp usan el mismo prompt para sus knobs y no lo esquivan.
//
// 1. La copia canónica de tools/blocks/zd-ui.html, en una página mínima.
// 2. Los 5 instrumentos publicados (1280×860, con teclado): además de la
//    selección, que ningún atajo global del instrumento se robe los dígitos ni
//    el Enter mientras el modal está abierto.
//
//   node tools/tests/zd-ui-prompt.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT, extractBlock } from './lib/load-block.mjs';
import { blockPage, blockVersion } from './lib/block-page.mjs';

const V = blockVersion('zd-ui');
const PAGE = '/__zd-ui-test.html';
const FILES = readdirSync(join(ROOT, 'descargables')).filter((f) => f.endsWith('.html')).sort();

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, {
    [PAGE]: { body: blockPage({ blocks: ['zd-ui'], body: '<button id="b">x</button>', title: 'zd-ui test' }) },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/* Un diálogo cerrado sigue en el DOM 180 ms (transición) y, si el foco volvía a
   <body>, su input sigue enfocado hasta que se va: no abrir el siguiente antes. */
const gone = (page) => page.waitForFunction(() => !document.querySelector('.zd-scrim'), null, { timeout: 3000 });

/** Abre el prompt con 1400, tipea 2500 + Enter. -> { sel, value } */
async function typeOver(page) {
  await gone(page);
  const result = page.evaluate(() => ZD.modal.prompt('Entre 20 y 12000 Hz. Valor actual: 1400.', { value: '1400', title: 'CUTOFF' }));
  await page.waitForFunction(() => document.activeElement && document.activeElement.matches('.zd-dlg input'), null, { timeout: 3000 });
  const sel = await page.evaluate(() => { const i = document.activeElement; return [i.selectionStart, i.selectionEnd, i.value]; });
  await page.keyboard.type('2500');
  await page.keyboard.press('Enter');
  return { sel, value: await result };
}

test(`zd-ui v${V} · ZD.modal.prompt selecciona el valor inicial: tipear 2500 sobre 1400 da 2500`, async () => {
  const page = await browser.newPage();
  try {
    await page.goto(srv.origin + PAGE, { waitUntil: 'load' });
    const { sel, value } = await typeOver(page);
    console.log(`  al enfocar: selección [${sel[0]}, ${sel[1]}] de "${sel[2]}" · tipear 2500 + Enter → "${value}"`);
    assert.deepEqual({ sel, value }, { sel: [0, 4, '1400'], value: '2500' }, 'el valor inicial tiene que quedar seleccionado y lo tipeado lo reemplaza');
    // Escape sigue cancelando y un valor vacío sigue andando
    await gone(page);
    const esc = page.evaluate(() => ZD.modal.prompt('x', { value: '7' }));
    await page.waitForFunction(() => document.activeElement && document.activeElement.matches('.zd-dlg input'));
    await page.keyboard.press('Escape');
    assert.equal(await esc, null, 'Escape cancela');
    await gone(page);
    const empty = page.evaluate(() => ZD.modal.prompt('x', {}));
    await page.waitForFunction(() => document.activeElement && document.activeElement.matches('.zd-dlg input'));
    await page.keyboard.type('ab'); await page.keyboard.press('Enter');
    assert.equal(await empty, 'ab');
  } finally { await page.close(); }
});

for (const f of FILES) {
  const v = extractBlock(readFileSync(join(ROOT, 'descargables', f), 'utf8'), 'zd-ui').version;
  test(`${f} (zd-ui v${v}) · el prompt reemplaza el valor y el instrumento no se roba las teclas`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e));
    try {
      await page.goto(srv.origin + '/descargables/' + f, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const { sel, value } = await typeOver(page);
      console.log(`  ${f}: selección [${sel[0]}, ${sel[1]}] · tipear 2500 + Enter → "${value}"`);
      assert.deepEqual({ sel, value }, { sel: [0, 4, '1400'], value: '2500' });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => !!document.querySelector('.zd-scrim.in')), false, 'Enter cierra el modal');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}
