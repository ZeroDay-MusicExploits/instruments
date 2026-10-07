#!/usr/bin/env node
// tools/tests/sheet-knobs.test.mjs
//
// Knobs dentro de los sheets en el teléfono, en Acid, Nebularp, MonoMoon y J4
// (decisión A de reports/F3-barrido-scroll.md): el swipe vertical que arranca
// sobre un knob scrollea el sheet; el knob se ajusta con un arrastre
// horizontal dominante, relativo y sin demora. Fuera de los sheets (macros de
// MonoMoon, BPM de Nebularp) y en el escritorio sigue el arrastre vertical.
//
//   node tools/tests/sheet-knobs.test.mjs
//   node tools/tests/sheet-knobs.test.mjs --file J4-Sirens_Station.html   # uno solo
//
// Gestos de verdad por CDP (lib/touch.mjs). Qué exige, con el shell activo
// (360×640), en cada sheet que tiene knobs (primero, del medio y último):
//
// 1. Un swipe vertical que arranca en el centro del knob (4 px de deriva)
//    scrollea el sheet y no cambia ningún valor del documento. Un toque no
//    cambia nada.
// 2. En diagonal, o scrollea o ajusta (nunca las dos cosas); si arranca de
//    costado y sigue en vertical, el navegador se queda con el scroll y el
//    valor vuelve al de antes.
// 3. Un arrastre horizontal cambia el valor en relativo, desde donde estaba:
//    Δfracción = Δx / sensibilidad del instrumento (la misma que tenía el
//    arrastre vertical: Acid y Nebularp 180 px, MonoMoon 240, J4 200). El
//    slider de la fila lo sigue y el valor se autoguarda.
// 4. Lo demás del knob no cambia: doble toque = valor por defecto (el mismo
//    desde el mínimo y desde el máximo), long-press = entrada numérica (sin
//    cambiar el valor), role="slider" con aria-valuemin/max/now/valuetext y
//    aria-label, teclado (→ ← Inicio Fin; Enter = entrada numérica).
// 5. Fuera de los sheets: el knob de la zona de tocar (macros de MonoMoon, BPM
//    de Nebularp) sigue con arrastre vertical en el teléfono, y en el
//    escritorio (1440×900, mouse) los 4 siguen con arrastre vertical y no se
//    mueven de costado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swipe, tap, drag, touchPath, doubleTap, line, settleScroll } from './lib/touch.mjs';
import { SB, FOUR, harness, open, reload, openTab, frames, closeModal, VALUES, diffValues, center, body, filesFromArgv } from './lib/sheet.mjs';

const FILES = filesFromArgv(FOUR);
/* px de arrastre para recorrer todo el knob (la del arrastre vertical de cada uno) */
const SENS = { 'Acid_Bass-303.html': 180, 'Nebularp_2035.html': 180, 'MonoMoon70.html': 240, 'J4-Sirens_Station.html': 200 };
/* knobs fuera de los sheets, en la zona de tocar del teléfono */
const STAGE = { 'Nebularp_2035.html': '[data-knob="bpm"] .dial', 'MonoMoon70.html': '#macroPanel [role=slider]' };

let h;
test.before(async () => { h = await harness(); });
test.after(async () => { if (h) await h.close(); });

/* Estado de un knob marcado con data-sk: fracción 0..1 a partir de aria-*. */
const KGEO = (id) => {
  const k = document.querySelector(`[data-sk="${id}"]`), r = k.getBoundingClientRect();
  const min = +k.getAttribute('aria-valuemin'), max = +k.getAttribute('aria-valuemax'), now = +k.getAttribute('aria-valuenow');
  const row = [...document.querySelectorAll('input[type=range]')].find((i) => i.parentElement && i.parentElement.contains(k));
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, now, min, max, f: (now - min) / (max - min),
    slider: row ? (+row.value - (+row.min || 0)) / ((+row.max || 1) - (+row.min || 0)) : null,
    label: k.getAttribute('aria-label'), text: k.getAttribute('aria-valuetext'), role: k.getAttribute('role'), focus: document.activeElement === k };
};
const kgeo = (page, id) => page.evaluate(KGEO, id);
const modalOpen = (page) => page.evaluate(() => !!document.querySelector('.zd-scrim .zd-dlg input'));
const key = async (page, id, k) => { await page.evaluate((id) => document.querySelector(`[data-sk="${id}"]`).focus({ preventScroll: true }), id); await page.keyboard.press(k); };

/* Marca primero, del medio y último knob visible del pane abierto (y "c": uno
   continuo, del medio para afuera, para medir la proporción: los knobs con
   pasos, como Voces o Rango, redondean). */
const MARK = () => {
  document.querySelectorAll('[data-sk]').forEach((e) => e.removeAttribute('data-sk'));
  const list = [...document.querySelectorAll('#zd-sheet .zd-pane.on [role=slider]:not(input)')].filter((k) => k.getClientRects().length);
  const pick = [...new Set([list[0], list[Math.floor(list.length / 2)], list[list.length - 1]])].filter(Boolean);
  pick.forEach((k, i) => k.setAttribute('data-sk', String(i)));
  const mid = Math.floor(list.length / 2);
  const order = list.map((_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  for (const i of order) {
    const k = list[i], sl = [...document.querySelectorAll('#zd-sheet .zd-pane.on input[type=range]')].find((s) => s.parentElement.contains(k));
    if (!sl) continue;
    const put = (v) => { sl.value = String(v); sl.dispatchEvent(new Event('input', { bubbles: true })); };
    const v0 = sl.value, a0 = k.getAttribute('aria-valuenow');
    const min = +k.getAttribute('aria-valuemin'), max = +k.getAttribute('aria-valuemax');
    put((+sl.min || 0) + ((+sl.max || 1) - (+sl.min || 0)) * 0.537);
    const f = (+k.getAttribute('aria-valuenow') - min) / (max - min);
    put(v0);
    if (Math.abs(f - 0.537) < 0.004 && k.getAttribute('aria-valuenow') === a0) { k.setAttribute('data-sk', k.hasAttribute('data-sk') ? k.getAttribute('data-sk') : 'c'); return { n: list.length, ids: pick.map((_, i) => String(i)), cont: k.getAttribute('data-sk') }; }
  }
  return { n: list.length, ids: pick.map((_, i) => String(i)), cont: null };
};
/* Lleva el knob a una fracción con el teclado del propio knob (Inicio y flechas no
   sirven para una fracción exacta): por el slider de la fila. */
const setFrac = (page, id, f) => page.evaluate(({ id, f }) => {
  const k = document.querySelector(`[data-sk="${id}"]`);
  const sl = [...document.querySelectorAll('input[type=range]')].find((s) => s.parentElement && s.parentElement.contains(k));
  sl.value = String((+sl.min || 0) + ((+sl.max || 1) - (+sl.min || 0)) * f);
  sl.dispatchEvent(new Event('input', { bubbles: true }));
}, { id, f });

// ─────────────────────────────────── casos ────────────────────────────────────

for (const file of FILES) {
  test(`${file} · knobs de los sheets: el swipe vertical que arranca sobre un knob scrollea y no cambia nada; un toque tampoco`, async () => {
    const { ctx, page, errors, tabs } = await open(h, file);
    try {
      let seen = 0;
      for (const t of tabs) {
        await openTab(page, t.id);
        const m = await page.evaluate(MARK);
        if (!m.n) continue;
        seen++;
        for (const id of m.ids) {
          await center(page, `[data-sk="${id}"]`); await frames(page);
          const g = await kgeo(page, id), b = await body(page);
          const where = `${file} · ${t.label} · «${g.label}»`;
          assert.ok(g.cy > b.top + 10 && g.cy < b.bottom - 10, `${where}: el knob tiene que estar a la vista`);
          const down = b.max - b.st, up = b.st, dir = down >= up ? -1 : 1, room = Math.max(down, up);
          const D = Math.min(140, (b.bottom - b.top) * 0.42);
          const v0 = await page.evaluate(VALUES);
          await swipe(page, { x: g.cx, y: g.cy }, { x: g.cx + 4, y: g.cy + dir * D });
          const st1 = await settleScroll(page, SB);
          const v1 = await page.evaluate(VALUES);
          const modal = await modalOpen(page); await closeModal(page);
          const moved = Math.abs(st1 - b.st), changed = diffValues(v0, v1);
          console.log(`  ${t.label} · «${g.label}» (${m.n} knobs, ${Math.round(g.w)}×${Math.round(g.h)}) · swipe vertical: scroll ${Math.round(moved)} de ${Math.round(room)} px · ${changed.length ? 'CAMBIA ' + changed.join(', ') : 'nada cambia'}`);
          assert.ok(room >= 8, `${where}: el sheet no tiene para scrollear (${room} px)`);
          assert.ok(moved >= Math.min(20, room - 4), `${where}: el swipe vertical sobre el knob tiene que scrollear el sheet (${Math.round(moved)} de ${Math.round(room)} px)`);
          assert.deepEqual(changed, [], `${where}: el swipe vertical sobre el knob cambió valores`);
          assert.equal(modal, false, `${where}: el swipe abrió la entrada numérica`);
          // un toque: nada
          await center(page, `[data-sk="${id}"]`); await frames(page);
          const g2 = await kgeo(page, id);
          const t0 = await page.evaluate(VALUES);
          await tap(page, { x: g2.cx, y: g2.cy });
          await page.waitForTimeout(400);                  // fuera de la ventana del doble toque
          const t1 = await page.evaluate(VALUES);
          assert.equal(await modalOpen(page), false, `${where}: un toque abrió la entrada numérica`);
          assert.deepEqual(diffValues(t0, t1), [], `${where}: un toque sobre el knob cambió valores`);
        }
      }
      assert.ok(seen > 0, `${file}: ninguna pestaña con knobs`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`${file} · knobs de los sheets: en diagonal o scrollea o ajusta, nunca las dos cosas; si el navegador se queda con el scroll, el valor vuelve`, async () => {
    const { ctx, page, errors, tabs } = await open(h, file);
    try {
      let seen = 0;
      for (const t of tabs) {
        await openTab(page, t.id);
        const m = await page.evaluate(MARK);
        if (!m.n) continue;
        seen++;
        const id = m.cont || m.ids[1] || m.ids[0];
        for (const [what, path] of [
          ['diagonal, más vertical', (g, s) => [g, ...line(g, { x: g.x + 30, y: g.y + s * 36 })]],
          ['diagonal, más horizontal', (g, s) => [g, ...line(g, { x: g.x + 36, y: g.y + s * 30 })]],
          ['de costado y después vertical', (g, s) => [g, ...line(g, { x: g.x + 8, y: g.y }, 3), ...line({ x: g.x + 8, y: g.y }, { x: g.x + 10, y: g.y + s * 110 })]],
        ]) {
          await setFrac(page, id, 0.5);
          await center(page, `[data-sk="${id}"]`); await frames(page);
          const k = await kgeo(page, id), b = await body(page);
          const s = b.max - b.st >= b.st ? -1 : 1;
          const v0 = await page.evaluate(VALUES);
          await touchPath(page, path({ x: k.cx, y: k.cy }, s));
          const st1 = await settleScroll(page, SB);
          const changed = diffValues(v0, await page.evaluate(VALUES)), scrolled = Math.abs(st1 - b.st) >= 8;
          await closeModal(page);
          console.log(`  ${t.label} · «${k.label}» · ${what}: scroll ${Math.round(Math.abs(st1 - b.st))} px · ${changed.length ? 'cambia ' + changed.length + ' valor(es)' : 'nada cambia'}`);
          assert.ok(!(scrolled && changed.length), `${file} · ${t.label} · «${k.label}» · ${what}: scrolleó y cambió valores a la vez (${changed.join(', ')})`);
          if (what === 'diagonal, más horizontal') assert.ok(!scrolled && changed.length, `${file} · «${k.label}» · ${what}: tiene que ajustar y no scrollear`);
          else assert.ok(scrolled && !changed.length, `${file} · «${k.label}» · ${what}: tiene que scrollear y dejar el valor como estaba`);
        }
      }
      assert.ok(seen > 0, `${file}: ninguna pestaña con knobs`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`${file} · knobs de los sheets: arrastre horizontal relativo (sensibilidad ${SENS[file]} px), el slider lo sigue y se autoguarda`, async () => {
    const { ctx, page, errors, tabs } = await open(h, file);
    let saved = null;
    try {
      for (const t of tabs) {
        await openTab(page, t.id);
        const m = await page.evaluate(MARK);
        if (!m.n) continue;
        assert.ok(m.cont, `${file} · ${t.label}: ningún knob continuo para medir la proporción`);
        const id = m.cont;
        const run = async (start, dx, what) => {
          await setFrac(page, id, start);
          await center(page, `[data-sk="${id}"]`); await frames(page);
          const s = await kgeo(page, id);
          await drag(page, { x: s.cx, y: s.cy }, { x: s.cx + dx, y: s.cy + 2 });
          await page.waitForTimeout(60);
          const a = await kgeo(page, id);
          const want = Math.min(1, Math.max(0, s.f + dx / SENS[file]));
          console.log(`  ${t.label} · «${s.label}» ${what}: ${s.f.toFixed(3)} ${dx > 0 ? '+' : ''}${dx}px → ${a.f.toFixed(3)} (esperado ${want.toFixed(3)}) · slider ${a.slider == null ? '—' : a.slider.toFixed(3)} · «${a.text}»`);
          assert.ok(Math.abs(a.f - want) <= 0.012, `${file} · ${t.label} · «${s.label}» ${what}: ${s.f} ${dx}px tenía que dar ~${want.toFixed(3)} y dio ${a.f.toFixed(3)}`);
          if (a.slider != null) assert.ok(Math.abs(a.slider - a.f) <= 0.012, `«${s.label}»: el slider de la fila (${a.slider}) tiene que seguir al knob (${a.f})`);
          assert.equal(await modalOpen(page), false, `«${s.label}»: el arrastre abrió la entrada numérica`);
          return a;
        };
        await run(0.3, 40, 'a la derecha');
        await run(0.7, -30, 'a la izquierda');
        if (!saved) saved = { tab: t.id, label: (await kgeo(page, id)).label, ...(await run(0.2, 50, 'para el autoguardado')) };
      }
      assert.ok(saved, `${file}: ninguna pestaña con knobs`);
      assert.deepEqual(errors, []);
      await page.waitForTimeout(1900);                   // debounce del autoguardado: 1,5 s
      await reload(page);
      await page.waitForTimeout(700);
      await openTab(page, saved.tab);
      const back = await page.evaluate((label) => {
        const k = [...document.querySelectorAll('#zd-sheet .zd-pane.on [role=slider]:not(input)')].find((x) => x.getAttribute('aria-label') === label);
        return k ? +k.getAttribute('aria-valuenow') : null;
      }, saved.label);
      console.log(`  «${saved.label}» arrastrado a ${saved.now} · al recargar: ${back}`);
      assert.ok(back != null && Math.abs(back - saved.now) <= Math.abs(saved.max - saved.min) * 0.002, `${file} · «${saved.label}»: el autoguardado tiene que conservar el valor arrastrado (${saved.now} → ${back})`);
    } finally { await ctx.close(); }
  });

  test(`${file} · knobs de los sheets: doble toque = valor por defecto, long-press = entrada numérica, role="slider" y teclado sin cambios`, async () => {
    const { ctx, page, errors, tabs } = await open(h, file);
    try {
      let done = 0;
      for (const t of tabs) {
        await openTab(page, t.id);
        const m = await page.evaluate(MARK);
        if (!m.n) continue;
        const id = m.ids[0];
        await center(page, `[data-sk="${id}"]`); await frames(page);
        let g = await kgeo(page, id);
        const where = `${file} · ${t.label} · «${g.label}»`;
        assert.equal(g.role, 'slider', `${where}: role="slider"`);
        assert.ok(g.label && g.text && isFinite(g.min) && isFinite(g.max) && isFinite(g.now), `${where}: aria-label, aria-valuetext y aria-valuemin/max/now`);

        // teclado
        await key(page, id, 'End'); const kEnd = await kgeo(page, id);
        await key(page, id, 'Home'); const kHome = await kgeo(page, id);
        await key(page, id, 'ArrowRight'); const kR = await kgeo(page, id);
        await key(page, id, 'ArrowLeft'); const kL = await kgeo(page, id);
        assert.equal(kEnd.now, g.max, `${where}: Fin lleva al máximo`);
        assert.equal(kHome.now, g.min, `${where}: Inicio lleva al mínimo`);
        assert.ok(kR.now > kHome.now && kL.now === kHome.now, `${where}: → sube y ← vuelve (${kHome.now} → ${kR.now} → ${kL.now})`);
        await key(page, id, 'Enter');
        await page.waitForTimeout(150);
        assert.ok(await modalOpen(page), `${where}: Enter abre la entrada numérica`);
        await closeModal(page);
        assert.equal(await modalOpen(page), false, `${where}: Escape cierra la entrada numérica`);

        // doble toque desde el máximo y desde el mínimo: el mismo valor por defecto
        const dbl = async (k) => {
          await key(page, id, k);
          await page.evaluate(() => document.activeElement && document.activeElement.blur());
          await page.waitForTimeout(400);
          await center(page, `[data-sk="${id}"]`); await frames(page);
          const s = await kgeo(page, id);
          await doubleTap(page, { x: s.cx, y: s.cy });
          await page.waitForTimeout(120);
          return { from: s.now, to: (await kgeo(page, id)).now };
        };
        const d1 = await dbl('End'), d2 = await dbl('Home');
        assert.equal(await modalOpen(page), false, `${where}: el doble toque abrió la entrada numérica`);
        assert.equal(d1.to, d2.to, `${where}: el doble toque tiene que dar el valor por defecto desde el máximo y desde el mínimo (${d1.to} / ${d2.to})`);
        assert.ok(d1.to !== d1.from || d2.to !== d2.from, `${where}: el doble toque no cambió nada`);

        // long-press: entrada numérica, sin cambiar el valor
        await page.waitForTimeout(400);
        g = await kgeo(page, id);
        await touchPath(page, [{ x: g.cx, y: g.cy }], { holdMs: 750 });
        await page.waitForTimeout(150);
        const lp = await modalOpen(page), after = await kgeo(page, id);
        await closeModal(page);
        console.log(`  ${t.label} · «${g.label}» · teclado Fin ${kEnd.now} · Inicio ${kHome.now} · → ${kR.now} · Enter abre · doble toque desde ${d1.from} → ${d1.to}, desde ${d2.from} → ${d2.to} · long-press: ${lp ? 'entrada numérica' : 'NADA'}`);
        assert.ok(lp, `${where}: el long-press tiene que abrir la entrada numérica`);
        assert.equal(after.now, g.now, `${where}: el long-press no cambia el valor`);
        done++;
      }
      assert.ok(done > 0, `${file}: ninguna pestaña con knobs`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

test('fuera de los sheets: knobs de la zona de tocar (teléfono) y los 4 en el escritorio siguen con arrastre vertical', async () => {
  for (const file of FILES) {
    if (STAGE[file]) {
      const { ctx, page, errors } = await open(h, file);
      try {
        await page.evaluate((sel) => document.querySelector(sel).setAttribute('data-sk', 's'), STAGE[file]);
        let g = await kgeo(page, 's');
        await key(page, 's', 'Home'); await key(page, 's', 'ArrowRight'); await key(page, 's', 'ArrowRight');
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        g = await kgeo(page, 's');
        await drag(page, { x: g.cx, y: g.cy }, { x: g.cx + 2, y: g.cy - 40 });
        const up = await kgeo(page, 's');
        await page.waitForTimeout(400);
        await drag(page, { x: up.cx, y: up.cy }, { x: up.cx + 40, y: up.cy + 1 });
        const side = await kgeo(page, 's');
        console.log(`  ${file} · zona de tocar · «${g.label}»: ${g.f.toFixed(3)} ↑40px → ${up.f.toFixed(3)} · →40px → ${side.f.toFixed(3)}`);
        assert.ok(up.f > g.f + 0.05, `${file}: «${g.label}» (fuera del sheet) tiene que subir con el arrastre vertical`);
        assert.ok(Math.abs(side.f - up.f) <= 0.012, `${file}: «${g.label}» (fuera del sheet) no se mueve de costado`);
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    }
    const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${h.srv.origin}/descargables/${file}`, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      for (const s of ['#power', '#powerOvl']) if (await page.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.getClientRects().length && getComputedStyle(e).display !== 'none'); }, s)) { await page.click(s); await page.waitForTimeout(500); }
      const ok = await page.evaluate(() => {
        const k = [...document.querySelectorAll('[role=slider]:not(input)')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.width < 90 && Math.abs(r.width - r.height) < 4 && r.top > 60 && r.bottom < innerHeight - 60 && getComputedStyle(e).touchAction === 'none'; });
        if (k) k.setAttribute('data-sk', 'd');
        return !!k && !(window.ZD && ZD.mobile && ZD.mobile.active);
      });
      assert.ok(ok, `${file}: en el escritorio (sin shell) tiene que haber un knob a la vista`);
      await key(page, 'd', 'Home'); await key(page, 'd', 'ArrowRight'); await key(page, 'd', 'ArrowRight');
      const g = await kgeo(page, 'd');
      await page.mouse.move(g.cx, g.cy); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(g.cx, g.cy - 5 * i);
      await page.mouse.up();
      const up = await kgeo(page, 'd');
      await page.mouse.move(up.cx, up.cy); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(up.cx + 5 * i, up.cy);
      await page.mouse.up();
      const side = await kgeo(page, 'd');
      console.log(`  ${file} · escritorio · «${g.label}»: ${g.f.toFixed(3)} ↑40px → ${up.f.toFixed(3)} · →40px → ${side.f.toFixed(3)}`);
      assert.ok(up.f > g.f + 0.05, `${file}: en el escritorio «${g.label}» tiene que subir con el arrastre vertical`);
      assert.ok(Math.abs(side.f - up.f) <= 0.012, `${file}: en el escritorio «${g.label}» no se mueve de costado`);
    } finally { await ctx.close(); }
  }
});
