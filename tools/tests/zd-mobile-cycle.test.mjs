#!/usr/bin/env node
// tools/tests/zd-mobile-cycle.test.mjs
//
// Bug reportado por la sesión C1 (reports/nebularp-block-request.md, punto 2):
// `enter()` llama a `build()`, que corre una sola vez, y `moveNodes()` vive
// adentro de `build()`. Al salir del shell `restoreNodes()` devuelve los nodos,
// pero al volver a entrar ya no se mueve nada: #zd-stage, la barra superior y
// los sheets quedan vacíos.
//
// Pasa al redimensionar una ventana de escritorio de un lado al otro de 820 px
// y al rotar una tablet cuyo ancho cruza 1024 px (iPad Pro 12,9": 1024 vertical,
// 1366 horizontal).
//
// El test alterna el viewport con has_touch/is_mobile varias veces seguidas y
// exige que el ciclo sea idempotente y reversible: el DOM tiene que quedar
// idéntico, los nodos tienen que ser los mismos objetos (el cableado de eventos
// sobrevive), el foco y el scroll se conservan, y el banner de zd-pwa sigue
// siendo el primer hijo de #zd-stage.
//
//   node tools/tests/zd-mobile-cycle.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { readBlock } from './lib/load-block.mjs';

const INSTRUMENT = '/descargables/Acid_Bass-303.html';
const CYCLES = 4;

/* Lo que el ZD_M de Acid manda al shell (docs/zd-blocks.md). */
const KEEP = ['seqPanel', 'stepEditPanel', 'perfPanel'];
const TRANSPORT = ['playBtn', 'clipLed'];          // + .tempo-box, que no tiene id
const PANE_NODES = { seq: ['tempoKnob', 'tapBtn', 'scope', 'kbPanel'], snd: ['oscPanel', 'distPanel'], filt: ['filtPanel', 'filterStatus'], pat: ['factoryBankLbl', 'bank'], exp: ['ioPanel'] };

const VERSION = readBlock('zd-mobile').version;

/* Pares de viewport. `shell` dice si en ese tamaño el shell tiene que estar activo:
   la media query es `(pointer:coarse) and (max-width:1024px), (max-width:820px)`. */
const PAIRS = [
  { label: 'tablet 1180×820 (sin shell) ↔ 820×1180 (shell)', a: { width: 1180, height: 820, shell: false }, b: { width: 820, height: 1180, shell: true } },
  { label: 'escritorio 1440×900 (sin shell) ↔ teléfono 390×844 (shell)', a: { width: 1440, height: 900, shell: false }, b: { width: 390, height: 844, shell: true } },
  { label: 'teléfono 844×390 ↔ 390×844 (shell en los dos: rotar no re-mueve nada)', a: { width: 844, height: 390, shell: true }, b: { width: 390, height: 844, shell: true } },
];

/* Se corre en la página: estado del shell + huella estructural del DOM. */
const PROBE = `(() => {
  const outline = (root) => {
    if (!root) return null;
    const walk = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.children.length ? '(' + Array.from(el.children).map(walk).join(',') + ')' : '');
    return walk(root);
  };
  /* los nodos que mete zd-pwa (banner / aviso de file://) se etiquetan 'zd-pwa' */
  const label = (e) => (e.className || '').indexOf('zd-pwa-') !== -1 ? 'zd-pwa'
    : (e.id || '.' + (e.className || '').trim().split(/\\s+/)[0]);
  const ids = (sel) => { const r = document.querySelector(sel); return r ? Array.from(r.children).map(label) : null; };
  const comments = (() => { let n = 0; const it = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT); while (it.nextNode()) if (it.currentNode.data === 'zd-m') n++; return n; })();
  const panes = {};
  document.querySelectorAll('#zd-sheet .zd-pane').forEach((p) => { panes[p.dataset.tab] = Array.from(p.children).map(label); });
  const active = !!(window.ZD && ZD.mobile && ZD.mobile.active);
  const stage = document.getElementById('zd-stage');
  return {
    active,
    htmlClass: document.documentElement.className.trim(),
    stageChildren: stage ? Array.from(stage.children).map(label) : null,
    stageFirst: stage && stage.firstElementChild ? label(stage.firstElementChild) : null,
    transport: ids('#zd-top .zd-ttr'),
    panes,
    placeholders: comments,
    wrapHasKeep: ${JSON.stringify(KEEP)}.map((id) => { const e = document.getElementById(id); return !!(e && e.closest('.wrap')); }),
    tagged: ${JSON.stringify(KEEP)}.map((id) => { const e = document.getElementById(id); return e ? e.__zdTestTag || null : 'FALTA'; }),
    bodyChildren: Array.from(document.body.children).map((e) => e.tagName.toLowerCase() + '/' + label(e)),
    fingerprint: [outline(document.getElementById('zd-top')), outline(document.getElementById('zd-stage')),
      outline(document.getElementById('zd-tabs')), outline(document.getElementById('zd-sheet')),
      outline(document.querySelector('.wrap'))].join('\\n'),
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.getAttribute('aria-label') || document.activeElement.tagName) : null,
    scrollY: Math.round(window.scrollY),
    selectedStep: typeof selectedStep === 'undefined' ? null : selectedStep,
  };
})()`;

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

async function openInstrument(viewport) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + INSTRUMENT, { waitUntil: 'load' });
  // marca los nodos que el shell mueve: si sobreviven la marca, no se clonaron
  await page.evaluate((keep) => keep.forEach((id, i) => { const e = document.getElementById(id); if (e) e.__zdTestTag = 'tag' + i; }), KEEP);
  return { ctx, page, errors };
}

function assertShellOn(s, where) {
  assert.equal(s.active, true, `${where}: ZD.mobile.active tiene que ser true`);
  assert.match(s.htmlClass, /\bzd-m\b/, `${where}: falta la clase zd-m en <html>`);
  const stage = (s.stageChildren || []).filter((x) => x !== 'zd-pwa');
  assert.deepEqual(stage, KEEP, `${where}: #zd-stage tiene que tener los nodos de keep`);
  for (const id of TRANSPORT) assert.ok(s.transport.includes(id), `${where}: ${id} tiene que estar en la barra superior`);
  for (const [tab, nodes] of Object.entries(PANE_NODES)) {
    for (const id of nodes) assert.ok((s.panes[tab] || []).includes(id), `${where}: ${id} tiene que estar en el pane ${tab}`);
  }
  assert.deepEqual(s.wrapHasKeep, KEEP.map(() => false), `${where}: los nodos de keep no pueden seguir dentro de .wrap`);
  assert.deepEqual(s.tagged, KEEP.map((_, i) => 'tag' + i), `${where}: los nodos movidos tienen que ser los mismos objetos (cableado de eventos)`);
  assert.ok(s.placeholders > 0, `${where}: tiene que haber placeholders <!--zd-m--> para poder volver`);
}
function assertShellOff(s, where) {
  assert.equal(s.active, false, `${where}: ZD.mobile.active tiene que ser false`);
  assert.doesNotMatch(s.htmlClass, /\bzd-m\b/, `${where}: sobró la clase zd-m en <html>`);
  assert.deepEqual((s.stageChildren || []).filter((x) => x !== 'zd-pwa'), [], `${where}: #zd-stage tiene que quedar vacío`);
  assert.deepEqual(s.wrapHasKeep, KEEP.map(() => true), `${where}: los nodos de keep tienen que volver a .wrap`);
  assert.deepEqual(s.tagged, KEEP.map((_, i) => 'tag' + i), `${where}: los nodos restaurados tienen que ser los mismos objetos`);
  assert.equal(s.placeholders, 0, `${where}: no puede quedar ningún placeholder <!--zd-m-->`);
}

for (const pair of PAIRS) {
  test(`zd-mobile v${VERSION} · ${CYCLES} ciclos · ${pair.label}`, async () => {
    // arranca en el tamaño con shell para que build() ya haya corrido: lo que se
    // mide es volver a entrar, no el primer armado
    const { ctx, page, errors } = await openInstrument(pair.a.shell ? pair.a : pair.b);
    try {
      const seen = { a: [], b: [] };
      for (let i = 1; i <= CYCLES; i++) {
        for (const key of ['a', 'b']) {
          const v = pair[key];
          await page.setViewportSize({ width: v.width, height: v.height });
          await page.waitForTimeout(90);
          const s = await page.evaluate(PROBE);
          seen[key].push(s);
          const where = `ciclo ${i} · ${v.width}×${v.height}`;
          if (v.shell) assertShellOn(s, where); else assertShellOff(s, where);
          if (i === 1) console.log(`  ${where} · shell=${s.active} · #zd-stage=[${s.stageChildren.join(', ')}] · placeholders=${s.placeholders}`);
        }
      }
      for (const key of ['a', 'b']) {
        const v = pair[key];
        for (let i = 1; i < CYCLES; i++) {
          assert.equal(seen[key][i].fingerprint, seen[key][0].fingerprint,
            `${v.width}×${v.height}: el DOM del ciclo ${i + 1} tiene que ser idéntico al del ciclo 1`);
          assert.deepEqual(seen[key][i].bodyChildren, seen[key][0].bodyChildren,
            `${v.width}×${v.height}: los hijos de <body> cambiaron entre ciclos (¿shell duplicado?)`);
        }
      }
      console.log(`  ${CYCLES} ciclos sin cambios en el DOM · errores de consola: ${errors.length}`);
      assert.deepEqual(errors, [], 'no puede haber errores de consola');
    } finally { await ctx.close(); }
  });
}

test(`zd-mobile v${VERSION} · el cableado de eventos sigue vivo después de volver a entrar`, async () => {
  const { ctx, page } = await openInstrument({ width: 390, height: 844 });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });  // sale
    await page.waitForTimeout(80);
    await page.setViewportSize({ width: 390, height: 844 });    // vuelve a entrar
    await page.waitForTimeout(120);
    const before = await page.evaluate('selectedStep');
    await page.click('#zd-stage #seqPanel .step[data-i="5"] .note', { timeout: 8000 });
    const after = await page.evaluate('selectedStep');
    console.log(`  click en el paso 6 dentro del shell: selectedStep ${before} → ${after}`);
    assert.equal(after, 5, 'el listener del paso tiene que seguir conectado después del ciclo');
  } finally { await ctx.close(); }
});

test(`zd-mobile v${VERSION} · el foco y el scroll sobreviven el ciclo`, async () => {
  const { ctx, page } = await openInstrument({ width: 1440, height: 900 });
  try {
    // El scroll se registra evento por evento junto al estado del shell: al
    // angostar el viewport el navegador reflowea ANTES de que corra el listener
    // de la media query y su scroll anchoring ya mueve la página (320 → ~417),
    // así que lo que el shell puede devolver es la última posición que tenía la
    // página justo antes de entrar, no la que pidió el test.
    await page.evaluate(() => {
      window.__scrollLog = [];
      addEventListener('scroll', () => window.__scrollLog.push({ y: Math.round(window.scrollY), active: !!(window.ZD && ZD.mobile && ZD.mobile.active) }), true);
      document.getElementById('playBtn').focus();
      window.scrollTo(0, 320);
    });
    const before = await page.evaluate(PROBE);
    assert.equal(before.focus, 'playBtn');
    assert.ok(before.scrollY > 0, 'la página tiene que estar scrolleada antes de entrar');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
    const inside = await page.evaluate(PROBE);
    assert.equal(inside.focus, 'playBtn', 'el foco tiene que seguir en #playBtn dentro del shell');
    assert.equal(inside.scrollY, 0, 'dentro del shell el body es overflow:hidden y el scroll queda en 0');
    const preEnter = await page.evaluate(() => {
      const off = window.__scrollLog.filter((r) => !r.active);
      return off.length ? off[off.length - 1].y : null;
    });
    assert.ok(preEnter > 0, 'tiene que haber una posición de scroll anterior a entrar al shell');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(140);
    const back = await page.evaluate(PROBE);
    console.log(`  foco ${before.focus} → ${inside.focus} → ${back.focus} · scrollY ${before.scrollY} → (reflow a 390px: ${preEnter}) → ${inside.scrollY} en el shell → ${back.scrollY} al salir`);
    assert.equal(back.focus, 'playBtn', 'el foco tiene que volver a #playBtn al salir del shell');
    assert.equal(back.scrollY, preEnter, 'el scroll tiene que volver a donde estaba justo antes de entrar al shell');
  } finally { await ctx.close(); }
});

test(`zd-mobile v${VERSION} · el banner de zd-pwa sigue siendo el primer hijo de #zd-stage`, async () => {
  const { ctx, page } = await openInstrument({ width: 390, height: 844 });
  try {
    // beforeinstallprompt sintético: alcanza para que zd-pwa arme el banner
    await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
    await page.waitForTimeout(80);
    let s = await page.evaluate(PROBE);
    assert.equal(s.stageFirst, 'zd-pwa', `el banner tiene que ser el primer hijo de #zd-stage, no ${s.stageFirst}`);
    console.log(`  antes del ciclo: #zd-stage=[${s.stageChildren.join(', ')}]`);

    for (let i = 1; i <= 3; i++) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(90);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(110);
      s = await page.evaluate(PROBE);
      assert.equal(s.stageFirst, 'zd-pwa', `ciclo ${i}: el banner tiene que seguir siendo el primer hijo de #zd-stage, no ${s.stageFirst}`);
      assert.deepEqual(s.stageChildren.filter((x) => x !== 'zd-pwa'), KEEP, `ciclo ${i}: el stage perdió los paneles`);
      assert.equal(s.stageChildren.filter((x) => x === 'zd-pwa').length, 1, `ciclo ${i}: tiene que haber un solo banner`);
    }
    console.log(`  después de 3 ciclos: #zd-stage=[${s.stageChildren.join(', ')}]`);
  } finally { await ctx.close(); }
});
