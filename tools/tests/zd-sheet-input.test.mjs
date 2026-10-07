#!/usr/bin/env node
// tools/tests/zd-sheet-input.test.mjs
//
// zd-sheet-input · sliders (<input type=range>) de los sheets en el teléfono,
// en Acid, Nebularp, MonoMoon y J4. Es el manejo que F3 resolvió adentro de
// CronBeat (bindSheetSliders), promovido a bloque: CronBeat lo sigue cubriendo
// con cronbeat-sheet-sliders.test.mjs, que no cambia.
//
//   node tools/tests/zd-sheet-input.test.mjs
//   node tools/tests/zd-sheet-input.test.mjs --file MonoMoon70.html   # uno solo
//
// Los gestos van por CDP (Input.dispatchTouchEvent, ver lib/touch.mjs): pasan
// por touch-action, el scroll nativo y el pointercancel de Chromium como un
// dedo. Qué exige, con el shell activo (360×640) y en cada sheet que tiene
// sliders (primero, del medio y último de cada uno):
//
// 1. Un swipe vertical que arranca en la pista (lejos de la perilla) o en la
//    perilla, con 4 px de deriva horizontal, scrollea el sheet y no cambia
//    ningún valor del documento (inputs, aria-valuenow de los knobs, botones).
//    Un toque en la pista tampoco cambia nada y deja el foco en el slider.
// 2. Un arrastre horizontal ajusta el valor en relativo, desde donde estaba:
//    desde la perilla y desde la pista (no salta al dedo), con
//    Δvalor = Δx / recorrido × rango (recorrido = ancho − perilla, mínimo
//    160 px); desde la pista, menos de 10 px no mueve nada. El knob de la fila
//    sigue al slider (aria-valuenow), el teclado mueve el slider después del
//    toque y el valor arrastrado sobrevive a recargar (autoguardado).
// 3. Los 5 tienen el bloque y CronBeat ya no tiene su copia local
//    (bindSheetSliders); en todos los sheets, cada slider tiene
//    pointer-events:none y su contenedor touch-action:pan-y.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swipe, tap, drag, settleScroll } from './lib/touch.mjs';
import { SB, FOUR, FIVE, harness, open, reload, openTab, frames, closeModal, VALUES, diffValues, center, body, filesFromArgv } from './lib/sheet.mjs';

const FILES = filesFromArgv(FOUR);
const MIN_SPAN = 160;

let h;
test.before(async () => { h = await harness(); });
test.after(async () => { if (h) await h.close(); });

/* Geometría y estado de un slider marcado con data-si. */
const GEO = (id) => {
  const i = document.querySelector(`[data-si="${id}"]`), r = i.getBoundingClientRect();
  const t = parseFloat(getComputedStyle(i).getPropertyValue('--zd-thumb')) || 20;
  const min = +i.min || 0, max = +i.max || 100, v = +i.value, step = i.step === 'any' ? 0 : (+i.step || 1);
  const row = i.parentElement, knob = row && row.querySelector('[role=slider]:not(input)');
  return { left: r.left, w: r.width, cy: r.top + r.height / 2, t, min, max, v, step,
    thumb: r.left + t / 2 + (v - min) / (max - min) * (r.width - t),
    knob: knob ? +knob.getAttribute('aria-valuenow') : null, focus: document.activeElement === i,
    label: i.getAttribute('aria-label') || i.id || i.className };
};
const geo = (page, id) => page.evaluate(GEO, id);
const setVal = (page, id, v) => page.evaluate(({ id, v }) => {
  const i = document.querySelector(`[data-si="${id}"]`); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true }));
}, { id, v });
/* Fracción del rango -> valor. */
const at = (g, f) => g.min + (g.max - g.min) * f;
/* Un punto de la pista lejos de la perilla. */
const trackX = (g) => {
  const a = g.left + g.w * 0.1, b = g.left + g.w * 0.9;
  return Math.abs(a - g.thumb) > Math.abs(b - g.thumb) ? a : b;
};

/* Marca primero, del medio y último slider visible del pane abierto. */
const MARK = () => {
  document.querySelectorAll('[data-si]').forEach((e) => e.removeAttribute('data-si'));
  const list = [...document.querySelectorAll('#zd-sheet .zd-pane.on input[type=range]')].filter((i) => i.getClientRects().length && !i.disabled);
  const pick = [...new Set([list[0], list[Math.floor(list.length / 2)], list[list.length - 1]])].filter(Boolean);
  pick.forEach((i, k) => i.setAttribute('data-si', String(k)));
  return { n: list.length, ids: pick.map((_, k) => String(k)) };
};
/* Para medir la proporción hace falta un slider continuo: el de un knob con
   pasos (Voces, Rango…) vuelve al paso del knob. Marca como "c" el primero
   (del medio para afuera) que conserva un valor intermedio, y deja todo como
   estaba. */
const MARK_CONT = () => {
  document.querySelectorAll('[data-si="c"]').forEach((e) => e.removeAttribute('data-si'));
  const list = [...document.querySelectorAll('#zd-sheet .zd-pane.on input[type=range]')].filter((i) => i.getClientRects().length && !i.disabled);
  const mid = Math.floor(list.length / 2);
  const order = list.map((_, k) => k).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  const put = (i, v) => { i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); };
  for (const k of order) {
    const i = list[k], min = +i.min || 0, max = +i.max || 100, step = +i.step || 1, v0 = i.value;
    const probe = min + Math.round((max - min) * 0.537 / step) * step;
    put(i, probe);
    const kept = Math.abs(+i.value - probe) <= step * 0.5;
    put(i, v0);
    if (kept && (max - min) / step >= 40) { i.setAttribute('data-si', 'c'); return true; }
  }
  return false;
};

async function vSwipe(page, id, where, label) {
  await center(page, `[data-si="${id}"]`);
  await frames(page);
  const g = await geo(page, id), b = await body(page);
  assert.ok(g.cy > b.top + 10 && g.cy < b.bottom - 10, `${label}: el slider tiene que estar a la vista`);
  const down = b.max - b.st, up = b.st;                // lo que queda para scrollear hacia cada lado
  const dir = down >= up ? -1 : 1;                     // dedo hacia arriba = el contenido baja
  const room = Math.max(down, up);
  const D = Math.min(140, (b.bottom - b.top) * 0.42);
  const x = where === 'pista' ? trackX(g) : g.thumb;
  const v0 = await page.evaluate(VALUES);
  await swipe(page, { x, y: g.cy }, { x: x + 4, y: g.cy + dir * D });
  const st1 = await settleScroll(page, SB);
  const v1 = await page.evaluate(VALUES);
  const moved = Math.abs(st1 - b.st);
  await closeModal(page);
  return { moved, room, changed: diffValues(v0, v1) };
}

// ─────────────────────────────────── casos ────────────────────────────────────

for (const file of FILES) {
  test(`zd-sheet-input · ${file} · swipe vertical sobre un slider (pista o perilla) scrollea y no cambia nada; tocar la pista no lo salta`, async () => {
    const { ctx, page, errors, tabs } = await open(h, file);
    try {
      let seen = 0;
      for (const t of tabs) {
        await openTab(page, t.id);
        const m = await page.evaluate(MARK);
        if (!m.n) continue;
        seen++;
        for (const id of m.ids) {
          const label0 = (await geo(page, id)).label;
          const where = `${file} · ${t.label} · «${label0}»`;
          for (const from of ['pista', 'perilla']) {
            const r = await vSwipe(page, id, from, where);
            console.log(`  ${t.label} · «${label0}» (${m.n} sliders) · swipe desde la ${from}: scroll ${Math.round(r.moved)} de ${Math.round(r.room)} px · ${r.changed.length ? 'CAMBIA ' + r.changed.join(', ') : 'nada cambia'}`);
            assert.ok(r.room >= 8, `${where}: el sheet no tiene para scrollear (${r.room} px)`);
            assert.ok(r.moved >= Math.min(20, r.room - 4), `${where}: el swipe vertical desde la ${from} tiene que scrollear el sheet (${Math.round(r.moved)} de ${Math.round(r.room)} px)`);
            assert.deepEqual(r.changed, [], `${where}: el swipe vertical desde la ${from} cambió valores`);
          }
          // toque en la pista: lejos de la perilla (el valor al 25 % y el dedo al 90 %)
          let g = await geo(page, id);
          await setVal(page, id, at(g, 0.25));
          await center(page, `[data-si="${id}"]`); await frames(page);
          g = await geo(page, id);
          const v0 = await page.evaluate(VALUES);
          await tap(page, { x: g.left + g.w * 0.9, y: g.cy });
          await page.waitForTimeout(400);                  // fuera de la ventana del doble toque
          const a = await geo(page, id), v1 = await page.evaluate(VALUES);
          await closeModal(page);
          assert.equal(a.v, g.v, `${where}: tocar la pista saltó el valor (${g.v} → ${a.v})`);
          assert.deepEqual(diffValues(v0, v1), [], `${where}: tocar la pista cambió valores`);
          assert.ok(a.focus, `${where}: el toque tiene que dejar el foco en el slider (teclado)`);
        }
      }
      assert.ok(seen > 0, `${file}: ninguna pestaña con sliders`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`zd-sheet-input · ${file} · arrastre horizontal relativo desde la perilla y desde la pista; el knob lo sigue, el teclado anda y se autoguarda`, async () => {
    const { ctx, page, errors, tabs } = await open(h, file);
    let saved = null;
    try {
      for (const t of tabs) {
        await openTab(page, t.id);
        if (!(await page.evaluate(MARK)).n) continue;
        assert.ok(await page.evaluate(MARK_CONT), `${file} · ${t.label}: ningún slider continuo para medir la proporción`);
        const id = 'c';
        let g = await geo(page, id);
        const where = `${file} · ${t.label} · «${g.label}»`;
        const tol = Math.max(g.step, (g.max - g.min) * 0.01) * 1.05;
        const run = async (from, start, dx, what) => {
          await setVal(page, id, at(g, start));
          await center(page, `[data-si="${id}"]`); await frames(page);
          const s = await geo(page, id);
          const x0 = from === 'perilla' ? s.thumb : s.left + s.w * from;
          await drag(page, { x: x0, y: s.cy }, { x: x0 + dx, y: s.cy + 2 });
          await page.waitForTimeout(60);
          const a = await geo(page, id);
          const span = Math.max(MIN_SPAN, s.w - s.t);
          const want = Math.min(s.max, Math.max(s.min, s.v + dx / span * (s.max - s.min)));
          console.log(`  ${t.label} · «${s.label}» ${what}: ${s.v} ${dx > 0 ? '+' : ''}${dx}px → ${a.v} (esperado ${+want.toFixed(4)}, recorrido ${Math.round(span)} px)` +
            (a.knob != null ? ` · knob ${a.knob}` : ''));
          assert.ok(Math.abs(a.v - want) <= tol, `${where} ${what}: ${s.v} ${dx}px tenía que dar ~${want} y dio ${a.v}`);
          if (a.knob != null) assert.ok(Math.abs(a.knob - a.v) <= tol, `${where} ${what}: el knob de la fila (${a.knob}) tiene que seguir al slider (${a.v})`);
          return a;
        };
        await run('perilla', 0.3, 40, 'desde la perilla');
        await run('perilla', 0.7, -30, 'desde la perilla');
        // desde la pista, lejos de la perilla: la perilla al 75 %, el dedo al 8 %
        await run(0.08, 0.75, 25, 'desde la pista');
        // menos de 10 px desde la pista: nada
        await setVal(page, id, at(g, 0.75)); await frames(page);
        g = await geo(page, id);
        await drag(page, { x: g.left + g.w * 0.08, y: g.cy }, { x: g.left + g.w * 0.08 + 8, y: g.cy + 1 });
        assert.equal((await geo(page, id)).v, g.v, `${where}: desde la pista, 8 px de costado no alcanzan para mover el slider`);

        // teclado: el toque enfoca el slider y las flechas lo mueven (nativo)
        await setVal(page, id, at(g, 0.5)); await frames(page);
        g = await geo(page, id);
        await tap(page, { x: trackX(g), y: g.cy });
        await page.waitForTimeout(80);
        const k0 = await geo(page, id);
        await page.keyboard.press('ArrowRight');
        const k1 = await geo(page, id);
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
        const k2 = await geo(page, id);
        console.log(`  ${t.label} · «${g.label}» · teclado tras el toque: ${k0.v} → ${k1.v} → ${k2.v}`);
        assert.ok(k0.focus && k0.v === g.v, `${where}: el toque enfoca el slider sin cambiarlo`);
        assert.ok(k1.v > k0.v && k2.v < k1.v, `${where}: → y ← tienen que mover el slider enfocado (${k0.v} → ${k1.v} → ${k2.v})`);
        await page.evaluate(() => document.activeElement && document.activeElement.blur());

        if (!saved) {
          // autoguardado: arrastrar y recargar
          await setVal(page, id, at(g, 0.2)); await frames(page);
          await page.waitForTimeout(1900);
          const s = await run('perilla', 0.2, 50, 'para el autoguardado');
          saved = { tab: t.id, id, v: s.v, label: s.label, where };
        }
      }
      assert.ok(saved, `${file}: ninguna pestaña con sliders`);
      assert.deepEqual(errors, []);
      await page.waitForTimeout(1900);                   // debounce del autoguardado: 1,5 s
      await reload(page);
      await page.waitForTimeout(700);
      await openTab(page, saved.tab);
      const back = await page.evaluate((label) => {
        const i = [...document.querySelectorAll('#zd-sheet .zd-pane.on input[type=range]')].find((x) => (x.getAttribute('aria-label') || x.id || x.className) === label);
        return i ? +i.value : null;
      }, saved.label);
      console.log(`  «${saved.label}» arrastrado a ${saved.v} · al recargar: ${back}`);
      assert.ok(back != null && Math.abs(back - saved.v) <= Math.abs(saved.v) * 0.002 + 1e-3, `${saved.where}: el autoguardado tiene que conservar el valor arrastrado (${saved.v} → ${back})`);
    } finally { await ctx.close(); }
  });
}

test('zd-sheet-input · los 5 tienen el bloque, CronBeat sin copia local; en los sheets el slider no recibe punteros y su contenedor es pan-y', async () => {
  for (const file of FIVE) {
    const { ctx, page, errors, tabs } = await open(h, file);
    try {
      const has = await page.evaluate(() => ({ block: !!(window.ZD && ZD.sheetInput), local: typeof window.bindSheetSliders }));
      assert.ok(has.block, `${file}: falta el bloque zd-sheet-input (ZD.sheetInput)`);
      assert.equal(has.local, 'undefined', `${file}: sigue la copia local bindSheetSliders()`);
      let n = 0;
      for (const t of tabs) {
        await openTab(page, t.id, 0);
        const bad = await page.evaluate(() => [...document.querySelectorAll('#zd-sheet .zd-pane.on input[type=range]')].map((i) => {
          const pe = getComputedStyle(i).pointerEvents, ta = getComputedStyle(i.parentElement).touchAction;
          return { n: i.getAttribute('aria-label') || i.id, ok: pe === 'none' && /pan-y/.test(ta) && !/pan-x/.test(ta), pe, ta };
        }));
        n += bad.length;
        assert.deepEqual(bad.filter((b) => !b.ok).map((b) => `${b.n}: pointer-events ${b.pe}, contenedor ${b.ta}`), [], `${file} · ${t.label}`);
      }
      console.log(`  ${file}: bloque presente · ${n} sliders en los sheets, todos sin punteros y con el contenedor pan-y`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});
