#!/usr/bin/env node
// tools/tests/zd-mobile-rail.test.mjs
//
// zd-mobile v5 · carril de scroll lateral en los sheets, en los 5 instrumentos
// publicados (descargables/). Pedido: "en el lateral debe ser más seguro poder
// scrollear, sin cambiar todo el tiempo sin querer los parámetros".
//
//   node tools/tests/zd-mobile-rail.test.mjs
//   node tools/tests/zd-mobile-rail.test.mjs --file CronBeat-808.html   # uno solo
//
// Qué exige, en cada pestaña de cada instrumento (las peek incluidas):
//
// 1. Carril: el padding derecho de #zd-sheet .zd-sbody mide ≥32 px y ningún
//    control (botón, input, select, link, role=slider/button/…, tabindex, ni nada
//    con touch-action:none, como un knob o un canvas) se mete en esa franja, en
//    todo el alto del contenido (también lo que está fuera de la vista).
// 2. Indicador: con algo para scrollear, .zd-rail se ve, ocupa la franja y su
//    barra está adentro; sin nada para scrollear, no se ve.
// 3. Un swipe vertical de verdad (CDP, Input.dispatchTouchEvent) en el carril
//    scrollea el sheet (scrollTop cambia, ida y vuelta) y no cambia nada: los
//    valores de todos los input/select/textarea y los aria-valuenow/pressed/
//    checked del documento quedan idénticos.
// 4. Layout, a 360×640, 390×844, 768×1024 y 844×390: comparado con la geometría
//    de v4 (sin carril) en la misma página, ningún control que medía ≥44 px en
//    el eje corto queda por debajo (salvo la grilla de 8 que acepta SPEC R1:
//    ≥38 de ancho con ≥48 de alto), ninguna grilla que tenía 2 o más columnas
//    queda en 1, no aparece scroll horizontal (ni en la página ni en el sheet) y
//    ningún control se mete en el carril. Una pérdida de alto falla siempre;
//    una de ancho, salvo las de KNOWN_NARROW. Se listan sin fallar: los
//    controles que ya medían <44 con v4, un sheet que ya desbordaba a lo ancho
//    con v4 (los dos son de cada instrumento) y una fila flex-wrap que se apila
//    (reflujo de una barra de botones, no una grilla rota).
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { readBlock } from './lib/load-block.mjs';
import { swipe, settleScroll } from './lib/touch.mjs';

const argv = process.argv.slice(2);
const only = argv.includes('--file') ? argv[argv.indexOf('--file') + 1].replace(/^.*\//, '') : null;
const FILES = ['Acid_Bass-303.html', 'CronBeat-808.html', 'J4-Sirens_Station.html', 'MonoMoon70.html', 'Nebularp_2035.html']
  .filter((f) => !only || f === only);
if (!FILES.length) { console.error(`--file ${only}: no es uno de los 5 instrumentos`); process.exit(2); }
const VERSION = readBlock('zd-mobile').version;
/* Pérdidas de ANCHO conocidas por el carril, de controles que siguen midiendo
   ≥44 de alto, en archivos que esta tarea no puede tocar. Cada una tiene su
   arreglo propuesto en reports/F3-barrido-scroll.md. Una pérdida de ALTO no
   tiene excepción. */
const KNOWN_NARROW = {
  // OSC: grilla de 6 formas de onda adentro de 51 px de paddings anidados; a
  // 360 px pasa de 46 a 42 de ancho. Arreglo (sesión de MonoMoon): 3×2 en
  // pantallas angostas.
  'MonoMoon70.html': ['button.wave-btn'],
};
const SB = '#zd-sheet .zd-sbody';
const SWIPE_VP = { width: 360, height: 640 };
const LAYOUT_VPS = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }];

// ───────────────────────────── código de la página ────────────────────────────

/* Controles: lo que se toca o se enfoca. Más todo lo que tenga touch-action:none
   (knobs, pads, canvas), que también "agarra" el dedo. */
const COMMON = `
  const CTL = 'button,input:not([type=hidden]),select,textarea,a[href],[role=slider],[role=button],[role=switch],[role=checkbox],[role=tab],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  const box = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.getClientRects().length ? r : null; };
  const name = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : '')) +
    (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label').slice(0, 24) + ']' : '');
  const grabbers = (pane) => {
    const set = new Set(pane.querySelectorAll(CTL));
    pane.querySelectorAll('*').forEach((e) => { if (getComputedStyle(e).touchAction === 'none') set.add(e); });
    return [...set];
  };
`;

/* Estado del carril en la pestaña abierta. */
const RAIL_PROBE = `(() => {
  ${COMMON}
  const sheet = document.getElementById('zd-sheet'), sb = sheet.querySelector('.zd-sbody');
  const pane = sheet.querySelector('.zd-pane.on'), rail = sheet.querySelector('.zd-rail');
  const sr = sb.getBoundingClientRect(), cs = getComputedStyle(sb);
  const padR = parseFloat(cs.paddingRight);
  const inner = sr.left + sb.clientLeft + sb.clientWidth;          // borde derecho del padding
  const zone = { left: inner - padR, right: inner, top: sr.top, bottom: sr.bottom };
  const intruders = grabbers(pane).map((e) => [e, box(e)]).filter(([, r]) => r && r.right > zone.left + 0.5 && r.left < zone.right - 0.5)
    .map(([e, r]) => name(e) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
  const rr = rail && !rail.hidden ? rail.getBoundingClientRect() : null;
  const th = rail && rail.querySelector('i') ? rail.querySelector('i').getBoundingClientRect() : null;
  return {
    peek: sheet.classList.contains('peek'),
    railVar: parseFloat(getComputedStyle(sheet).getPropertyValue('--zd-rail')) || 0,
    padR, zone, intruders,
    scrollMax: sb.scrollHeight - sb.clientHeight, scrollTop: sb.scrollTop,
    hscroll: sb.scrollWidth > sb.clientWidth + 1,
    rail: rail ? { exists: true, hidden: rail.hidden, ariaHidden: rail.getAttribute('aria-hidden'), pe: getComputedStyle(rail).pointerEvents,
      display: getComputedStyle(rail).display,
      box: rr && { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom },
      thumb: th && { top: th.top, bottom: th.bottom, h: th.height, w: th.width } } : null,
  };
})()`;

/* Huella de "valores": cambia si cualquier parámetro cambió. */
const VALUES = `(() => {
  const out = [];
  document.querySelectorAll('input,select,textarea').forEach((e, i) => out.push(i + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)));
  document.querySelectorAll('[aria-valuenow],[aria-pressed],[aria-checked]').forEach((e, i) =>
    out.push('a' + i + '=' + [e.getAttribute('aria-valuenow'), e.getAttribute('aria-pressed'), e.getAttribute('aria-checked')].join('/')));
  return out.join('|');
})()`;

/* Geometría para comparar con y sin carril. `v4` pone el cuerpo del sheet como
   en zd-mobile v4 (sin margen negativo y con 2 px de padding a la derecha). */
const LAYOUT_PROBE = `((v4) => {
  ${COMMON}
  const sb = document.querySelector('#zd-sheet .zd-sbody'), pane = document.querySelector('#zd-sheet .zd-pane.on');
  sb.style.cssText = v4 ? 'margin-right:0;padding:2px 2px 4px' : '';
  void sb.offsetWidth;
  const ctls = grabbers(pane).map((e) => { const r = box(e); return r ? { n: name(e), w: r.width, h: r.height } : null; });
  const conts = [];
  pane.querySelectorAll('*').forEach((c) => {
    const kids = [...c.children].map(box).filter(Boolean);
    if (kids.length < 2) { conts.push(null); return; }
    /* filas por solapamiento vertical (no por top: con align-items:center los
       hijos de una misma fila arrancan a alturas distintas) */
    const rows = [];
    kids.sort((p, q) => p.top - q.top).forEach((r) => {
      const row = rows.find((w) => r.top < w.bottom - 2 && r.bottom > w.top + 2);
      if (row) { row.n++; row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ top: r.top, bottom: r.bottom, n: 1 });
    });
    const cs = getComputedStyle(c);
    conts.push({ n: name(c), cols: Math.max(...rows.map((w) => w.n)), rows: rows.length, grid: /grid/.test(cs.display) });
  });
  const sr = sb.getBoundingClientRect(), inner = sr.left + sb.clientLeft + sb.clientWidth, zl = inner - parseFloat(getComputedStyle(sb).paddingRight);
  const intruders = v4 ? [] : grabbers(pane).map((e) => [e, box(e)]).filter(([, r]) => r && r.right > zl + 0.5 && r.left < inner - 0.5)
    .map(([e, r]) => name(e) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
  const out = { ctls, conts, intruders, sw: sb.scrollWidth, cw: sb.clientWidth,
    doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, content: sb.clientWidth - parseFloat(getComputedStyle(sb).paddingLeft) - parseFloat(getComputedStyle(sb).paddingRight) };
  sb.style.cssText = '';
  return out;
})`;

// ───────────────────────────────── andamiaje ──────────────────────────────────

let srv, browser;
test.before(async () => {
  srv = await serveRoot();
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(file, vp) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${srv.origin}/descargables/${file}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active && ZD.mobile.pane), null, { timeout: 10000 });
  await powerOn(page);
  const tabs = await page.evaluate(() => (window.ZD_M.tabs || []).slice(0, 5).map((t) => ({ id: t.id, label: t.label, peek: !!t.peek })));
  return { ctx, page, errors, tabs };
}
/* J4 (#power) y MonoMoon (#powerOvl) arrancan con una pantalla de encendido
   que tapa todo hasta el primer toque: sin esto el swipe cae en ella. */
const POWER = ['#power', '#powerOvl'];
async function powerOn(page) {
  const shown = (sels) => sels.find((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && +cs.opacity > 0;
  }) || null;
  const sel = await page.evaluate(shown, POWER);
  if (!sel) return;
  await page.click(sel);
  await page.waitForFunction(`!(${shown})(${JSON.stringify([sel])})`, null, { timeout: 8000 });
}
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function openTab(page, id, wait = 260) {
  await page.evaluate((id) => { ZD.mobile.open(id); document.querySelector('#zd-sheet .zd-sbody').scrollTop = 0; }, id);
  if (wait) await page.waitForTimeout(wait);   // el sheet entra con una transición de 180 ms
  await frames(page);
}

// ─────────────────────────────────── casos ────────────────────────────────────

for (const file of FILES) {
  test(`zd-mobile v${VERSION} · ${file} · carril: ≥32 px sin controles, indicador y swipe vertical que scrollea sin cambiar nada (360×640)`, async () => {
    const { ctx, page, errors, tabs } = await open(file, SWIPE_VP);
    try {
      let peeks = 0, scrolled = 0;
      for (const t of tabs) {
        await openTab(page, t.id);
        const p = await page.evaluate(RAIL_PROBE);
        const where = `${file} · ${t.label}${p.peek ? ' (peek)' : ''}`;
        if (p.peek) peeks++;
        assert.ok(p.railVar >= 32, `${where}: --zd-rail tiene que ser ≥32 px (es ${p.railVar})`);
        assert.ok(p.padR >= 32, `${where}: el carril (padding derecho de .zd-sbody) mide ${p.padR} px, tiene que ser ≥32`);
        assert.deepEqual(p.intruders, [], `${where}: controles adentro del carril (${Math.round(p.zone.left)}–${Math.round(p.zone.right)})`);
        assert.equal(p.hscroll, false, `${where}: scroll horizontal en el sheet`);
        assert.ok(p.rail && p.rail.exists, `${where}: falta el indicador .zd-rail`);
        assert.equal(p.rail.ariaHidden, 'true', `${where}: el indicador es decorativo (aria-hidden)`);
        assert.equal(p.rail.pe, 'none', `${where}: el indicador no puede recibir punteros (el dedo tiene que llegar al scroller)`);

        const scrollable = p.scrollMax > 1;
        if (scrollable) {
          assert.equal(p.rail.hidden, false, `${where}: con ${p.scrollMax} px para scrollear el indicador tiene que verse`);
          assert.ok(p.rail.display !== 'none' && p.rail.box, `${where}: el indicador está oculto por CSS`);
          assert.ok(Math.abs(p.rail.box.left - p.zone.left) <= 1 && Math.abs(p.rail.box.right - p.zone.right) <= 1,
            `${where}: el indicador (${Math.round(p.rail.box.left)}–${Math.round(p.rail.box.right)}) tiene que ocupar el carril (${Math.round(p.zone.left)}–${Math.round(p.zone.right)})`);
          assert.ok(Math.abs(p.rail.box.top - p.zone.top) <= 1 && Math.abs(p.rail.box.bottom - p.zone.bottom) <= 1, `${where}: el indicador tiene que tener el alto del cuerpo del sheet`);
          assert.ok(p.rail.thumb && p.rail.thumb.h >= 20 && p.rail.thumb.top >= p.rail.box.top - 0.5 && p.rail.thumb.bottom <= p.rail.box.bottom + 0.5,
            `${where}: la barra del indicador tiene que estar adentro del carril`);
        } else {
          assert.equal(p.rail.hidden, true, `${where}: sin nada para scrollear el indicador no se muestra`);
        }

        // swipe vertical en el carril: ida (dedo hacia arriba) y vuelta
        const x = (p.zone.left + p.zone.right) / 2;
        const lo = p.zone.top + (p.zone.bottom - p.zone.top) * 0.82, hi = p.zone.top + (p.zone.bottom - p.zone.top) * 0.18;
        const v0 = await page.evaluate(VALUES);
        await swipe(page, { x, y: lo }, { x: x + 2, y: hi });
        const down = await settleScroll(page, SB);
        const v1 = await page.evaluate(VALUES);
        let thumbMoved = null;
        if (scrollable) {
          const q = await page.evaluate(RAIL_PROBE);
          thumbMoved = q.rail.thumb.top - p.rail.thumb.top;
          await swipe(page, { x, y: hi }, { x: x - 2, y: lo });
        }
        const back = await settleScroll(page, SB);
        const v2 = await page.evaluate(VALUES);
        console.log(`  ${where}: carril ${p.padR}px · ${scrollable ? `scrollTop 0 → ${Math.round(down)} → ${Math.round(back)} (máx ${p.scrollMax}) · barra +${Math.round(thumbMoved)}px` : 'nada para scrollear'}`);
        assert.equal(v1, v0, `${where}: el swipe en el carril cambió un valor`);
        assert.equal(v2, v0, `${where}: el swipe de vuelta en el carril cambió un valor`);
        if (scrollable) {
          scrolled++;
          assert.ok(down >= Math.min(p.scrollMax, 40) - 1, `${where}: el swipe en el carril tiene que scrollear (scrollTop ${down} de ${p.scrollMax})`);
          assert.ok(thumbMoved > 0, `${where}: la barra del indicador tiene que bajar al scrollear`);
          assert.ok(back < down, `${where}: el swipe de vuelta tiene que volver a subir (${down} → ${back})`);
        } else {
          assert.equal(down, 0, `${where}: sin nada para scrollear el scrollTop queda en 0`);
        }
        await page.evaluate(() => ZD.mobile.close());
      }
      const cfgPeeks = tabs.filter((t) => t.peek).length;
      assert.equal(peeks, cfgPeeks, `${file}: las ${cfgPeeks} pestañas peek de ZD_M tienen que abrir en modo peek`);
      assert.ok(scrolled >= 1, `${file}: ninguna pestaña tuvo algo para scrollear a 360×640`);
      assert.deepEqual(errors, [], `${file}: errores de consola`);
    } finally { await ctx.close(); }
  });

  test(`zd-mobile v${VERSION} · ${file} · el carril no achica controles por debajo de 44 px ni rompe columnas; sin scroll horizontal`, async () => {
    const pre = new Set();
    for (const vp of LAYOUT_VPS) {
      const { ctx, page, errors, tabs } = await open(file, vp);
      try {
        const lost = [], broken = [], wrapped = [], known = [], overflow = [];
        let width = null;
        for (const t of tabs) {
          await openTab(page, t.id, 0);
          const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#zd-sheet .zd-sbody')).paddingRight));
          assert.ok(pad >= 32, `${file} ${vp.width}×${vp.height} · ${t.label}: el carril mide ${pad} px (tiene que ser ≥32)`);
          const a = await page.evaluate(`${LAYOUT_PROBE}(true)`);
          const b = await page.evaluate(`${LAYOUT_PROBE}(false)`);
          if (width === null) width = [Math.round(a.content), Math.round(b.content)];
          const where = `${vp.width}×${vp.height} · ${t.label}`;
          assert.equal(a.ctls.length, b.ctls.length, `${where}: cambió la cantidad de controles`);
          a.ctls.forEach((c0, i) => {
            const c1 = b.ctls[i];
            if (!c0 || !c1) return;
            // 43,5: los 44 px de CSS a veces miden 43,99 por redondeo de subpíxel
            const s0 = Math.min(c0.w, c0.h), s1 = Math.min(c1.w, c1.h);
            const grid8 = c1.h >= 47.5 && c1.w >= 37.5;
            if (s0 < 43.5) { pre.add(`${t.label} ${c0.n} ${Math.round(c0.w)}×${Math.round(c0.h)}`); return; }
            const msg = `${c1.n} ${Math.round(c0.w)}×${Math.round(c0.h)} → ${Math.round(c1.w)}×${Math.round(c1.h)}`;
            if (c1.h < 43.5) lost.push(msg);
            else if (s1 < 43.5 && !grid8) ((KNOWN_NARROW[file] || []).some((k) => c1.n.startsWith(k)) ? known : lost).push(msg);
          });
          /* Una grilla que pierde columnas es un layout roto. Una fila flex-wrap
             que se apila es reflujo de una barra de herramientas: se lista. */
          a.conts.forEach((k0, i) => {
            const k1 = b.conts[i];
            if (!k0 || !k1) return;
            if (k0.cols >= 2 && k1.cols < 2) (k1.grid ? broken : wrapped).push(`${t.label} ${k1.n}: ${k0.cols} por fila → 1${k1.grid ? '' : ' (flex-wrap)'}`);
            else if (k1.rows > k0.rows) wrapped.push(`${t.label} ${k1.n} ${k0.rows}→${k1.rows} filas`);
          });
          /* Si con la geometría de v4 el contenido ya desbordaba a lo ancho, es
             del instrumento (y puede meterse en el carril): se lista. Si no, el
             carril no puede traer scroll horizontal ni controles en la franja. */
          const pre4 = a.sw > a.cw + 1;
          if (pre4) overflow.push(`${t.label}: ya desbordaba con v4 (${a.sw} > ${a.cw}); con carril ${b.sw} > ${b.cw}` +
            (b.intruders.length ? `, en el carril: ${b.intruders.join(', ')}` : ''));
          else {
            assert.ok(b.sw <= b.cw + 1, `${where}: scroll horizontal en el sheet (${b.sw} > ${b.cw})`);
            assert.deepEqual(b.intruders, [], `${file} ${where}: controles adentro del carril`);
          }
          assert.equal(b.doc, false, `${where}: scroll horizontal en la página`);
          assert.deepEqual(lost, [], `${file} ${where}: controles que el carril deja por debajo de 44 px`);
          assert.deepEqual(broken, [], `${file} ${where}: layouts de 2 o más columnas que el carril deja en 1`);
          lost.length = 0;
        }
        console.log(`  ${file} ${vp.width}×${vp.height}: ancho útil ${width[0]} → ${width[1]} px · ${tabs.length} pestañas sin controles achicados ni columnas rotas` +
          (wrapped.length ? ` · reacomodos (no fallan): ${wrapped.join('; ')}` : '') +
          (known.length ? ` · CONOCIDO, angostos (≥44 de alto): ${known.length} × ${[...new Set(known.map((k) => k.replace(/\[.*?\]/, '')))].join(', ')}` : '') +
          (overflow.length ? ` · DEL INSTRUMENTO: ${overflow.join(' · ')}` : ''));
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    }
    if (pre.size) console.log(`  ${file}: ya medían <44 px antes del carril (del instrumento, no de este test): ${[...pre].join(' · ')}`);
  });
}
