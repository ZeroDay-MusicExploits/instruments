#!/usr/bin/env node
// tools/tests/cronbeat-sheet-sliders.test.mjs
//
// CronBeat-8:08 · sliders de los sheets en el teléfono (PADS, SEQ, FX, SAMPLE,
// CANCIÓN). Pedido: "el scroll de los distintos menús (pads, seq, fx…): en el
// lateral debe ser más seguro poder scrollear, sin cambiar todo el tiempo sin
// querer los parámetros de los efectos".
//
//   node tools/tests/cronbeat-sheet-sliders.test.mjs
//
// Los gestos van por CDP (Input.dispatchTouchEvent, ver lib/touch.mjs): pasan
// por touch-action, el scroll nativo y el pointercancel de Chromium como un
// dedo. Qué exige, con html.zd-m y el sheet abierto:
//
// 1. En cada sheet, un swipe vertical que arranca sobre un slider (en la pista y
//    en la perilla, con 4 px de deriva horizontal) scrollea el sheet y no
//    cambia ningún valor (ni del DOM ni del estado de CronBeat).
// 2. Un toque en la pista no cambia el valor y deja el foco en el slider.
// 3. Un arrastre horizontal sobre la perilla cambia el valor en relativo y en
//    proporción al dedo (Δvalor = Δx / recorrido × rango); desde la pista,
//    lejos de la perilla, también relativo (no salta al dedo), y menos de 10 px
//    de costado no hace nada. Llega al estado, al JSON y al autoguardado.
// 4. Teclado: tras el toque, ← → Inicio Fin mueven el slider (y no el tempo).
// 5. Doble toque en el PAN de la mezcla: vuelve a 0, como el doble clic; un
//    toque solo no lo cambia.
// 6. Ningún control de los sheets mide <44 px (salvo la grilla de 8 de
//    patrones, que SPEC R1 acepta con ≥38 de ancho y ≥48 de alto) y no hay
//    scroll horizontal, a 360×640, 390×844, 768×1024 y 844×390.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { swipe, tap, drag, settleScroll } from './lib/touch.mjs';

const URL_PATH = '/descargables/CronBeat-808.html';
const SB = '#zd-sheet .zd-sbody';
const TABS = [['pads', 'PADS'], ['seq', 'SEQ'], ['fx', 'FX'], ['smp', 'SAMPLE'], ['song', 'CANCIÓN']];
const THUMB = 20;                 // ancho de la perilla en el skin del sheet
const MIN_SPAN = 160;             // recorrido mínimo del arrastre relativo (bindSheetSliders)
const PHONE = { width: 360, height: 640 };

let srv, browser;
test.before(async () => {
  srv = await serveRoot();
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/* CronBeat con un sample en la pista 1 (para que SAMPLE tenga sliders) y 4
   bloques de canción (para que CANCIÓN tenga sliders y algo para scrollear). */
async function open(vp = PHONE) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active), null, { timeout: 10000 });
  await page.evaluate(async () => {
    const sr = 22050, n = Math.floor(sr / 4), buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf); let o = 0;
    const S = (t) => { for (const c of t) dv.setUint8(o++, c.charCodeAt(0)); }, U32 = (v) => { dv.setUint32(o, v, true); o += 4; }, U16 = (v) => { dv.setUint16(o, v, true); o += 2; };
    S('RIFF'); U32(36 + n * 2); S('WAVE'); S('fmt '); U32(16); U16(1); U16(1); U32(sr); U32(sr * 2); U16(2); U16(16); S('data'); U32(n * 2);
    for (let i = 0; i < n; i++) { dv.setInt16(o, Math.round(Math.sin(i / 8) * 12000 * (1 - i / n)), true); o += 2; }
    loadSampleFile(0, new File([buf], 'golpe.wav', { type: 'audio/wav' }));
    for (let i = 0; i < 40 && !sampleBuffers[0]; i++) await new Promise((r) => setTimeout(r, 50));
    selectEditorPad(0);
    for (let i = 0; i < 4; i++) addBlock();
  });
  return { ctx, page, errors };
}
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function openTab(page, id) {
  await page.evaluate((id) => { ZD.mobile.open(id); document.querySelector('#zd-sheet .zd-sbody').scrollTop = 0; }, id);
  await page.waitForTimeout(260);                 // transición del sheet (180 ms)
  await frames(page);
}

/* Todo lo que un slider de un sheet puede cambiar: el estado de CronBeat y los
   valores del DOM. */
const STATE = () => JSON.stringify({
  reverb, delay, phaser, drive, swing, masterVol, vol, pan, revSend, dlySend, phaserMix, driveMix,
  reps: song.map((b) => b.reps), edit: sampleEdit[0],
  dom: [...document.querySelectorAll('input,select')].map((e) => e.value),
});

/* Geometría de un slider (y su perilla). */
const GEO = (sel) => {
  const i = document.querySelector(sel), r = i.getBoundingClientRect(), sb = document.querySelector('#zd-sheet .zd-sbody').getBoundingClientRect();
  const min = +i.min, max = +i.max, v = +i.value;
  return { left: r.left, right: r.right, w: r.width, cy: r.top + r.height / 2, h: r.height, min, max, v,
    thumb: r.left + 10 + (v - min) / (max - min) * (r.width - 20), sbTop: sb.top, sbBottom: sb.bottom, focus: document.activeElement === i };
};
const geo = (page, sel) => page.evaluate(GEO, sel);
/* Un punto de la pista a ≥30 px de la perilla. */
const trackPoint = (g) => {
  const a = g.left + g.w * 0.1, b = g.left + g.w * 0.9;
  return Math.abs(a - g.thumb) > Math.abs(b - g.thumb) ? a : b;
};
const setVal = (page, sel, v) => page.evaluate(({ sel, v }) => {
  const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true }));
}, { sel, v });

/* Elige el slider del medio del pane abierto, lo marca y lo deja a media altura
   del cuerpo del sheet (hasta donde dé el scroll). */
async function pickSlider(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-cand]').forEach((e) => e.removeAttribute('data-cand'));
    const list = [...document.querySelectorAll('#zd-sheet .zd-pane.on input[type=range]')].filter((i) => i.getClientRects().length);
    const i = list[Math.floor(list.length / 2)];
    if (!i) return null;
    i.setAttribute('data-cand', '');
    const sb = document.querySelector('#zd-sheet .zd-sbody');
    const rel = i.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop;
    sb.scrollTop = Math.max(0, rel - sb.clientHeight / 2 + 22);
    return { n: list.length, label: i.getAttribute('aria-label') || i.id, max: sb.scrollHeight - sb.clientHeight };
  });
}

// ─────────────────────────────────── casos ────────────────────────────────────

test('CronBeat · en cada sheet, un swipe vertical que arranca sobre un slider scrollea y no cambia ningún valor', async () => {
  const { ctx, page, errors } = await open();
  try {
    for (const [id, label] of TABS) {
      await openTab(page, id);
      const c = await pickSlider(page);
      assert.ok(c, `${label}: no hay sliders en el sheet`);
      for (const where of ['pista', 'perilla']) {
        await frames(page);
        const st0 = await page.evaluate((s) => document.querySelector(s).scrollTop, SB);
        const g = await geo(page, '[data-cand]');
        assert.ok(g.cy > g.sbTop + 10 && g.cy < g.sbBottom - 10, `${label}: el slider tiene que estar a la vista para arrancar el swipe`);
        const x = where === 'pista' ? trackPoint(g) : g.thumb;
        const room = c.max - st0;
        const D = Math.min(140, (g.sbBottom - g.sbTop) * 0.42);
        const dir = room >= 40 ? -1 : 1;            // dedo hacia arriba si hay para bajar, si no hacia abajo
        const s0 = await page.evaluate(STATE);
        await swipe(page, { x, y: g.cy }, { x: x + 4, y: g.cy + dir * D });
        const st1 = await settleScroll(page, SB);
        const s1 = await page.evaluate(STATE);
        console.log(`  ${label} · «${c.label}» (${c.n} sliders) · swipe desde la ${where}: scrollTop ${Math.round(st0)} → ${Math.round(st1)}`);
        assert.ok(Math.abs(st1 - st0) >= 20, `${label}: el swipe vertical desde la ${where} de «${c.label}» tiene que scrollear el sheet (${st0} → ${st1})`);
        assert.equal(s1, s0, `${label}: el swipe vertical desde la ${where} de «${c.label}» cambió un valor`);
        await page.evaluate(({ s, st }) => { document.querySelector(s).scrollTop = st; }, { s: SB, st: st0 });
        await settleScroll(page, SB);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · un toque en la pista no cambia el valor y deja el foco en el slider', async () => {
  const { ctx, page, errors } = await open();
  try {
    for (const [id, label] of TABS) {
      await openTab(page, id);
      const c = await pickSlider(page);
      await frames(page);
      const g = await geo(page, '[data-cand]');
      const s0 = await page.evaluate(STATE);
      for (const x of [g.left + g.w * 0.1, g.left + g.w * 0.9].filter((x) => Math.abs(x - g.thumb) > 22)) {
        await tap(page, { x, y: g.cy });
        await page.waitForTimeout(60);
      }
      const after = await geo(page, '[data-cand]');
      assert.equal(after.v, g.v, `${label}: tocar la pista de «${c.label}» saltó el valor (${g.v} → ${after.v})`);
      assert.equal(await page.evaluate(STATE), s0, `${label}: tocar la pista cambió el estado`);
      assert.ok(after.focus, `${label}: el toque tiene que dejar el foco en «${c.label}» (para el teclado)`);
      console.log(`  ${label} · «${c.label}» = ${g.v}: tocar la pista no lo cambia, queda enfocado`);
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · arrastre horizontal: relativo y proporcional desde la perilla y desde la pista; llega al estado, al JSON y al autoguardado', async () => {
  const { ctx, page, errors } = await open();
  try {
    await openTab(page, 'fx');
    const SEL = '#revLevel';
    const changes = await page.evaluate((s) => { window.__chg = 0; document.querySelector(s).addEventListener('change', () => window.__chg++); return 0; }, SEL);
    const run = async (from, dx, start, what) => {
      await setVal(page, SEL, start);
      await frames(page);
      const g = await geo(page, SEL);
      const x0 = from === 'perilla' ? g.thumb : from;
      await page.evaluate(() => { window.__chg = 0; });
      await drag(page, { x: x0, y: g.cy }, { x: x0 + dx, y: g.cy + 2 });
      const a = await geo(page, SEL);
      const span = Math.max(MIN_SPAN, g.w - THUMB);
      const want = Math.min(g.max, Math.max(g.min, start + dx / span * (g.max - g.min)));
      const chg = await page.evaluate(() => window.__chg);
      console.log(`  Reverb · Nivel ${what}: ${start} ${dx > 0 ? '+' : ''}${dx}px → ${a.v} (esperado ${want.toFixed(1)}, recorrido ${Math.round(span)}px) · change ×${chg}`);
      assert.ok(Math.abs(a.v - want) <= 1.5, `${what}: ${start} ${dx}px tenía que dar ~${want.toFixed(1)} y dio ${a.v}`);
      assert.equal(chg, a.v !== start ? 1 : 0, `${what}: un arrastre despacha un solo change al soltar`);
      return a.v - start;
    };
    const d40 = await run('perilla', 40, 35, 'desde la perilla');
    const d80 = await run('perilla', 80, 35, 'desde la perilla');
    assert.ok(Math.abs(d80 - 2 * d40) <= 2, `proporcional: +80px (${d80}) tiene que mover el doble que +40px (${d40})`);
    await run('perilla', -60, 70, 'desde la perilla');
    // desde la pista, lejos de la perilla: relativo (con 35 la perilla está al 35 %, el dedo arranca al 90 %)
    let g = await geo(page, SEL);
    await run(g.left + g.w * 0.9, -45, 35, 'desde la pista (90 %)');
    g = await geo(page, SEL);
    await run(g.left + g.w * 0.08, 50, 60, 'desde la pista (8 %)');
    // menos de 10 px de costado desde la pista: nada
    await setVal(page, SEL, 35); g = await geo(page, SEL);
    await drag(page, { x: g.left + g.w * 0.9, y: g.cy }, { x: g.left + g.w * 0.9 - 8, y: g.cy + 1 });
    assert.equal((await geo(page, SEL)).v, 35, 'desde la pista, 8 px de costado no alcanzan para mover el slider');

    // slider angosto (matriz de envíos): recorrido mínimo de 160 px
    const M = '.mrow .mcell.rev input';
    await page.evaluate((m) => document.querySelector(m).scrollIntoView({ block: 'center' }), M);
    await setVal(page, M, 20); await frames(page);
    g = await geo(page, M);
    await drag(page, { x: g.thumb, y: g.cy }, { x: g.thumb + 40, y: g.cy + 1 });
    const m1 = await geo(page, M);
    const wantM = 20 + 40 / Math.max(MIN_SPAN, g.w - THUMB) * 100;
    console.log(`  Envío a reverb (${Math.round(g.w)}px de ancho): 20 +40px → ${m1.v} (esperado ${wantM.toFixed(1)})`);
    assert.ok(Math.abs(m1.v - wantM) <= 1.5, `matriz: 20 +40px tenía que dar ~${wantM.toFixed(1)} y dio ${m1.v}`);
    assert.equal(await page.evaluate(() => Math.round(revSend[0] * 100)), m1.v, 'el envío de la pista 1 tiene que seguir al slider');

    // estado, JSON y autoguardado
    await openTab(page, 'fx');
    await setVal(page, SEL, 35); g = await geo(page, SEL);
    await drag(page, { x: g.thumb, y: g.cy }, { x: g.thumb + 30, y: g.cy });
    const v = (await geo(page, SEL)).v;
    const st = await page.evaluate(() => ({ lvl: Math.round(reverb.level * 100), out: document.getElementById('revLevelOut').textContent, json: Math.round(buildProject().fx.reverb.level * 100) }));
    assert.deepEqual(st, { lvl: v, out: String(v), json: v }, 'el valor tiene que llegar a reverb.level, a la salida y al JSON');
    await page.waitForTimeout(1900);                // debounce del autoguardado: 1,5 s
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active), null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const back = await page.evaluate(() => ({ lvl: Math.round(reverb.level * 100), dom: +document.getElementById('revLevel').value }));
    console.log(`  Reverb · Nivel arrastrado a ${v} · al recargar: reverb.level ${back.lvl}, slider ${back.dom}`);
    assert.deepEqual(back, { lvl: v, dom: v }, 'el autoguardado tiene que conservar el valor arrastrado');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · teclado: después del toque, ← → Inicio Fin mueven el slider y no el tempo', async () => {
  const { ctx, page, errors } = await open();
  try {
    for (const [id, sel] of [['fx', '#revLevel'], ['seq', '#swing'], ['song', '.songrow[data-block="1"] .reps input']]) {
      await openTab(page, id);
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
      await setVal(page, sel, await page.evaluate((s) => { const i = document.querySelector(s); return Math.round((+i.min + +i.max) / 2); }, sel));
      await frames(page);
      const g = await geo(page, sel);
      const tempo0 = await page.evaluate(() => tempo);
      await tap(page, { x: trackPoint(g), y: g.cy });
      await page.waitForTimeout(60);
      const seen = [(await geo(page, sel)).v];
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'Home']) {
        await page.keyboard.press(k);
        seen.push((await geo(page, sel)).v);
      }
      console.log(`  ${sel}: toque ${g.v} → ${seen[0]} · → → ← Fin Inicio: ${seen.slice(1).join(' · ')}`);
      assert.equal(seen[0], g.v, `${sel}: el toque no puede cambiar el valor`);
      assert.deepEqual(seen.slice(1), [g.v + 1, g.v + 2, g.v + 1, g.max, g.min], `${sel}: las flechas, Inicio y Fin tienen que mover el slider`);
      assert.equal(await page.evaluate(() => tempo), tempo0, `${sel}: ← → sobre un slider no pueden cambiar el tempo`);
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · doble toque en el PAN de la mezcla: vuelve a 0; un toque solo no lo cambia', async () => {
  const { ctx, page, errors } = await open();
  try {
    await openTab(page, 'pads');
    const SEL = '.pmrow[data-track="2"] .pmpan';
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), SEL);
    await setVal(page, SEL, 40); await frames(page);
    const g = await geo(page, SEL);
    const p = { x: trackPoint(g), y: g.cy };
    await tap(page, p); await page.waitForTimeout(600);           // un toque, y otro lejos en el tiempo
    await tap(page, p); await page.waitForTimeout(600);
    const single = await page.evaluate((s) => ({ v: +document.querySelector(s).value, pan: Math.round(pan[2] * 100) }), SEL);
    assert.deepEqual(single, { v: 40, pan: 40 }, 'dos toques separados no son doble toque: el PAN no cambia');
    await tap(page, p); await page.waitForTimeout(110); await tap(page, p);
    await page.waitForTimeout(80);
    const dbl = await page.evaluate((s) => ({ v: +document.querySelector(s).value, pan: Math.round(pan[2] * 100), row: +document.querySelector('.track[data-track="2"] .pan').value }), SEL);
    console.log(`  PAN de la pista 3 en 40 · dos toques separados: ${single.v} · doble toque: ${dbl.v} (pan[2]=${dbl.pan}, fila del secuenciador ${dbl.row})`);
    assert.deepEqual(dbl, { v: 0, pan: 0, row: 0 }, 'el doble toque tiene que centrar el PAN (como el doble clic)');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · sheets: ningún control <44 px y sin scroll horizontal (360×640, 390×844, 768×1024, 844×390)', async () => {
  for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    const { ctx, page, errors } = await open(vp);
    try {
      const seen = [];
      for (const [id, label] of TABS) {
        await openTab(page, id);
        const r = await page.evaluate(() => {
          const CTL = 'button,input:not([type=hidden]),select,textarea,a[href],[role=slider],[role=button],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
          const sb = document.querySelector('#zd-sheet .zd-sbody'), small = [];
          let n = 0, min = Infinity;
          document.querySelectorAll('#zd-sheet .zd-pane.on').forEach((p) => p.querySelectorAll(CTL).forEach((e) => {
            const b = e.getBoundingClientRect();
            if (!b.width || !b.height) return;
            n++;
            // grilla de 8 (patrones A–H): SPEC R1 acepta 38–40 de ancho con alto ≥48
            const grid8 = e.classList.contains('patbtn') && b.width >= 37.5 && b.height >= 47.5;
            if (!grid8) min = Math.min(min, b.width, b.height);
            if (Math.min(b.width, b.height) < 43.5 && !grid8) small.push((e.id || e.getAttribute('aria-label') || e.className || e.tagName) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
          }));
          return { n, min, small, sw: sb.scrollWidth, cw: sb.clientWidth, doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
        });
        seen.push(`${label} ${r.n}`);
        assert.ok(r.n > 0, `${vp.width}×${vp.height} · ${label}: no encontré controles`);
        assert.deepEqual(r.small, [], `${vp.width}×${vp.height} · ${label}: controles por debajo de 44 px`);
        assert.ok(r.sw <= r.cw + 1, `${vp.width}×${vp.height} · ${label}: scroll horizontal en el sheet (${r.sw} > ${r.cw})`);
        assert.equal(r.doc, false, `${vp.width}×${vp.height} · ${label}: scroll horizontal en la página`);
      }
      console.log(`  ${vp.width}×${vp.height}: controles ≥44 px y sin scroll horizontal · ${seen.join(' · ')}`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});
