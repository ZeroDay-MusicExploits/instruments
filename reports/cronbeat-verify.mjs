#!/usr/bin/env node
// reports/cronbeat-verify.mjs
//
// Verificación completa de CronBeat-8:08 (sesión C de cronbeat), con el mismo
// alcance que tools/tests/acid-verify.test.mjs para el piloto: viewports de
// SPEC R1, banner de instalación con beforeinstallprompt sintético (R2),
// standalone, iframe, file:// y service worker (SPEC 3.2), autoguardado con
// samples y migración de la DB anterior (R3), export JSON/MIDI/WAV (R4), audio
// con wake lock y suspend/resume (R5), rotación de tablet 1180×820 ↔ 820×1180
// sonando, un hub C2 simulado y el diff del adaptador C2.
//
//   node reports/cronbeat-verify.mjs
//   node reports/cronbeat-verify.mjs --shots /tmp/cronbeat-shots   # guarda capturas
//
// Vive en reports/ (no en tools/) a propósito: es de esta sesión. Usa los
// helpers de tools/tests/lib/ sin modificarlos. Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';
import { parseSMF, analyzeNotes, defects } from '../tools/tests/lib/smf.mjs';

const FILE = 'descargables/CronBeat-808.html';
const URL_PATH = '/' + FILE;
const IFRAME_PATH = '/__cb-iframe.html';
const HUB_PATH = '/__cb-hub.html';
const argv = process.argv.slice(2);
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'manifests/cronbeat.webmanifest'), 'utf8'));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/* SPEC R1: 360×640 mínimo, 390×844, 430×932, iPad vertical 768×1024,
   landscape 844×390 y escritorio ≥1024. `shell` = lo que tiene que dar la
   media query `(pointer:coarse) and (max-width:1024px), (max-width:820px)`. */
const VIEWPORTS = [
  { width: 360, height: 640, touch: true, shell: true, label: '360×640 (mínimo)' },
  { width: 390, height: 844, touch: true, shell: true, label: '390×844' },
  { width: 430, height: 932, touch: true, shell: true, label: '430×932' },
  { width: 768, height: 1024, touch: true, shell: true, label: '768×1024 (iPad vertical)' },
  { width: 844, height: 390, touch: true, shell: true, label: '844×390 (landscape)' },
  { width: 1440, height: 900, touch: false, shell: false, label: '1440×900 (escritorio)' },
  { width: 1024, height: 768, touch: false, shell: false, label: '1024×768 (escritorio chico)' },
];

/* Hub C2 mínimo: lo que el adaptador usa de window.parent.C2. */
const HUB_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>hub</title>
<script>
window.__hub = { registered: 0, plays: 0, stops: 0, api: null };
window.C2 = {
  apiVersion: 1,
  ctx: new AudioContext(),
  registerInstrument(api){ __hub.registered++; __hub.api = api; const g = C2.ctx.createGain(); g.connect(C2.ctx.destination); return g; },
  transport: { bpm: 100, play(){ __hub.plays++; __hub.api.onTransport('play'); }, stop(){ __hub.stops++; __hub.api.onTransport('stop'); } }
};
</script></head><body style="margin:0"><iframe id="f" name="c2slot:cb-test" src="${URL_PATH}" style="width:100%;height:100vh;border:0" title="CronBeat"></iframe></body></html>`;

let srv, browser, strict;

test.before(async () => {
  srv = await serveRoot(ROOT, {
    [IFRAME_PATH]: { body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>iframe</title></head><body style="margin:0"><iframe id="f" src="${URL_PATH}" style="width:100%;height:100vh;border:0" title="CronBeat"></iframe></body></html>` },
    [HUB_PATH]: { body: HUB_HTML },
  });
  const { chromium } = await loadPlaywright();
  // casi todo corre con autoplay libre (el hub simulado necesita su contexto);
  // el test de audio usa `strict`, con la política por defecto: sin gesto no suena
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  strict = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (strict) await strict.close();
  if (srv) await srv.close();
});

async function open(viewport, opts = {}, b = browser) {
  const { init, touch = true, ...rest } = opts;
  const ctx = await b.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: touch, isMobile: touch, acceptDownloads: true, ...rest,
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right, visible: r.width > 0 && r.height > 0 };
}, sel);
const overlap = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
const shot = (page, name) => SHOTS ? page.screenshot({ path: join(SHOTS, name + '.png') }) : null;
/* beforeinstallprompt sintético con prompt()/userChoice propios (Chromium no lo
   dispara solo en una carga automatizada: ver docs/pwa.md). */
const fakeBIP = (page, outcome = 'dismissed') => page.evaluate((outcome) => {
  window.__prompts = window.__prompts || 0;
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompts++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome, platform: 'web' });
  window.dispatchEvent(e);
}, outcome);

// ───────────────────────────────── R1 · viewports ─────────────────────────────

for (const v of VIEWPORTS) {
  test(`CronBeat · ${v.label} · layout`, async () => {
    const { ctx, page, errors } = await open(v, { touch: v.touch });
    try {
      const s = await page.evaluate(() => ({
        shell: !!(window.ZD && ZD.mobile && ZD.mobile.active),
        scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
        tabs: Array.from(document.querySelectorAll('#zd-tabs button')).map((b) => b.textContent),
        stage: document.getElementById('zd-stage') ? Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean) : [],
        rotate: !!document.getElementById('zd-rotate'),
        viewport: (document.querySelector('meta[name=viewport]') || {}).content || '',
        canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
        manifest: (document.querySelector('link[rel=manifest]') || {}).getAttribute ? document.querySelector('link[rel=manifest]').getAttribute('href') : '',
        theme: (document.querySelector('meta[name=theme-color]') || {}).content || '',
        appTitle: (document.querySelector('meta[name=apple-mobile-web-app-title]') || {}).content || '',
      }));
      assert.equal(s.shell, v.shell, `${v.label}: el shell tiene que estar ${v.shell ? 'activo' : 'inactivo'}`);
      assert.ok(s.scrollW <= s.clientW + 1, `${v.label}: scroll horizontal (${s.scrollW} > ${s.clientW})`);
      assert.equal(s.rotate, false, 'no puede existir #zd-rotate (SPEC R1)');
      assert.ok(!/maximum-scale|user-scalable/.test(s.viewport), 'meta viewport con maximum-scale / user-scalable');
      assert.equal(s.canonical, 'https://zeroday-musicexploits.github.io/instruments/descargables/CronBeat-808.html');
      assert.equal(s.manifest, '../manifests/cronbeat.webmanifest');
      assert.equal(s.theme.toLowerCase(), MANIFEST.theme_color.toLowerCase(), 'theme-color tiene que coincidir con el manifest');
      assert.equal(s.appTitle, 'CronBeat');

      if (v.shell) {
        assert.deepEqual(s.tabs, ['PADS', 'SEQ', 'FX', 'SAMPLE', 'CANCIÓN']);
        assert.deepEqual(s.stage, ['seq', 'pads'], `${v.label}: el stage tiene que tener la pista elegida y los pads`);
        const m = await page.evaluate(() => {
          const r = (e) => e.getBoundingClientRect();
          const top = Array.from(document.querySelectorAll('#zd-top button,#zd-top a,#zd-top input,#zd-top select')).map(r).filter((x) => x.width && x.height);
          const steps = Array.from(document.querySelectorAll('#seq .track.sel .step')).map(r);
          const pads = Array.from(document.querySelectorAll('#pads .bigpad')).map(r);
          const tabs = document.getElementById('zd-tabs').getBoundingClientRect();
          const trk = Array.from(document.querySelectorAll('#trkBar button')).map(r);
          return {
            topMin: Math.min(...top.map((x) => Math.min(x.width, x.height))),
            steps: steps.length, stepW: Math.min(...steps.map((x) => x.width)), stepH: Math.min(...steps.map((x) => x.height)),
            pads: pads.length, padMin: Math.min(...pads.map((x) => Math.min(x.width, x.height))),
            lowest: Math.max(...pads.map((x) => x.bottom), ...steps.map((x) => x.bottom)), tabsTop: tabs.top,
            trkMin: Math.min(...trk.map((x) => Math.min(x.width, x.height))),
          };
        });
        assert.ok(m.topMin >= 44, `${v.label}: control de la barra superior de ${m.topMin} px`);
        assert.equal(m.steps, 16, 'la pista elegida tiene que mostrar 16 pasos');
        assert.ok(m.stepH >= 48 && m.stepW >= 38, `${v.label}: pasos de ${m.stepW.toFixed(1)}×${m.stepH.toFixed(1)} (SPEC R1: ≥38 de ancho si h≥48)`);
        assert.equal(m.pads, 16);
        assert.ok(m.padMin >= 44, `${v.label}: pad de ${m.padMin.toFixed(1)} px en el eje corto`);
        assert.ok(m.trkMin >= 44, `${v.label}: botón de la barra de pista de ${m.trkMin} px`);
        assert.ok(m.lowest <= m.tabsTop + 0.5, `${v.label}: pads o pasos debajo de las tabs (${m.lowest} > ${m.tabsTop})`);
        console.log(`  ${v.label} · shell · pasos ${m.stepW.toFixed(0)}×${m.stepH.toFixed(0)} · pad ≥${m.padMin.toFixed(0)} px · barra ≥${m.topMin} · sin scroll horizontal`);
      } else {
        console.log(`  ${v.label} · sin shell (layout de escritorio) · sin scroll horizontal`);
      }
      await shot(page, `layout-${v.width}x${v.height}`);
      assert.deepEqual(errors, [], `${v.label}: errores o warnings de consola`);
    } finally { await ctx.close(); }
  });
}

test('CronBeat · las 5 pestañas abren sin scroll horizontal y con targets ≥44 px (360×640)', async () => {
  const { ctx, page, errors } = await open({ width: 360, height: 640 });
  try {
    for (const id of ['pads', 'seq', 'fx', 'smp', 'song', '__menu']) {
      await page.evaluate((id) => ZD.mobile.open(id), id);
      await page.waitForTimeout(260);
      const r = await page.evaluate(() => {
        const body = document.querySelector('#zd-sheet .zd-sbody');
        const small = [];
        document.querySelectorAll('#zd-sheet .zd-pane.on button, #zd-sheet .zd-pane.on input, #zd-sheet .zd-pane.on select, #zd-sheet .zd-pane.on a').forEach((e) => {
          const b = e.getBoundingClientRect();
          // grilla de 8 (patrones A–H): SPEC R1 acepta 38–40 de ancho con alto ≥48
          const grid8 = e.classList.contains('patbtn') && b.width >= 38 && b.height >= 48;
          if (b.width && b.height && Math.min(b.width, b.height) < 44 && !grid8) small.push((e.id || e.className || e.tagName) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
        });
        return { sw: body.scrollWidth, cw: body.clientWidth, small };
      });
      assert.ok(r.sw <= r.cw + 1, `pestaña ${id}: scroll horizontal en el sheet (${r.sw} > ${r.cw})`);
      assert.deepEqual(r.small, [], `pestaña ${id}: targets <44 px`);
      await shot(page, `tab-${id}-360x640`);
      await page.evaluate(() => ZD.mobile.close());
      await page.waitForTimeout(200);
    }
    console.log('  PADS · SEQ · FX · SAMPLE · CANCIÓN · MENÚ: sin scroll horizontal, targets ≥44 px (patrones A–H 39×48, grilla de 8)');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · táctil: tocar un pad elige su pista, ◀ ▶ y ACENTO', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.tap('.bigpad[data-track="5"]');
    let s = await page.evaluate(() => ({ sel: selTrack, row: document.querySelector('#seq .track.sel').dataset.track, name: document.getElementById('trkName').textContent, pressed: document.querySelector('.bigpad[data-track="5"]').getAttribute('aria-pressed') }));
    assert.deepEqual(s, { sel: 5, row: '5', name: '06 · Hat abierto', pressed: 'true' });
    await page.tap('#trkNext'); await page.tap('#trkNext');
    assert.equal(await page.evaluate(() => selTrack), 7, '▶ avanza de pista');
    await page.tap('#accBtn');
    await page.tap('#seq .track.sel .step[data-step="2"]');
    await page.tap('#accBtn');
    await page.tap('#seq .track.sel .step[data-step="3"]');
    s = await page.evaluate(() => ({ v2: pattern[7][2], v3: pattern[7][3], aria: document.querySelector('#seq .track.sel .step[data-step="2"]').getAttribute('aria-label') }));
    assert.deepEqual(s, { v2: 2, v3: 1, aria: 'Clave · paso 3 · acento' });
    console.log('  pad → pista 6 · ▶▶ → pista 8 · ACENTO pone acento (2), sin ACENTO paso normal (1)');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── R2 · oferta de instalación ───────────────────

test('CronBeat · banner de instalación: no tapa transporte, pasos ni pads (360×640 y 390×844)', async () => {
  for (const v of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(v);
    try {
      await fakeBIP(page);
      await page.waitForTimeout(200);
      const banner = await rect(page, '.zd-pwa-banner');
      assert.ok(banner && banner.visible, `${v.width}×${v.height}: el banner tiene que estar visible`);
      const first = await page.evaluate(() => document.getElementById('zd-stage').firstElementChild.className);
      assert.match(first, /zd-pwa-banner/, 'el banner tiene que ser el primer hijo de #zd-stage');
      for (const sel of ['#run', '#rec', '#bpmBox', '#zd-tmenu', '#trkBar', '#seq', '#pads', '.bigpad[data-track="15"]']) {
        const r = await rect(page, sel);
        assert.ok(r && r.visible, `${v.width}×${v.height}: ${sel} tiene que seguir visible`);
        assert.ok(!overlap(banner, r), `${v.width}×${v.height}: el banner tapa ${sel}`);
      }
      const tabsTop = (await rect(page, '#zd-tabs')).y;
      const last = await rect(page, '.bigpad[data-track="15"]');
      const padMin = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('.bigpad')).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); })));
      assert.ok(last.bottom <= tabsTop + 0.5, 'el último pad no puede quedar debajo de las tabs');
      assert.ok(padMin >= 44, `con el banner los pads miden ${padMin.toFixed(1)} px`);
      const icon = await rect(page, '#zd-pwa-topbtn');
      assert.ok(icon && icon.w >= 44 && icon.h >= 44, 'el ↓ de la barra tiene que medir 44×44');
      await shot(page, `banner-${v.width}x${v.height}`);
      console.log(`  ${v.width}×${v.height} · banner ${Math.round(banner.h)} px arriba del stage · pads ≥${padMin.toFixed(0)} px · nada tapado`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('CronBeat · Instalar llama a prompt() una sola vez; "Ahora no" dura 14 días', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    // aceptado: prompt() una vez y el banner se va
    await fakeBIP(page, 'accepted');
    await page.waitForTimeout(150);
    await page.click('.zd-pwa-banner >> text=/Instalar/');
    await page.waitForTimeout(300);
    const acc = await page.evaluate(() => ({ prompts: window.__prompts, banner: !!document.querySelector('.zd-pwa-banner') }));
    assert.deepEqual(acc, { prompts: 1, banner: false }, 'Instalar aceptado: prompt() ×1 y sin banner');
    // rechazado: desde zd-pwa v3 cuenta como "Ahora no" (era el punto 3 de
    // reports/cronbeat-block-request.md): el banner se va, se guarda
    // zd:pwa:dismissed y no queda ningún botón para un segundo prompt()
    await page.reload(); await page.waitForTimeout(300);
    await fakeBIP(page, 'dismissed');
    await page.waitForTimeout(150);
    await page.click('.zd-pwa-banner >> text=/Instalar/');
    await page.waitForTimeout(300);
    const dis = await page.evaluate(() => ({ prompts: window.__prompts, banner: !!document.querySelector('.zd-pwa-banner'), key: localStorage.getItem('zd:pwa:dismissed') }));
    assert.equal(dis.prompts, 1, 'el mismo beforeinstallprompt no se puede usar dos veces');
    assert.equal(dis.banner, false, 'rechazado: el banner se va (zd-pwa v3)');
    assert.ok(dis.key && Math.abs(Date.now() - Number(dis.key)) < 60000, 'rechazado: guarda zd:pwa:dismissed, como "Ahora no"');

    // "Ahora no": no vuelve en la próxima carga
    await page.evaluate(() => localStorage.removeItem('zd:pwa:dismissed'));
    await page.reload(); await page.waitForTimeout(300);
    await fakeBIP(page);
    await page.waitForTimeout(150);
    await page.click('.zd-pwa-banner >> text=/Ahora no/i');
    await page.waitForTimeout(150);
    const key = await page.evaluate(() => localStorage.getItem('zd:pwa:dismissed'));
    assert.ok(key && Math.abs(Date.now() - Number(key)) < 60000, 'tiene que guardar zd:pwa:dismissed con la fecha');
    await page.reload(); await page.waitForTimeout(300);
    await fakeBIP(page);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ banner: !!document.querySelector('.zd-pwa-banner'), menuItem: !document.getElementById('zd-install-btn').hidden }));
    assert.equal(after.banner, false, 'descartado: el banner no puede volver');
    assert.equal(after.menuItem, true, 'el ítem del menú sigue disponible aunque se haya descartado el banner');
    // a los 15 días vuelve
    await page.evaluate(() => localStorage.setItem('zd:pwa:dismissed', String(Date.now() - 15 * 864e5)));
    await page.reload(); await page.waitForTimeout(300);
    await fakeBIP(page);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => !!document.querySelector('.zd-pwa-banner')), true, 'pasados 14 días el banner vuelve');
    console.log('  Instalar → prompt() ×1 (aceptado: sin banner; rechazado: sin banner y zd:pwa:dismissed, zd-pwa v3) · "Ahora no" → no vuelve; menú sigue; a los 15 días vuelve');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · standalone: sin banner, sin ↓ y sin ítem de instalar', async () => {
  const init = () => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
      : mm(q));
  };
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, { init });
  try {
    await fakeBIP(page);
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => ({ standalone: ZD.pwa.isStandalone(), banner: !!document.querySelector('.zd-pwa-banner'), icon: !!document.getElementById('zd-pwa-topbtn') && document.getElementById('zd-pwa-topbtn').getClientRects().length > 0, item: !document.getElementById('zd-install-btn').hidden }));
    assert.deepEqual(s, { standalone: true, banner: false, icon: false, item: false });
    console.log('  display-mode standalone · 0 banner · 0 ícono · ítem oculto');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────── SPEC 3.2 · file://, iframe, SW ───────────────────

test('CronBeat · file://: sin service worker, sin pedidos de red, solo el aviso local', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) requests.push(u); });
  try {
    await page.goto(pathToFileURL(join(ROOT, FILE)).href, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await fakeBIP(page);
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({
      protocol: location.protocol, active: ZD.pwa.active, registered: ZD.pwa.registered,
      local: !!document.querySelector('.zd-pwa-local'), banner: !!document.querySelector('.zd-pwa-banner'),
      openWeb: (() => { const a = document.querySelector('.zd-pwa-local a, .zd-pwa-local [href]'); return a ? a.getAttribute('href') : null; })(),
    }));
    assert.equal(s.protocol, 'file:');
    assert.equal(s.active, false);
    assert.equal(s.registered, false, 'no se registra el SW en file://');
    assert.equal(s.local, true, 'tiene que salir el aviso del archivo local');
    assert.equal(s.banner, false, 'en file:// no hay banner de instalar');
    assert.equal(s.openWeb, 'https://zeroday-musicexploits.github.io/instruments/descargables/CronBeat-808.html');
    assert.deepEqual(requests, [], `pedidos de red en file://: ${requests.join(', ')}`);
    await shot(page, 'file-390x844');
    console.log(`  file:// · SW no registrado · aviso local → ${s.openWeb} · 0 pedidos de red`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · hosted: el service worker se registra y zd-pwa queda activo', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.ZD && ZD.pwa && ZD.pwa.registered, null, { timeout: 15000 });
    const s = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return { manifest: ZD.pwa.manifest, scopes: regs.map((r) => r.scope), scripts: regs.map((r) => (r.active || r.installing || r.waiting).scriptURL) };
    });
    assert.match(s.manifest, /manifests\/cronbeat\.webmanifest$/);
    assert.equal(s.scopes.length, 1);
    assert.match(s.scripts[0], /\/sw\.js$/);
    console.log(`  hosted · SW ${s.scripts[0]} · scope ${s.scopes[0]} · manifest ${s.manifest}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · iframe: zd-pwa inerte, sin banner y sin errores', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  try {
    await page.goto(srv.origin + IFRAME_PATH, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const frame = page.frames().find((f) => f.url().includes('CronBeat-808.html'));
    await frame.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => Promise.resolve(); window.dispatchEvent(e); });
    await page.waitForTimeout(200);
    const s = await frame.evaluate(() => ({ top: window.top === window, active: ZD.pwa.active, registered: ZD.pwa.registered,
      banner: !!document.querySelector('.zd-pwa-banner, .zd-pwa-local'), css: !!document.getElementById('zd-pwa-css'), host: HOST !== null }));
    assert.deepEqual(s, { top: false, active: false, registered: false, banner: false, css: false, host: false });
    console.log('  iframe sin hub · ZD.pwa inerte (0 banner, 0 CSS) · 0 errores');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── R3 · autoguardado ────────────────────────────

/* WAV PCM 16-bit mono generado en la página: un sample de verdad, sin archivos. */
const LOAD_SAMPLE = async (page, track, name) => page.evaluate(async ({ track, name }) => {
  const sr = 22050, n = Math.floor(sr / 4), buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf); let o = 0;
  const S = (t) => { for (const c of t) dv.setUint8(o++, c.charCodeAt(0)); }, U32 = (v) => { dv.setUint32(o, v, true); o += 4; }, U16 = (v) => { dv.setUint16(o, v, true); o += 2; };
  S('RIFF'); U32(36 + n * 2); S('WAVE'); S('fmt '); U32(16); U16(1); U16(1); U32(sr); U32(sr * 2); U16(2); U16(16); S('data'); U32(n * 2);
  for (let i = 0; i < n; i++) { dv.setInt16(o, Math.round(Math.sin(i / 8) * 12000 * (1 - i / n)), true); o += 2; }
  loadSampleFile(track, new File([buf], name, { type: 'audio/wav' }));
  await new Promise((r) => setTimeout(r, 300));
}, { track, name });
const SNAP = () => JSON.stringify({ p0: patterns[0][3], p2: patterns[2][0], ap: activePattern, sw: swing, rev: reverb.level, drv: drive.character, tempo, mute: muted[5], vol: vol[1],
  song: song, loop: songLoop, smp: sampleRaw[3] && sampleRaw[3].name, len: sampleRaw[3] && sampleRaw[3].bytes.length, pitch: sampleEdit[3] && sampleEdit[3].pitch });

test('CronBeat · autoguardado con samples: tocar → recargar → mismo estado, sin arrancar audio', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, {}, strict);
  try {
    await page.tap('.bigpad[data-track="3"]');                     // gesto + elige la pista 4
    await LOAD_SAMPLE(page, 3, 'mi-golpe.wav');
    await page.evaluate(() => { sampleEdit[3].pitch = 5; applyEdit(); });
    for (const st of [1, 3, 5]) await page.tap(`#seq .track.sel .step[data-step="${st}"]`);
    await page.evaluate(() => { ZD.mobile.open('seq'); });
    await page.waitForTimeout(250);
    await page.tap('#patbtns .patbtn[data-pat="2"]');
    await page.evaluate(() => { toggleCell(0, 0, true); selectPattern(0);
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
      set('swing', 33); set('revLevel', 71); setTempo(97);
      document.querySelector('#drvChar [data-c="fuzz"]').click(); addBlock(); ZD.mobile.close(); });
    await page.evaluate(() => ZD.mobile.open('pads')); await page.waitForTimeout(250);
    await page.tap('.pmrow[data-track="5"] .pmm');
    await page.evaluate(() => { const v = document.querySelector('.pmrow[data-track="1"] .pmvol'); v.value = 40; v.dispatchEvent(new Event('input', { bubbles: true })); ZD.mobile.close(); });
    const before = await page.evaluate(SNAP);
    await page.waitForTimeout(1900);                               // debounce 1,5 s
    await page.reload(); await page.waitForTimeout(900);
    const after = await page.evaluate(SNAP);
    assert.equal(after, before, 'el estado restaurado tiene que ser idéntico');
    const meta = await page.evaluate(() => ({ ctx: ctx === null ? null : ctx.state, buf: !!sampleBuffers[3], at: decodedAt[3],
      toast: Array.from(document.querySelectorAll('.zd-toast')).map((e) => e.textContent).join('|'), label: document.querySelector('.bigpad[data-track="3"] .n').textContent }));
    assert.equal(meta.ctx, null, 'restaurar no puede crear ni arrancar el AudioContext');
    assert.equal(meta.buf, true, 'el sample tiene que estar decodificado (offline) antes del primer gesto');
    assert.match(meta.toast, /Sesión restaurada/);
    assert.match(meta.toast, /Empezar de cero/);
    assert.equal(meta.label, 'mi-golpe.wav');
    await page.tap('#trkPrev'); await page.waitForTimeout(500);
    const live = await page.evaluate(() => ({ state: ctx && ctx.state, sr: ctx && ctx.sampleRate, at: decodedAt[3] }));
    assert.equal(live.state, 'running');
    assert.equal(live.at, live.sr, 'tras el primer gesto el sample se re-decodifica a la frecuencia real');
    const env = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('zd-sessions'); q.onsuccess = () => { const g = q.result.transaction('sessions').objectStore('sessions').get('zd:cronbeat:session'); g.onsuccess = () => r({ app: g.result.app, version: g.result.version, savedAt: typeof g.result.savedAt, inner: g.result.data.app }); }; }));
    assert.deepEqual(env, { app: 'cronbeat-808', version: 4, savedAt: 'string', inner: 'caja-de-ritmos' });
    console.log(`  restaurado idéntico (patrones A y C, canción, FX, mezcla, sample + edición) · ctx=null al restaurar · ${meta.at} → ${live.at} Hz tras el gesto`);
    assert.deepEqual(errors, [], 'errores o warnings (incluye el de autoplay si se creara el contexto sin gesto)');
  } finally { await ctx.close(); }
});

test('CronBeat · migración sin pérdida desde caja-ritmos-db y "Empezar de cero"', async () => {
  const ctx = await strict.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  try {
    // la versión anterior guardaba buildProject() tal cual en caja-ritmos-db/projects/autosave
    await page.goto(srv.origin + '/robots.txt');
    await page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('caja-ritmos-db', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('projects');
      r.onsuccess = () => { const g = Array.from({ length: 16 }, () => new Array(16).fill(0)); g[0][0] = 2; g[0][8] = 1; g[4][2] = 1;
        const empty = () => Array.from({ length: 16 }, () => new Array(16).fill(0));
        const proj = { app: 'caja-de-ritmos', version: 4, tempo: 111, swing: 0.2, master: 0.7, activePattern: 1, songLoop: false,
          song: [{ pattern: 1, reps: 3 }], patterns: Array.from({ length: 8 }, (_, i) => (i === 1 ? g : empty())),
          fx: { reverb: { size: 1.2, decay: 2, level: 0.5 }, delay: { time: 0.3, feedback: 0.4, level: 0.2, tone: 3200 }, phaser: { rate: 0.4, depth: 500, feedback: 0.35, base: 800 }, drive: { character: 'fuzz', tone: 3000 } },
          tracks: Array.from({ length: 16 }, (_, i) => ({ vol: 0.85, pan: 0, mute: i === 2, solo: false, revSend: 0, dlySend: 0, driveMix: 0, phaserMix: 0, sample: null })) };
        const tx = r.result.transaction('projects', 'readwrite'); tx.objectStore('projects').put(proj, 'autosave'); tx.oncomplete = () => { r.result.close(); res(); }; };
      r.onerror = () => rej(r.error); }));
    await page.goto(srv.origin + URL_PATH); await page.waitForTimeout(900);
    const m = await page.evaluate(() => ({ tempo, swing, ap: activePattern, b0: patterns[1][0].join(''), mute2: muted[2], drive: drive.character, song: JSON.stringify(song), loop: songLoop,
      toast: Array.from(document.querySelectorAll('.zd-toast')).some((e) => /Sesión restaurada/.test(e.textContent)) }));
    assert.deepEqual(m, { tempo: 111, swing: 0.2, ap: 1, b0: '2000000010000000', mute2: true, drive: 'fuzz', song: '[{"pattern":1,"reps":3}]', loop: false, toast: true });
    const old = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('caja-ritmos-db'); q.onsuccess = () => { const g = q.result.transaction('projects').objectStore('projects').get('autosave'); g.onsuccess = () => { r(!!(g.result && g.result.tempo === 111)); q.result.close(); }; }; }));
    assert.equal(old, true, 'la DB anterior tiene que quedar intacta');
    const copied = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('zd-sessions'); q.onsuccess = () => { const g = q.result.transaction('sessions').objectStore('sessions').get('zd:cronbeat:session'); g.onsuccess = () => r(g.result && g.result.data.tempo); }; }));
    assert.equal(copied, 111, 'la sesión migrada tiene que quedar copiada en zd:cronbeat:session');

    // Empezar de cero desde el menú, con modal
    await page.evaluate(() => ZD.mobile.open('__menu')); await page.waitForTimeout(250);
    await page.locator('#zd-sheet .zd-mitem', { hasText: 'Empezar de cero' }).tap(); await page.waitForTimeout(300);
    const dlg = await page.evaluate(() => { const d = document.querySelector('.zd-dlg'); return d ? d.textContent : null; });
    assert.match(String(dlg), /EMPEZAR DE CERO/, 'tiene que abrir el modal de zd-ui (no confirm())');
    await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'BORRAR TODO' }).click()]);
    await page.waitForTimeout(800);
    const z = await page.evaluate(() => ({ tempo, ap: activePattern, toast: Array.from(document.querySelectorAll('.zd-toast')).some((e) => /restaurada/.test(e.textContent)) }));
    assert.deepEqual(z, { tempo: 128, ap: 0, toast: false }, 'después de "Empezar de cero" arranca limpio y sin toast');
    console.log('  caja-ritmos-db → zd:cronbeat:session sin pérdida (la anterior intacta) · "Empezar de cero" con modal → limpio');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── R4 · exportación ─────────────────────────────

test('CronBeat · export JSON / MIDI / WAV válidos y JSON de ida y vuelta', async () => {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, { touch: false });
  try {
    const dl = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) }; };
    const STAMP = /-\d{8}-\d{4}\./;
    await LOAD_SAMPLE(page, 2, 'clap-propio.wav');
    const j = await dl('#saveJson'); const env = JSON.parse(j.bytes.toString('utf8'));
    assert.match(j.name, /^cronbeat-\d{8}-\d{4}\.json$/);
    assert.equal(env.app, 'cronbeat-808'); assert.equal(env.version, 4); assert.ok(env.savedAt);
    assert.equal(env.data.app, 'caja-de-ritmos'); assert.equal(env.data.patterns.length, 8);
    assert.equal(env.data.tracks[2].sample.name, 'clap-propio.wav', 'el JSON lleva el sample');

    const m = await dl('#saveMidi'); const smf = parseSMF(m.bytes); const an = analyzeNotes(smf);
    assert.match(m.name, /^cronbeat-patron-a-\d{8}-\d{4}\.mid$/);
    assert.equal(smf.ppq, 96); assert.equal(Math.round(smf.tempoBpm), 128);
    assert.ok(an.notes.length > 0); assert.deepEqual(defects(an), [], 'MIDI con notas solapadas, colgadas o de largo 0');
    await page.click('#tabSong');
    const sm = await dl('#songMidi'); assert.match(sm.name, /^cronbeat-cancion-\d{8}-\d{4}\.mid$/); parseSMF(sm.bytes);

    const w = await dl('#saveWav'); const b = w.bytes;
    assert.match(w.name, /^cronbeat-patron-a-\d{8}-\d{4}\.wav$/);
    assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE');
    const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22), bits = b.readUInt16LE(34), data = b.readUInt32LE(40);
    assert.equal(ch, 2); assert.equal(bits, 16);
    assert.equal(sr, await page.evaluate(() => ctx.sampleRate), 'el WAV sale a la frecuencia real del contexto');
    assert.equal(data, b.length - 44);
    assert.equal(await page.evaluate(() => !!document.querySelector('#wavResult .zd-reccard audio')), true, 'tarjeta con reproductor');

    // ida y vuelta: cambiar todo y volver a abrir el JSON exportado
    await page.evaluate(() => { setTempo(150); for (let t = 0; t < 16; t++) patterns[0][t].fill(0); clearSample(2); renderAll(); });
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#openJson')]);
    await fc.setFiles({ name: j.name, mimeType: 'application/json', buffer: j.bytes });
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => ({ tempo, a0: patterns[0][0].join(''), smp: sampleRaw[2] && sampleRaw[2].name, buf: !!sampleBuffers[2] }));
    assert.deepEqual(back, { tempo: 128, a0: '2000001000100000', smp: 'clap-propio.wav', buf: true });
    // JSON de otro instrumento → modal de error
    const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#openJson')]);
    await fc2.setFiles({ name: 'acid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'acid-bass-303', version: 1, data: { params: {} } })) });
    await page.waitForTimeout(300);
    assert.match(String(await page.evaluate(() => (document.querySelector('.zd-dlg') || {}).textContent)), /otro instrumento/);
    await page.keyboard.press('Escape');
    // MIDI exportado → importar
    const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('#openJson')]);
    await fc3.setFiles({ name: m.name, mimeType: 'audio/midi', buffer: m.bytes });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => patterns[0][0].join('')), '2000001000100000', 'el MIDI exportado vuelve a entrar como patrón');
    console.log(`  ${j.name} · ${m.name} (${an.notes.length} notas, 0 defectos) · ${w.name} (${sr} Hz, 16-bit, estéreo, ${(data / (sr * 4)).toFixed(2)} s) · JSON ida y vuelta con sample · MIDI ida y vuelta`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · iOS (UA de iPhone): las tres descargas salen por Web Share con archivo', async () => {
  const init = () => { window.__shared = []; navigator.canShare = () => true; navigator.share = (d) => { window.__shared.push(d.files.map((f) => f.name + '|' + f.type)); return Promise.resolve(); }; };
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, { init, userAgent: IPHONE_UA });
  try {
    await page.evaluate(() => ZD.mobile.open('song')); await page.waitForTimeout(300);
    await page.tap('#saveJson'); await page.tap('#saveMidi'); await page.tap('#saveWav'); await page.waitForTimeout(1500);
    await page.tap('#wavResult .zd-reccard button.pri'); await page.waitForTimeout(300);
    const shared = await page.evaluate(() => window.__shared.map((x) => x[0]));
    assert.equal(shared.length, 3, `tienen que salir 3 shares, salieron ${shared.length}`);
    assert.match(shared[0], /^cronbeat-\d{8}-\d{4}\.json\|application\/json$/);
    assert.match(shared[1], /^cronbeat-patron-a-\d{8}-\d{4}\.mid\|audio\/midi$/);
    assert.match(shared[2], /^cronbeat-patron-a-\d{8}-\d{4}\.wav\|audio\/wav$/);
    console.log('  iOS: JSON y MIDI comparten en el gesto; el WAV, desde ↓ DESCARGAR WAV de la tarjeta (gesto nuevo)');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ──────────────────────────────── R5 · audio ──────────────────────────────────

test('CronBeat · audio: destrabe en el gesto, wake lock, suspend/resume', async () => {
  const init = () => {
    window.__wake = { req: 0, rel: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => { __wake.req++; const s = { released: false, addEventListener() {}, release() { __wake.rel++; s.released = true; return Promise.resolve(); } }; return Promise.resolve(s); } } });
  };
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, { init }, strict);
  try {
    assert.equal(await page.evaluate(() => ctx), null, 'sin gesto no hay AudioContext');
    await page.tap('#run');
    await page.waitForTimeout(600);
    const on = await page.evaluate(() => ({ state: ctx.state, playing: isPlaying, unlocked: ZD.audio.unlocked, wake: __wake.req, pressed: document.getElementById('run').getAttribute('aria-pressed'), step: current16th }));
    assert.equal(on.state, 'running'); assert.equal(on.playing, true); assert.equal(on.unlocked, true);
    assert.ok(on.wake >= 1, 'tiene que pedir el wake lock al sonar');
    assert.equal(on.pressed, 'true');
    await page.waitForTimeout(400);
    assert.notEqual(await page.evaluate(() => current16th), on.step, 'el secuenciador avanza');
    await page.evaluate(() => ctx.suspend()); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => !!document.querySelector('.zd-resume.on')), true, 'suspendido mientras suena: overlay "Tocá para reanudar"');
    await page.tap('.zd-resume'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => ctx.state), 'running');
    await page.evaluate(() => ctx.suspend()); await page.waitForTimeout(100);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => ctx.state), 'running', 'volver a la pestaña reanuda');
    await page.tap('#run'); await page.waitForTimeout(200);
    const off = await page.evaluate(() => ({ playing: isPlaying, rel: __wake.rel }));
    assert.equal(off.playing, false); assert.ok(off.rel >= 1, 'al parar suelta el wake lock');
    console.log(`  ${await page.evaluate(() => ctx.sampleRate)} Hz · latencyHint interactive · wake lock pedido ${on.wake}/soltado ${off.rel} · overlay al suspender · visibilitychange reanuda`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('CronBeat · rotación de tablet 1180×820 ↔ 820×1180 con el instrumento sonando', async () => {
  const { ctx, page, errors } = await open({ width: 1180, height: 820 });
  try {
    await page.click('#run');
    await page.waitForTimeout(500);
    const t0 = await page.evaluate(() => ctx.currentTime);
    const steps = new Set();
    for (let i = 1; i <= 4; i++) {
      for (const v of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
        await page.setViewportSize(v);
        await page.waitForTimeout(240);
        const s = await page.evaluate(() => ({
          shell: !!(ZD.mobile && ZD.mobile.active),
          stage: Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean),
          state: ctx.state, playing: isPlaying, step: current16th, runPressed: document.getElementById('run').getAttribute('aria-pressed'),
          runVisible: document.getElementById('run').getClientRects().length > 0,
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        }));
        steps.add(s.step);
        const where = `vuelta ${i} · ${v.width}×${v.height}`;
        assert.equal(s.state, 'running', `${where}: el audio no puede cortarse`);
        assert.equal(s.playing, true, `${where}: sigue en play`);
        assert.equal(s.runPressed, 'true');
        assert.equal(s.shell, v.width === 820);
        assert.ok(s.runVisible, `${where}: TOCAR visible`);
        assert.ok(s.sw <= s.cw + 1, `${where}: scroll horizontal`);
        assert.deepEqual(s.stage, s.shell ? ['seq', 'pads'] : [], `${where}: stage`);
      }
    }
    const t1 = await page.evaluate(() => ctx.currentTime);
    assert.ok(t1 > t0 && steps.size > 1, 'el reloj y el secuenciador tienen que haber avanzado');
    console.log(`  8 rotaciones sonando · ctx.currentTime ${t0.toFixed(2)} → ${t1.toFixed(2)} · pasos vistos ${[...steps].join(',')}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── extras (SPEC 3.4) ────────────────────────────

test('CronBeat · extras: deshacer/rehacer, velocidad por altura, note repeat y choke', async () => {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 }, { touch: false });
  try {
    // deshacer / rehacer
    const a0 = () => page.evaluate(() => patterns[0][0].join(''));
    const base = await a0();
    await page.click('.track[data-track="0"] .step[data-step="1"]');
    await page.click('#clear');
    await page.keyboard.press('Control+z'); const u1 = await a0();
    await page.keyboard.press('Control+z'); const u2 = await a0();
    await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+y'); const r2 = await a0();
    assert.equal(u2, base); assert.equal(u1, base.slice(0, 1) + '1' + base.slice(2)); assert.equal(r2, '0'.repeat(16));
    // espía sobre trigger(): velocidad y tiempos de lo que suena en vivo
    await page.click('#tabPads');
    await page.evaluate(() => { window.__hits = []; const o = window.trigger; window.trigger = function (A, E, track, time, vel) { if (A === AA) __hits.push({ track, time, vel }); return o.apply(this, arguments); }; });
    const box = await (await page.$('.bigpad[data-track="4"]')).boundingBox();
    await page.click('#velPos');
    for (const y of [3, box.height / 2, box.height - 3]) await page.mouse.click(box.x + box.width / 2, box.y + y);
    const vels = await page.evaluate(() => __hits.map((h) => +h.vel.toFixed(2)));
    assert.ok(vels[0] > 0.95 && vels[1] > 0.5 && vels[1] < 0.75 && vels[2] < 0.3, `velocidades ${vels}`);
    await page.click('#velPos');
    // note repeat 1/16 sin transporte: intervalo = un paso, se corta al soltar
    await page.click('#rptSeg [data-r="16"]');
    await page.evaluate(() => { __hits = []; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
    const n0 = await page.evaluate(() => __hits.length); await page.waitForTimeout(400);
    const rp = await page.evaluate(() => ({ n: __hits.length, gaps: __hits.slice(1).map((h, i) => h.time - __hits[i].time), spb: secondsPerStep(), live: repeats.size }));
    assert.ok(rp.n >= 4 && rp.n === n0 && rp.live === 0, `repeat: ${n0} golpes al soltar, ${rp.n} después`);
    assert.ok(rp.gaps.every((g) => Math.abs(g - rp.spb) < 0.002), 'cada repetición a un paso de 1/16: ' + JSON.stringify(rp.gaps.map((g) => +g.toFixed(4))) + ' spb ' + rp.spb);
    // con transporte + REC: graba en la grilla, sin golpes duplicados
    await page.evaluate(() => { for (let st = 0; st < 16; st++) pattern[4][st] = 0; renderAll(); __hits = []; });
    await page.click('#run'); await page.waitForTimeout(300); await page.click('#rec');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
    await page.waitForTimeout(2100);
    await page.click('#rec'); await page.click('#run');
    const rec = await page.evaluate(() => ({ on: pattern[4].filter(Boolean).length, times: __hits.filter((h) => h.track === 4).map((h) => h.time).sort((a, b) => a - b) }));
    const dup = rec.times.filter((t, i) => i && Math.abs(t - rec.times[i - 1]) < 0.005).length;
    assert.ok(rec.on >= 4, `REC + repeat tiene que grabar pasos (grabó ${rec.on})`);
    assert.equal(dup, 0, 'ningún paso puede sonar dos veces a la vez');
    await page.click('#rptSeg [data-r="0"]');
    // choke: corta la cola del hat abierto; se guarda con el proyecto
    const ch = await page.evaluate(async () => {
      async function tail(on) { chokeOn = on; const off = new OfflineAudioContext(2, 44100, 44100); const E = buildEngine(off); const A = { ac: off, noise: E.noise };
        E.revReturn.gain.value = 0; E.dlyReturn.gain.value = 0; trigger(A, E, 5, 0, 0.8); trigger(A, E, 4, 0.12, 0.8);
        const d = (await off.startRendering()).getChannelData(0); let s = 0; for (let i = Math.floor(0.2 * 44100); i < Math.floor(0.45 * 44100); i++) s += d[i] * d[i]; return Math.sqrt(s); }
      const sin = await tail(false), con = await tail(true); chokeOn = false;
      document.getElementById('chokeBtn').click(); const saved = buildProject().choke; document.getElementById('chokeBtn').click();
      return { sin, con, saved };
    });
    assert.ok(ch.sin > 1e-3 && ch.con < 1e-9, `choke: cola ${ch.sin} sin choke, ${ch.con} con choke`);
    assert.equal(ch.saved, true, 'el choke se guarda con el proyecto');
    console.log(`  deshacer/rehacer ok · velocidades ${vels.join('/')} · repeat ${rp.n} golpes a ${(rp.spb * 1000).toFixed(0)} ms y se corta al soltar · REC+repeat ${rec.on} pasos, 0 duplicados · choke corta la cola y se guarda`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────── C2 · hub simulado ──────────────────────────────

test('CronBeat · embebido en un hub C2: registra, sigue el reloj del hub y no autoguarda', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(srv.origin + HUB_PATH, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const frame = page.frames().find((f) => f.url().includes('CronBeat-808.html'));
    const hub = () => page.evaluate(() => ({ registered: __hub.registered, plays: __hub.plays, stops: __hub.stops }));
    let s = await frame.evaluate(() => ({ host: HOST !== null, slot: SLOT_ID, sameCtx: ctx === window.parent.C2.ctx, tempo, session: Session === null, title: document.title, state: api.getState().app }));
    assert.deepEqual(s, { host: true, slot: 'cb-test', sameCtx: true, tempo: 100, session: true, title: 'CronBeat-808 · C2', state: 'cronbeat-808' });
    assert.equal((await hub()).registered, 1);
    // TOCAR arranca el rig por el hub, no por un reloj propio
    await frame.click('#run');
    await page.waitForTimeout(200);
    const p = await frame.evaluate(() => ({ playing: isPlaying, timer: timerID }));
    assert.equal(p.playing, true); assert.equal(p.timer, null, 'embebido no puede correr el setTimeout propio');
    assert.equal((await hub()).plays, 1);
    // el hub avanza la caja con onTick (24 ticks = 1/16)
    const adv = await frame.evaluate(() => { const c = window.parent.C2.ctx; const s0 = current16th; for (let k = 0; k < 24 * 3; k++) api.onTick(k, c.currentTime + 0.05); return [s0, current16th]; });
    assert.equal((adv[1] - adv[0] + 16) % 16, 3, '72 ticks del hub = 3 pasos');
    await frame.click('#run');
    await page.waitForTimeout(200);
    assert.equal((await hub()).stops, 1);
    assert.equal(await frame.evaluate(() => isPlaying), false);
    // tocar cosas y esperar: con hub no se guarda sesión
    await frame.evaluate(() => { toggleCell(0, 1, false); setTempo(140); });
    await page.waitForTimeout(1900);
    const stored = await frame.evaluate(() => new Promise((r) => { const q = indexedDB.open('zd-sessions'); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains('sessions')) return r(null); const g = db.transaction('sessions').objectStore('sessions').get('zd:cronbeat:session'); g.onsuccess = () => r(g.result || null); }; q.onerror = () => r(null); }));
    assert.equal(stored, null, 'con hub no se escribe zd:cronbeat:session');
    s = await frame.evaluate(() => ({ unlocked: ZD.audio.unlocked, overlay: !!document.querySelector('.zd-resume'), pwa: ZD.pwa.active }));
    assert.deepEqual(s, { unlocked: false, overlay: false, pwa: false }, 'con hub zd-audio no toca el contexto del hub y zd-pwa queda inerte');
    console.log('  hub: registerInstrument ×1 · ctx del hub · tempo del hub (100) · play/stop por HOST.transport · 72 ticks = 3 pasos · sin autoguardado · zd-audio/zd-pwa inertes');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────── C2 · el adaptador no cambió ────────────────────────

test('CronBeat · adaptador C2 intacto (diff contra la base de la rama)', () => {
  const base = execSync('git merge-base HEAD main', { cwd: ROOT }).toString().trim();
  const before = execSync(`git show ${base}:${FILE}`, { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
  const now = readFileSync(join(ROOT, FILE), 'utf8');
  const adapter = (src) => { const a = src.indexOf('C2 · ADAPTADOR v1'); const b = src.indexOf('</script>', a); return src.slice(src.lastIndexOf('<script>', a), b); };
  assert.equal(adapter(now), adapter(before), 'el <script> del adaptador C2 (onTick/api/registro/zeroday_sync) tiene que ser idéntico');
  const block = (src, from, to) => { const a = src.indexOf(from); return src.slice(a, src.indexOf(to, a)); };
  for (const [from, to, what] of [
    ['const HOST = (() => {', 'let tempo = 128', 'HOST / SLOT_ID / C2_*'],
    ['  if(HOST){\n    if(eng) return;', '  if(ctx){', 'ensureAudio() con HOST'],
    ['function scheduler(){', 'function togglePlay', 'scheduler/start/stop'],
  ]) assert.equal(block(now, from, to), block(before, from, to), `cambió: ${what}`);
  // líneas del diff que mencionan el contrato C2: solo pueden ser agregados que LEEN HOST
  const diff = execSync(`git diff ${base} -- ${FILE}`, { cwd: ROOT, maxBuffer: 64 << 20 }).toString().split('\n')
    .filter((l) => /^[+-](?![+-])/.test(l) && /HOST|zeroday_sync|registerInstrument|transport\./.test(l) && !/ZD-BLOCK|^\+\s*(\/\*|\*|\/\/)/.test(l));
  const removed = diff.filter((l) => l.startsWith('-'));
  assert.deepEqual(removed, [], 'no se puede borrar ni cambiar ninguna línea del contrato C2');
  console.log(`  base ${base.slice(0, 7)} · adaptador, HOST, ensureAudio(HOST) y scheduler/start/stop idénticos · ${diff.length} líneas agregadas que leen HOST:`);
  for (const l of diff) console.log('    ' + l.trim().slice(0, 150));
});
