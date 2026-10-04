#!/usr/bin/env node
// tools/tests/monomoon-xypad-a11y.test.mjs
//
// MonoMoon'70 · el pad XY sin atributos ARIA que su rol no admite
// (reports/D2-lighthouse.md: `aria-allowed-attr`, el `div#xypad` con
// role="group" llevaba `aria-valuetext`, Accesibilidad 94; reports/E1.md,
// tarea 10). Sin perder lo que daba:
//
//   - el pad sigue siendo un grupo enfocable con su aria-label y se maneja con
//     flechas / Inicio / Fin;
//   - el valor actual ("Corte … Hz, énfasis N") está en un texto al que apunta
//     aria-describedby (se lee al enfocar) y se mantiene al día;
//   - lo que cambia con el teclado se anuncia en una región aria-live; arrastrar
//     con el dedo no la toca (no inunda al lector de pantalla).
//
//   node tools/tests/monomoon-xypad-a11y.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

/* atributos aria-* que role=group no admite (ARIA 1.2: los de valor son de range/slider/...) */
const NOT_FOR_GROUP = ['aria-valuetext', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax'];

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT);
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

const STATE = (bad) => {
  const p = document.getElementById('xypad');
  const ids = (p.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const live = document.querySelector('#xyPanel [aria-live]');
  return {
    role: p.getAttribute('role'), tabindex: p.getAttribute('tabindex'), label: !!p.getAttribute('aria-label'),
    bad: bad.filter((a) => p.hasAttribute(a)),
    desc: ids.map((id) => (document.getElementById(id) || {}).textContent || '').join(' '),
    live: live ? live.textContent : null, liveOutsidePad: !!live && !p.contains(live),
    cutoff: Math.round(engine.state.filter.cutoff), res: +engine.state.filter.res.toFixed(2),
  };
};

test('MonoMoon · pad XY: sin aria-valuetext, valor por aria-describedby y anuncios solo con el teclado', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  try {
    await page.goto(srv.origin + '/descargables/MonoMoon70.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.click('#powerOvl'); await page.waitForTimeout(500);
    const a = await page.evaluate(STATE, NOT_FOR_GROUP);
    // teclado: flechas mueven corte y énfasis, y se anuncia
    await page.focus('#xypad');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    const b = await page.evaluate(STATE, NOT_FOR_GROUP);
    // arrastre: cambia el valor descrito, no el anuncio
    const box = await page.locator('#xypad').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const c = await page.evaluate(STATE, NOT_FOR_GROUP);
    console.log(`  al cargar: ${JSON.stringify(a)}\n  teclado:   ${JSON.stringify(b)}\n  arrastre:  ${JSON.stringify(c)}`);
    const valText = /^Corte .+ Hz, énfasis \d+$/;
    assert.deepEqual({ role: a.role, tabindex: a.tabindex, label: a.label, bad: a.bad }, { role: 'group', tabindex: '0', label: true, bad: [] },
      'grupo enfocable con aria-label y sin atributos de valor');
    assert.match(a.desc, valText, 'aria-describedby apunta al valor actual');
    assert.ok(b.cutoff > a.cutoff && b.res > a.res, 'las flechas siguen moviendo corte y énfasis');
    assert.deepEqual(b.bad, []);
    assert.match(b.desc, valText);
    assert.notEqual(b.desc, a.desc, 'el valor descrito se actualiza');
    assert.equal(b.live, b.desc, 'lo que cambia con el teclado se anuncia');
    assert.ok(b.liveOutsidePad, 'la región aria-live va fuera del pad');
    assert.notEqual(c.desc, b.desc, 'arrastrar también actualiza el valor descrito');
    assert.equal(c.live, b.live, 'arrastrar no toca el anuncio');
    assert.deepEqual(c.bad, []);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
