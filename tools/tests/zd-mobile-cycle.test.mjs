#!/usr/bin/env node
// tools/tests/zd-mobile-cycle.test.mjs
//
// Conformidad del bloque `zd-mobile` para CUALQUIER instrumento. No sabe nada de
// un instrumento en particular: el archivo entra por `--file` y las expectativas
// (qué nodos van a la barra, al stage y a cada pane) salen de leer el
// `window.ZD_M` de la propia página, igual que hace el bloque.
//
//   node tools/tests/zd-mobile-cycle.test.mjs
//   node tools/tests/zd-mobile-cycle.test.mjs --file descargables/Nebularp_2035.html
//   node tools/tests/zd-mobile-cycle.test.mjs --file descargables/J4-Sirens_Station.html --cycles 6
//
// Por defecto corre sobre el piloto, descargables/Acid_Bass-303.html.
//
// Qué exige:
//
// 1. El ciclo salir/entrar del shell es idempotente y reversible. Es el bug que
//    reportó la sesión C1 (reports/nebularp-block-request.md, punto 2): `enter()`
//    llamaba a `build()`, que corre una sola vez, y `moveNodes()` vivía adentro
//    de `build()`; al volver a entrar, #zd-stage, la barra y los sheets quedaban
//    vacíos. Pasa al cruzar los 820 px con una ventana de escritorio y al rotar
//    una tablet cuyo ancho cruza 1024 px (iPad Pro 12,9": 1024 vertical, 1366
//    horizontal). Arreglado en zd-mobile v3.
// 2. Los nodos movidos son los mismos objetos y los listeners enganchados antes
//    del ciclo siguen disparando después.
// 3. El foco y el scroll de la página sobreviven el ciclo.
// 4. El banner de `zd-pwa` sigue siendo el primer hijo de #zd-stage.
// 5. Los controles de la barra superior miden ≥44 px en el eje corto (SPEC R1,
//    piso que pone zd-mobile v4). Este es el chequeo que más se le escapa a un
//    instrumento: si su `zd-mobile-skin` fija un `min-height` menor con más
//    especificidad, gana el skin. Ver docs/zd-blocks.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { readBlock } from './lib/load-block.mjs';

// ───────────────────────────────── argumentos ─────────────────────────────────

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('uso: node tools/tests/zd-mobile-cycle.test.mjs [--file descargables/X.html] [--cycles N]');
  process.exit(0);
}

const FILE = argOf('--file', 'descargables/Acid_Bass-303.html').replace(/^\/+/, '');
const INSTRUMENT = '/' + FILE;
const CYCLES = Math.max(2, parseInt(argOf('--cycles', '4'), 10) || 4);
const VERSION = readBlock('zd-mobile').version;

/* Pares de viewport. `shell` dice si en ese tamaño el shell tiene que estar
   activo: la media query es
   `(pointer:coarse) and (max-width:1024px), (max-width:820px)`, y no menciona la
   orientación, así que es la misma para los 5 instrumentos. */
const PAIRS = [
  { label: 'tablet 1180×820 (sin shell) ↔ 820×1180 (shell)', a: { width: 1180, height: 820, shell: false }, b: { width: 820, height: 1180, shell: true } },
  { label: 'escritorio 1440×900 (sin shell) ↔ teléfono 390×844 (shell)', a: { width: 1440, height: 900, shell: false }, b: { width: 390, height: 844, shell: true } },
  { label: 'teléfono 844×390 ↔ 390×844 (shell en los dos: rotar no re-mueve nada)', a: { width: 844, height: 390, shell: true }, b: { width: 390, height: 844, shell: true } },
];
const SHELL_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// ───────────────────────────── código de la página ────────────────────────────

/* Etiqueta de un nodo, igual para la config y para el DOM: los nodos que mete
   zd-pwa (banner / aviso de file://) se colapsan a 'zd-pwa' porque van y vienen
   solos. Se inyecta en los dos scripts de abajo. */
const LABEL_FN = `const label = (e) => (e.className || '').indexOf('zd-pwa-') !== -1 ? 'zd-pwa'
    : (e.id || '.' + (e.className || '').trim().split(/\\s+/)[0]);`;

/* Resuelve window.ZD_M a las etiquetas que tiene que producir el DOM. Resuelve
   los selectores igual que `all()` del bloque (querySelectorAll, en el orden de
   la lista), así que da lo mismo dónde estén los nodos en este momento. */
const CONFIG_PROBE = `(() => {
  ${LABEL_FN}
  const C = window.ZD_M || {};
  const resolve = (list) => {
    const out = [];
    (list || []).forEach((sel) => {
      if (typeof sel !== 'string') return;      // funciones y nodos sueltos: no se predicen
      try { document.querySelectorAll(sel).forEach((n) => out.push(label(n))); } catch (e) {}
    });
    return out;
  };
  return {
    name: C.name || document.title,
    keep: resolve(C.keep),
    transport: resolve(C.transport),
    tabs: (C.tabs || []).slice(0, 5).map((t) => ({ id: t.id, label: t.label, nodes: resolve(t.nodes) })),
    dynamic: [].concat(C.keep || [], C.transport || [], ...(C.tabs || []).map((t) => t.nodes || []))
      .some((sel) => typeof sel !== 'string'),
  };
})()`;

/* Estado del shell + huella estructural del DOM. */
const PROBE = `(() => {
  ${LABEL_FN}
  const outline = (root) => {
    if (!root) return null;
    const walk = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.children.length ? '(' + Array.from(el.children).map(walk).join(',') + ')' : '');
    return walk(root);
  };
  const ids = (sel) => { const r = document.querySelector(sel); return r ? Array.from(r.children).map(label) : null; };
  const comments = (() => { let n = 0; const it = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT); while (it.nextNode()) if (it.currentNode.data === 'zd-m') n++; return n; })();
  const panes = {};
  document.querySelectorAll('#zd-sheet .zd-pane').forEach((p) => { panes[p.dataset.tab] = Array.from(p.children).map(label); });
  const stage = document.getElementById('zd-stage');
  /* mapa y no lista: querySelectorAll devuelve orden de documento, que no es el
     orden de ZD_M.keep, y acá lo que importa es la identidad de cada nodo */
  const tagged = {}, inWrap = {};
  document.querySelectorAll('[data-zd-test^="keep"]').forEach((e) => {
    const k = e.getAttribute('data-zd-test');
    tagged[k] = e.__zdTestTag || 'SIN-MARCA';
    inWrap[k] = !!e.closest('.wrap');
  });
  return {
    active: !!(window.ZD && ZD.mobile && ZD.mobile.active),
    htmlClass: document.documentElement.className.trim(),
    stageChildren: stage ? Array.from(stage.children).map(label) : null,
    stageFirst: stage && stage.firstElementChild ? label(stage.firstElementChild) : null,
    transport: ids('#zd-top .zd-ttr'),
    panes,
    placeholders: comments,
    inWrap,
    tagged,
    bodyChildren: Array.from(document.body.children).map((e) => e.tagName.toLowerCase() + '/' + label(e)),
    fingerprint: [outline(document.getElementById('zd-top')), outline(document.getElementById('zd-stage')),
      outline(document.getElementById('zd-tabs')), outline(document.getElementById('zd-sheet')),
      outline(document.querySelector('.wrap'))].join('\\n'),
    focus: document.activeElement
      ? (document.activeElement.getAttribute && document.activeElement.getAttribute('data-zd-test')) ||
        document.activeElement.id || document.activeElement.tagName
      : null,
    scrollY: Math.round(window.scrollY),
    clicks: window.__zdClicks || 0,
  };
})()`;

/* SPEC R1: todo control de la barra superior, ≥44 px en el eje corto. Recorre el
   DOM, no una lista de selectores, así que vale para cualquier instrumento. */
const TOPBAR_PROBE = `(() => {
  const top = document.getElementById('zd-top');
  if (!top) return null;
  return Array.from(top.querySelectorAll('button,a,input,select')).map((e) => {
    const r = e.getBoundingClientRect();
    return { id: e.id || '.' + (e.className || '').trim().split(/\\s+/)[0] || e.tagName, w: Math.round(r.width), h: Math.round(r.height) };
  }).filter((c) => c.w > 0 && c.h > 0);
})()`;

// ───────────────────────────────── andamiaje ──────────────────────────────────

let srv, browser, CFG = null;

test.before(async () => {
  srv = await serveRoot();
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();

  // lee la config del instrumento una vez, con el shell activo
  const ctx = await browser.newContext({ viewport: SHELL_VIEWPORT, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const res = await page.goto(srv.origin + INSTRUMENT, { waitUntil: 'load' });
  assert.ok(res && res.ok(), `no pude abrir ${FILE} (${res && res.status()})`);
  CFG = await page.evaluate(CONFIG_PROBE);
  await ctx.close();

  assert.ok(CFG.keep.length, `${FILE}: window.ZD_M.keep no resolvió ningún nodo — ¿el instrumento tiene el bloque pegado?`);
  console.log(`\n  ${FILE} · ZD_M "${CFG.name}" · zd-mobile v${VERSION} · ${CYCLES} ciclos`);
  console.log(`  keep=[${CFG.keep.join(', ')}] transport=[${CFG.transport.join(', ')}]`);
  for (const t of CFG.tabs) console.log(`  tab ${t.id} (${t.label}) = [${t.nodes.join(', ')}]`);
  if (CFG.dynamic) console.log('  (ojo: ZD_M trae selectores que no son strings; esos no se predicen)');
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
  /* Marca los nodos de `keep` con un atributo (para encontrarlos sin saber sus
     ids) y con una propiedad del objeto DOM (si sobrevive, no se clonaron). */
  await page.evaluate((keepSel) => {
    window.__zdClicks = 0;
    let i = 0;
    (keepSel || []).forEach((sel) => {
      if (typeof sel !== 'string') return;
      document.querySelectorAll(sel).forEach((n) => {
        n.setAttribute('data-zd-test', 'keep' + i);
        n.__zdTestTag = 'tag' + i;
        i++;
      });
    });
  }, await page.evaluate(() => (window.ZD_M || {}).keep || []));
  return { ctx, page, errors };
}

const keepTags = () => Object.fromEntries(CFG.keep.map((_, i) => [`keep${i}`, `tag${i}`]));
const keepInWrap = (v) => Object.fromEntries(CFG.keep.map((_, i) => [`keep${i}`, v]));

function assertShellOn(s, where) {
  assert.equal(s.active, true, `${where}: ZD.mobile.active tiene que ser true`);
  assert.match(s.htmlClass, /\bzd-m\b/, `${where}: falta la clase zd-m en <html>`);
  assert.deepEqual((s.stageChildren || []).filter((x) => x !== 'zd-pwa'), CFG.keep,
    `${where}: #zd-stage tiene que tener exactamente los nodos de ZD_M.keep`);
  assert.deepEqual(s.transport, CFG.transport,
    `${where}: la barra superior tiene que tener exactamente los nodos de ZD_M.transport`);
  for (const t of CFG.tabs) {
    assert.deepEqual(s.panes[t.id] || [], t.nodes, `${where}: el pane ${t.id} tiene que tener los nodos de ZD_M.tabs`);
  }
  assert.deepEqual(s.inWrap, keepInWrap(false), `${where}: los nodos de keep no pueden seguir dentro de .wrap`);
  assert.deepEqual(s.tagged, keepTags(), `${where}: los nodos movidos tienen que ser los mismos objetos (cableado de eventos)`);
  assert.ok(s.placeholders > 0, `${where}: tiene que haber placeholders <!--zd-m--> para poder volver`);
}
function assertShellOff(s, where) {
  assert.equal(s.active, false, `${where}: ZD.mobile.active tiene que ser false`);
  assert.doesNotMatch(s.htmlClass, /\bzd-m\b/, `${where}: sobró la clase zd-m en <html>`);
  assert.deepEqual((s.stageChildren || []).filter((x) => x !== 'zd-pwa'), [], `${where}: #zd-stage tiene que quedar vacío`);
  assert.deepEqual(s.transport || [], [], `${where}: la barra superior tiene que quedar vacía`);
  for (const t of CFG.tabs) assert.deepEqual(s.panes[t.id] || [], [], `${where}: el pane ${t.id} tiene que quedar vacío`);
  assert.deepEqual(s.inWrap, keepInWrap(true), `${where}: los nodos de keep tienen que volver a .wrap`);
  assert.deepEqual(s.tagged, keepTags(), `${where}: los nodos restaurados tienen que ser los mismos objetos`);
  assert.equal(s.placeholders, 0, `${where}: no puede quedar ningún placeholder <!--zd-m-->`);
}

// ─────────────────────────────────── casos ────────────────────────────────────

for (const pair of PAIRS) {
  test(`zd-mobile v${VERSION} · ${FILE} · ${CYCLES} ciclos · ${pair.label}`, async () => {
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

test(`zd-mobile v${VERSION} · ${FILE} · el cableado de eventos sigue vivo después de volver a entrar`, async () => {
  const { ctx, page } = await openInstrument(SHELL_VIEWPORT);
  try {
    // listener propio sobre el primer nodo de keep, enganchado ANTES del ciclo
    await page.evaluate(() => {
      window.__zdClicks = 0;
      document.querySelector('[data-zd-test="keep0"]').addEventListener('click', () => { window.__zdClicks++; });
    });
    await page.setViewportSize(DESKTOP_VIEWPORT);   // sale
    await page.waitForTimeout(90);
    await page.setViewportSize(SHELL_VIEWPORT);     // vuelve a entrar
    await page.waitForTimeout(120);

    const inside = await page.evaluate(PROBE);
    assertShellOn(inside, 'después de volver a entrar');
    await page.evaluate(() => document.querySelector('#zd-stage [data-zd-test="keep0"]').click());
    const after = await page.evaluate(PROBE);
    console.log(`  listener sobre ${CFG.keep[0]}, enganchado antes del ciclo: ${after.clicks} click(s) después de volver a entrar`);
    assert.equal(after.clicks, 1, 'el listener enganchado antes del ciclo tiene que seguir disparando');
  } finally { await ctx.close(); }
});

test(`zd-mobile v${VERSION} · ${FILE} · el foco y el scroll sobreviven el ciclo`, async () => {
  const { ctx, page } = await openInstrument(DESKTOP_VIEWPORT);
  try {
    // El scroll se registra evento por evento junto al estado del shell: al
    // angostar el viewport el navegador reflowea ANTES de que corra el listener
    // de la media query y su scroll anchoring ya mueve la página, así que lo que
    // el shell puede devolver es la última posición que tenía la página justo
    // antes de entrar, no la que pidió el test.
    // Se enfoca el propio nodo de keep0 (con tabindex=-1), no un descendiente:
    // es el nodo que el shell mueve, y además no se lo lleva puesto un re-render
    // del instrumento (en Acid, renderSeq() rehace los botones de los pasos).
    const focusId = await page.evaluate(() => {
      const host = document.querySelector('[data-zd-test="keep0"]');
      host.setAttribute('tabindex', '-1');
      host.focus();
      window.__scrollLog = [];
      addEventListener('scroll', () => window.__scrollLog.push({ y: Math.round(window.scrollY), active: !!(window.ZD && ZD.mobile && ZD.mobile.active) }), true);
      window.scrollTo(0, 320);
      return host.tagName.toLowerCase() + (host.id ? '#' + host.id : '');
    });
    const before = await page.evaluate(PROBE);
    assert.equal(before.focus, 'keep0', `el foco tiene que arrancar en ${focusId}`);
    assert.ok(before.scrollY > 0, 'la página tiene que estar scrolleada antes de entrar');

    await page.setViewportSize(SHELL_VIEWPORT);
    await page.waitForTimeout(120);
    const inside = await page.evaluate(PROBE);
    assert.equal(inside.focus, 'keep0', 'el foco tiene que sobrevivir el movimiento de nodos al entrar');
    assert.equal(inside.scrollY, 0, 'dentro del shell el body es overflow:hidden y el scroll queda en 0');
    const preEnter = await page.evaluate(() => {
      const off = window.__scrollLog.filter((r) => !r.active);
      return off.length ? off[off.length - 1].y : null;
    });
    assert.ok(preEnter > 0, 'tiene que haber una posición de scroll anterior a entrar al shell');

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.waitForTimeout(140);
    const back = await page.evaluate(PROBE);
    console.log(`  foco en ${focusId}: ${before.focus} → ${inside.focus} → ${back.focus} · scrollY ${before.scrollY} → (reflow: ${preEnter}) → ${inside.scrollY} en el shell → ${back.scrollY} al salir`);
    assert.equal(back.focus, 'keep0', 'el foco tiene que volver al mismo nodo al salir del shell');
    assert.equal(back.scrollY, preEnter, 'el scroll tiene que volver a donde estaba justo antes de entrar al shell');
  } finally { await ctx.close(); }
});

test(`zd-mobile v${VERSION} · ${FILE} · el banner de zd-pwa sigue siendo el primer hijo de #zd-stage`, async () => {
  const { ctx, page } = await openInstrument(SHELL_VIEWPORT);
  try {
    // beforeinstallprompt sintético: alcanza para que zd-pwa arme el banner
    await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
    await page.waitForTimeout(90);
    let s = await page.evaluate(PROBE);
    assert.equal(s.stageFirst, 'zd-pwa', `el banner tiene que ser el primer hijo de #zd-stage, no ${s.stageFirst}`);
    console.log(`  antes del ciclo: #zd-stage=[${s.stageChildren.join(', ')}]`);

    for (let i = 1; i <= 3; i++) {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.waitForTimeout(90);
      await page.setViewportSize(SHELL_VIEWPORT);
      await page.waitForTimeout(110);
      s = await page.evaluate(PROBE);
      assert.equal(s.stageFirst, 'zd-pwa', `ciclo ${i}: el banner tiene que seguir siendo el primer hijo de #zd-stage, no ${s.stageFirst}`);
      assert.deepEqual(s.stageChildren.filter((x) => x !== 'zd-pwa'), CFG.keep, `ciclo ${i}: el stage perdió los paneles`);
      assert.equal(s.stageChildren.filter((x) => x === 'zd-pwa').length, 1, `ciclo ${i}: tiene que haber un solo banner`);
    }
    console.log(`  después de 3 ciclos: #zd-stage=[${s.stageChildren.join(', ')}]`);
  } finally { await ctx.close(); }
});

test(`zd-mobile v${VERSION} · ${FILE} · los controles de la barra superior miden ≥44 px (SPEC R1)`, async () => {
  for (const v of PAIRS.flatMap((p) => [p.a, p.b]).filter((v) => v.shell)) {
    const { ctx, page } = await openInstrument(v);
    try {
      // con el ícono de instalar presente: es otro control de la barra
      await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
      await page.waitForTimeout(120);
      const controls = await page.evaluate(TOPBAR_PROBE);
      assert.ok(controls && controls.length, `${v.width}×${v.height}: no encontré controles en #zd-top`);
      const small = controls.filter((c) => Math.min(c.w, c.h) < 44);
      console.log(`  ${v.width}×${v.height} · ${controls.map((c) => `${c.id} ${c.w}×${c.h}`).join(' · ')}`);
      assert.deepEqual(small, [], `${v.width}×${v.height}: controles por debajo de 44 px en el eje corto`);
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      assert.ok(noScroll, `${v.width}×${v.height}: la barra no puede generar scroll horizontal`);
    } finally { await ctx.close(); }
  }
});
