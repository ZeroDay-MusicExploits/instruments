#!/usr/bin/env node
// tools/tests/monomoon-verify.test.mjs
//
// Verificación completa de MONOMOON'70 (sesión C, rama c-monomoon). Copia
// adaptada de tools/tests/acid-verify.test.mjs. Promovida desde reports/ a
// tools/tests/ por la sesión de integración (D).
//
//   node tools/tests/monomoon-verify.test.mjs
//
// Cubre: viewports de SPEC R1 (y el toque: glissando entre las dos filas,
// multitáctil, ruedas, macros, doble tap, long-press), banner de instalación
// (R2), autoguardado y migración de la DB 'hackwave-minimoog' (R3), JSON / MIDI /
// WAV (R4, incluido el tope de 10 min de REC), audio con suspend/resume y el
// LED de clip (R5), accesibilidad y diálogos (R6), rotación de tablet
// 1180×820 ↔ 820×1180 con una nota sonando, file://, iframe, service worker,
// un hub C2 falso y que el adaptador C2 no cambió (git diff filtrado).
//
// Necesita Playwright + Chromium (no es dependencia del runtime):
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';
import { parseSMF, analyzeNotes, defects } from './lib/smf.mjs';

const FILE = 'descargables/MonoMoon70.html';
const URL_PATH = '/' + FILE;
const IFRAME_PATH = '/__test-iframe.html';
const HUB_PATH = '/__test-c2hub.html';
const BASE = '8bef265';   // main al arrancar la sesión (antes de tocar MonoMoon)
const TMP = mkdtempSync(join(tmpdir(), 'monomoon-verify-'));

const VIEWPORTS = [
  { width: 360, height: 640, shell: true, touch: true, label: '360×640 (mínimo)' },
  { width: 390, height: 844, shell: true, touch: true, label: '390×844' },
  { width: 430, height: 932, shell: true, touch: true, label: '430×932' },
  { width: 768, height: 1024, shell: true, touch: true, label: '768×1024 (iPad vertical)' },
  { width: 844, height: 390, shell: true, touch: true, label: '844×390 (landscape)' },
  { width: 1440, height: 900, shell: false, touch: false, label: '1440×900 (escritorio)' },
];
const KEEP = ['macroPanel', 'xyPanel', 'kbPanel'];

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, {
    [IFRAME_PATH]: { body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>iframe</title></head>
<body style="margin:0"><iframe id="f" src="${URL_PATH}" style="width:360px;height:640px;border:0" title="MonoMoon"></iframe></body></html>` },
    // hub C2 falso, del mismo origen: lo justo para que el adaptador registre y reciba MIDI
    [HUB_PATH]: { body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>hub</title>
<script>window.C2={ apiVersion:1, ctx:new AudioContext({latencyHint:'interactive'}), transport:{bpm:120}, regs:[],
  registerInstrument(api){ this.regs.push(api); const g=this.ctx.createGain(); g.connect(this.ctx.destination); return g; } };</script></head>
<body style="margin:0"><iframe name="c2slot:slotA" src="${URL_PATH}" style="width:400px;height:700px;border:0" title="slot"></iframe></body></html>` },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
  rmSync(TMP, { recursive: true, force: true });
});

/* cuenta AudioContexts y guarda las opciones con que se crearon */
const COUNT_AC = () => {
  window.__acs = [];
  const W = window.AudioContext;
  if (W) window.AudioContext = class extends W { constructor(o) { super(o); window.__acs.push(o || null); } };
};
async function open(v, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: v.touch !== false, isMobile: v.touch !== false, acceptDownloads: true, ...opts });
  await ctx.addInitScript(COUNT_AC);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('dialog', (d) => { errors.push('diálogo nativo: ' + d.message()); d.dismiss(); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const power = async (page, touch = true) => { if (touch) await page.tap('#powerOvl'); else await page.click('#powerOvl'); await page.waitForTimeout(600); };
const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return null;
  const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
}, sel);
const overlap = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
const BIP = `(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); window.__prompts = window.__prompts || 0;
  e.prompt = () => { window.__prompts++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
  window.dispatchEvent(e); })()`;
const toasts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.zd-toast .zd-tmsg')).map((t) => t.textContent));

// ────────────────────────────── R1 · viewports ───────────────────────────────

for (const v of VIEWPORTS) {
  test(`MonoMoon · R1 · ${v.label}`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      const pre = await page.evaluate(() => ({ acs: window.__acs.length, rotate: !!document.getElementById('zd-rotate'),
        viewport: document.querySelector('meta[name=viewport]').content }));
      assert.equal(pre.acs, 0, 'no puede haber AudioContext antes del primer gesto');
      assert.equal(pre.rotate, false, 'no puede haber #zd-rotate');
      assert.doesNotMatch(pre.viewport, /maximum-scale|user-scalable/, 'viewport sin maximum-scale ni user-scalable');
      await power(page, v.touch);
      const s = await page.evaluate(() => {
        const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        const small = Array.from(document.querySelectorAll('body *')).filter((e) => {
          if (!Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
          const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && parseFloat(getComputedStyle(e).fontSize) < 11;
        }).map((e) => (e.id || e.className) + ' ' + getComputedStyle(e).fontSize);
        const top = document.getElementById('zd-top');
        return {
          shell: !!(ZD.mobile && ZD.mobile.active),
          stage: document.getElementById('zd-stage') ? Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean) : [],
          hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          white: r(document.querySelector('.key.white')), wheel: r(document.getElementById('pitchWheel')),
          xy: r(document.getElementById('xypad')), macro: r(document.getElementById('m_cutoff')),
          topSmall: top ? Array.from(top.querySelectorAll('button,a,input,select')).filter((e) => { const b = e.getBoundingClientRect(); return b.width && Math.min(b.width, b.height) < 44; }).map((e) => e.id || e.className) : [],
          small, ctx: engine.ctx.state, keysOnScreen: Array.from(document.querySelectorAll('.key')).every((k) => { const b = k.getBoundingClientRect(); return b.bottom <= innerHeight + 1 || !ZD.mobile.active; }),
        };
      });
      assert.equal(s.shell, v.shell, 'shell activo según la media query del bloque');
      if (v.shell) assert.deepEqual(s.stage, KEEP, 'zona de tocar: macros, pad XY y teclado');
      assert.equal(s.hscroll, false, 'sin scroll horizontal');
      assert.deepEqual(s.small, [], 'ningún texto por debajo de 11 px');
      assert.deepEqual(s.topSmall, [], 'controles de la barra superior ≥44 px');
      assert.equal(s.ctx, 'running');
      assert.ok(s.keysOnScreen, 'las teclas entran en la pantalla');
      assert.ok(s.white[0] >= 37 && s.white[1] >= 80, `blancas ${s.white.join('×')}`);
      assert.ok(s.xy[1] >= 60, `pad XY ${s.xy.join('×')}`);
      console.log(`  ${v.label}: shell=${s.shell} · blancas ${s.white.join('×')} · ruedas ${s.wheel.join('×')} · pad ${s.xy.join('×')} · macro ${s.macro.join('×')}`);
      assert.deepEqual(errors, [], 'errores o warnings de consola');
    } finally { await ctx.close(); }
  });
}

test('MonoMoon · R1 · toque: glissando entre filas, multitáctil, ruedas, macros, doble tap, long-press', async () => {
  const { ctx, page, errors } = await open({ width: 360, height: 640 });
  try {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: q[2] ?? i })) });
    const at = (sel, i = 0, fy = 0.8) => page.evaluate(([s, i, fy]) => { const r = document.querySelectorAll(s)[i].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height * fy]; }, [sel, i, fy]);
    const held = () => page.evaluate(() => engine.held.slice());
    await touch('touchStart', [[180, 320]]); await touch('touchEnd', []); await page.waitForTimeout(700);
    const c4 = await at('.key.white', 0), e4 = await at('.key.white', 2), c5 = await at('.key.white', 7), g4 = await at('.key.white', 4);
    await touch('touchStart', [c4]); await page.waitForTimeout(60); assert.deepEqual(await held(), [60]);
    await touch('touchMove', [e4]); await page.waitForTimeout(40); assert.deepEqual(await held(), [64], 'glissando dentro de la fila');
    await touch('touchMove', [c5]); await page.waitForTimeout(40); assert.deepEqual(await held(), [72], 'glissando a la fila de arriba');
    await touch('touchStart', [[c5[0], c5[1], 0], [g4[0], g4[1], 1]]); await page.waitForTimeout(40);
    assert.deepEqual((await held()).sort(), [67, 72], 'dos dedos');
    await touch('touchEnd', []); await page.waitForTimeout(60); assert.deepEqual(await held(), []);
    const pw = await page.evaluate(() => { const r = document.getElementById('pitchWheel').getBoundingClientRect(); return [r.x + r.width / 2, r.y, r.height]; });
    await touch('touchStart', [[pw[0], pw[1] + pw[2] / 2]]); await touch('touchMove', [[pw[0], pw[1] + 4]]); await page.waitForTimeout(40);
    assert.ok(await page.evaluate(() => REG.wheels.pitch.value) > 0.8, 'la rueda de pitch sube');
    await touch('touchEnd', []); await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => REG.wheels.pitch.value), 0, 'la rueda de pitch vuelve al centro');
    const mc = await at('#m_cutoff', 0, 0.5);
    await touch('touchStart', [mc]); await touch('touchMove', [[mc[0], mc[1] - 60]]); await touch('touchEnd', []);
    const cut = await page.evaluate(() => [engine.state.filter.cutoff, REG.knob.k_cutoff.value]);
    assert.ok(cut[0] > 1000 && cut[0] === cut[1], 'la macro Cutoff mueve el corte y el knob de la sección');
    await touch('touchStart', [mc]); await touch('touchEnd', []); await page.waitForTimeout(80); await touch('touchStart', [mc]); await touch('touchEnd', []);
    await page.waitForTimeout(80); assert.equal(await page.evaluate(() => engine.state.filter.cutoff), 340, 'doble tap = valor de fábrica');
    await touch('touchStart', [mc]); await page.waitForTimeout(650); await touch('touchEnd', []); await page.waitForTimeout(200);
    assert.ok(await page.$('.zd-dlg input'), 'long-press abre el valor numérico');
    await page.fill('.zd-dlg input', '1.5k'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => engine.state.filter.cutoff), 1500, '"1.5k" = 1500 Hz');
    await page.evaluate(() => { ZD.modal.prompt('x'); }); await page.waitForTimeout(150); await page.keyboard.press('a');
    assert.deepEqual(await held(), [], 'el teclado de PC no toca notas con un modal abierto');
    await page.keyboard.press('Escape');
    console.log('  glissando C4→E4→C5 · 2 dedos · pitch vuelve al centro · macro ↔ sección · doble tap · long-press "1.5k"');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────── R2 · instalación ──────────────────────────────

test('MonoMoon · R2 · el banner no tapa REC, macros ni teclado; prompt() una vez; "Ahora no" 14 días', async () => {
  for (const v of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(v);
    try {
      await power(page);
      await page.evaluate(BIP); await page.waitForTimeout(250);
      const ban = await rect(page, '.zd-pwa-banner');
      assert.ok(ban, 'tiene que aparecer el banner');
      assert.match(await page.evaluate(() => document.getElementById('zd-stage').firstElementChild.className), /zd-pwa-banner/);
      for (const s of ['#btnRec', '#zd-top', '#macroPanel', '#xyPanel', '#kbPanel', '#zd-tabs']) {
        assert.equal(overlap(ban, await rect(page, s)), false, `el banner tapa ${s}`);
      }
      const keysBottom = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('.key')).map((k) => k.getBoundingClientRect().bottom)));
      assert.ok(keysBottom <= (await rect(page, '#zd-tabs')).y, 'las teclas siguen arriba de las tabs');
      await page.click('.zd-pwa-banner .zd-pwa-go'); await page.waitForTimeout(200);
      const again = await page.$('.zd-pwa-banner .zd-pwa-go'); if (again) { await again.click(); await page.waitForTimeout(200); }
      assert.equal(await page.evaluate(() => window.__prompts), 1, 'prompt() una sola vez');
      // BIP rechaza el diálogo nativo: desde zd-pwa v3 eso cuenta como "Ahora no"
      // (era el punto 2 de reports/monomoon-block-request.md)
      assert.equal(await rect(page, '.zd-pwa-banner'), null, 'rechazado: el banner se va (zd-pwa v3)');
      assert.ok(await page.evaluate(() => localStorage.getItem('zd:pwa:dismissed')), 'rechazado: guarda zd:pwa:dismissed');
      await page.evaluate(() => localStorage.removeItem('zd:pwa:dismissed'));
      await page.evaluate(BIP); await page.waitForTimeout(250);
      await page.click('.zd-pwa-banner .zd-pwa-later'); await page.waitForTimeout(150);
      await page.reload(); await page.waitForTimeout(300); await page.evaluate(BIP); await page.waitForTimeout(250);
      assert.equal(await rect(page, '.zd-pwa-banner'), null, '"Ahora no" lo silencia');
      await page.evaluate(() => localStorage.setItem('zd:pwa:dismissed', String(Date.now() - 15 * 864e5)));
      await page.reload(); await page.waitForTimeout(300); await page.evaluate(BIP); await page.waitForTimeout(250);
      assert.ok(await rect(page, '.zd-pwa-banner'), 'a los 15 días vuelve');
      console.log(`  ${v.width}×${v.height}: banner ${Math.round(ban.w)}×${Math.round(ban.h)} sin superposición · prompt() ×1 · 14 días`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); });
  const page = await ctx.newPage(); await page.goto(srv.origin + URL_PATH); await page.waitForTimeout(300); await page.evaluate(BIP); await page.waitForTimeout(250);
  assert.equal(await rect(page, '.zd-pwa-banner'), null, 'standalone: sin banner');
  assert.equal(await rect(page, '#zd-pwa-topbtn'), null, 'standalone: sin ↓');
  await ctx.close();
});

// ───────────────────────────── R3 · autoguardado ─────────────────────────────

test('MonoMoon · R3 · tocar → recargar → mismo estado, sin arrancar el audio', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    assert.deepEqual(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n === 'hackwave-minimoog')), [], 'en un perfil limpio no se crea la DB vieja');
    await page.evaluate(() => {
      REG.knob.k_cutoff.set(1234); REG.knob.k_res.set(0.61); REG.knob.k_atk.set(0.25); MAC.glide.set(0.5);
      document.querySelector('#voiceSeg button[data-m="duo"]').click(); document.querySelectorAll('#oscRows .wave-btn')[3].click();
      REG.tog.osc3KbdTog.click(); shiftOctave(1); REG.wheels.mod.set(0.4);
    });
    await page.waitForTimeout(1900);
    const before = await page.evaluate(() => JSON.stringify({ s: engine.state, o: baseOctave }));
    await page.reload(); await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => JSON.stringify({ s: engine.state, o: baseOctave })), before, 'el estado vuelve igual');
    assert.equal(await page.evaluate(() => window.__acs.length), 0, 'restaurar no crea AudioContext');
    assert.ok((await toasts(page)).some((t) => /Sesión restaurada/.test(t)));
    const ui = await page.evaluate(() => [document.getElementById('v_cutoff').textContent, document.querySelector('#voiceSeg .on').dataset.m, document.getElementById('octVal').textContent, document.getElementById('mv_glide').textContent]);
    assert.deepEqual(ui, ['1.2k', 'duo', 'C5', '45ms'], 'la UI refleja lo restaurado');
    await page.evaluate(() => { bank.push({ name: 'mío', octave: 3, ts: Date.now(), state: defaultState() }); libSave(); refreshUserList(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { resetAll(); }); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('.zd-dact button')).map((b) => b.textContent)), ['CANCELAR', 'BORRAR TAMBIÉN LA BIBLIOTECA', 'SOLO EL PATCH']);
    await page.click('.zd-dact button.pri'); await page.waitForTimeout(300);
    await page.reload(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => engine.state.filter.cutoff), 340, 'empezar de cero: patch de fábrica');
    assert.deepEqual(await page.evaluate(() => bank.map((x) => x.name)), ['mío'], '"solo el patch" conserva la biblioteca');
    console.log(`  9 cambios → recargar → idéntico · 0 AudioContext · ${ui.join(' / ')}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · R3 · migración de "hackwave-minimoog" sin perder patches (la vieja queda intacta)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(srv.origin + '/404.html');
    await page.evaluate(() => new Promise((res, rej) => {   // la DB tal como la escribía la versión anterior
      const r = indexedDB.open('hackwave-minimoog', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('patches', { keyPath: 'name' });
      r.onsuccess = () => { const db = r.result, tx = db.transaction('patches', 'readwrite'), st = tx.objectStore('patches');
        const mk = (name, cutoff, octave, ts) => ({ name, ts, data: { app: 'hackwave-minimoog', version: 4, name, octave,
          state: { osc: [{ wave: 'square', foot: 16, detune: 0, level: 0.9, on: true }], filter: { cutoff, res: 0.7, track: 0.4 }, voiceMode: 'unison', glide: { on: true, time: 0.12 } } } });
        st.put(mk('Bajo de la banda', 450, 2, 1700000000000)); st.put(mk('Lead <b>raro</b>', 2200, 5, 1700000100000)); st.put({ name: 'roto', ts: 1, data: 'x' });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
      r.onerror = () => rej(r.error);
    }));
    const dumpOld = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('hackwave-minimoog');
      r.onsuccess = () => { const db = r.result, g = db.transaction('patches').objectStore('patches').getAll(); g.onsuccess = () => { db.close(); res(JSON.stringify(g.result)); }; }; }));
    const oldBefore = await dumpOld();
    await page.goto(srv.origin + URL_PATH); await page.waitForTimeout(800);
    assert.deepEqual(await page.evaluate(() => bank.map((x) => [x.name, x.octave, x.state.filter.cutoff])).then((a) => a.sort()),
      [['Bajo de la banda', 2, 450], ['Lead <b>raro</b>', 5, 2200]], 'los 2 patches válidos migran (el roto no)');
    assert.ok((await toasts(page)).some((t) => /migrada: 2 patches/.test(t)));
    assert.equal(await dumpOld(), oldBefore, 'la DB vieja queda byte a byte igual');
    const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('zd-sessions');
      r.onsuccess = () => { const g = r.result.transaction('sessions').objectStore('sessions').get('zd:monomoon-lib:session'); g.onsuccess = () => res([g.result.app, g.result.data.bank.length]); }; }));
    assert.deepEqual(stored, ['monomoon-70-lib', 2], 'la biblioteca queda en el store nuevo');
    await page.selectOption('#userSel', 'Bajo de la banda'); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => [engine.state.filter.cutoff, engine.state.osc[0].wave, baseOctave]), [450, 'square', 2]);
    await page.reload(); await page.waitForTimeout(600);
    assert.ok(!(await toasts(page)).some((t) => /migrada/.test(t)), 'la migración corre una sola vez');
    await page.evaluate(() => { resetAll(); }); await page.waitForTimeout(150); await page.click('.zd-dact button.dng'); await page.waitForTimeout(300);
    await page.reload(); await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => bank.length), 0, '"borrar todo" no vuelve a importar la DB vieja');
    assert.equal(await dumpOld(), oldBefore, 'y la vieja sigue intacta');
    console.log('  3 registros viejos (1 roto) → 2 patches en zd:monomoon-lib:session · DB vieja intacta · una sola vez');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · R3 · sin IndexedDB guarda en localStorage', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (e) {} });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(srv.origin + URL_PATH); await page.waitForTimeout(300);
    await page.evaluate(() => REG.knob.k_res.set(0.77)); await page.waitForTimeout(1800);
    await page.reload(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => engine.state.filter.res), 0.77);
    assert.ok(await page.evaluate(() => !!localStorage.getItem('zd:monomoon:session')));
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────── R4 · JSON / MIDI / WAV ──────────────────────────

test('MonoMoon · R4 · JSON de estado completo: ida y vuelta, rechazos y patch viejo', async () => {
  const { ctx, page, errors } = await open({ width: 1280, height: 860, touch: false });
  try {
    await power(page, false);
    const dl = async (click) => { const [d] = await Promise.all([page.waitForEvent('download'), click()]); const p = join(TMP, d.suggestedFilename()); await d.saveAs(p); return p; };
    const pick = async (path) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnImport')]); await fc.setFiles(path); await page.waitForTimeout(300); };
    await page.evaluate(() => { REG.knob.k_cutoff.set(777); shiftOctave(-1); bank.push({ name: 'Uno <img src=x onerror=alert(1)>', octave: 3, ts: 1, state: defaultState() }); libSave(); refreshUserList(); currentName = 'en edición'; });
    const jp = await dl(() => page.click('#btnExport'));
    assert.match(jp, /monomoon-\d{8}-\d{4}\.json$/);
    const env = JSON.parse(readFileSync(jp, 'utf8'));
    assert.equal(env.app, 'monomoon-70'); assert.equal(env.version, 1); assert.ok(env.savedAt);
    assert.equal(env.data.patch.state.filter.cutoff, 777); assert.equal(env.data.bank.length, 1);
    await page.evaluate(() => { REG.knob.k_cutoff.set(5000); shiftOctave(3); bank.length = 0; refreshUserList(); });
    await pick(jp);
    assert.deepEqual(await page.evaluate(() => [engine.state.filter.cutoff, baseOctave, bank.length]), [777, 3, 1], 'ida y vuelta');
    const bad = { 'roto.json': '{ no', 'otra.json': JSON.stringify({ app: 'acid-bass-303', version: 1, data: {} }),
      'nueva.json': JSON.stringify({ app: 'monomoon-70', version: 9, data: {} }), 'vacio.json': JSON.stringify({ app: 'monomoon-70', version: 1, data: { patch: 3 } }) };
    for (const [n, body] of Object.entries(bad)) {
      const p = join(TMP, n); writeFileSync(p, body); await pick(p);
      assert.ok(await page.$('.zd-dlg'), `${n}: el error sale en un modal`); await page.keyboard.press('Escape'); await page.waitForTimeout(220);
    }
    const lp = join(TMP, 'hackwave-x.json');
    writeFileSync(lp, JSON.stringify({ app: 'hackwave-minimoog', version: 4, name: 'Viejo', octave: 2, state: { filter: { cutoff: 999999 }, voiceMode: 'duo' } }));
    await pick(lp);
    assert.deepEqual(await page.evaluate(() => [engine.state.filter.cutoff, engine.state.voiceMode, baseOctave]), [18000, 'duo', 2], 'el patch viejo carga, acotado');
    console.log(`  ${jp.split('/').pop()} · ida y vuelta · 4 rechazos en modal · patch 'hackwave-minimoog' acotado`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · R4 · REC: WAV + MIDI de performance de la misma toma', async () => {
  const { ctx, page, errors } = await open({ width: 1280, height: 860, touch: false });
  try {
    await power(page, false);
    await page.evaluate(() => document.querySelector('.perf-row').scrollIntoView({ block: 'start' }));
    await page.evaluate(() => document.getElementById('btnRec').click()); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => wavRec.state), 'rec');
    const key = (i) => page.evaluate((i) => { const r = document.querySelectorAll('.key.white')[i].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height * 0.85]; }, i);
    for (const i of [0, 2, 4, 0]) { const [x, y] = await key(i); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.up(); await page.waitForTimeout(50); }
    { const [x, y] = await key(7); await page.mouse.move(x, y); await page.mouse.down(); const [x2, y2] = await key(9); await page.mouse.move(x2, y2, { steps: 6 }); await page.waitForTimeout(120); await page.mouse.up(); }
    const wheel = async (id, f) => { const r = await page.evaluate((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.x + b.width / 2, b.y, b.height]; }, id);
      await page.mouse.move(r[0], r[1] + r[2] / 2); await page.mouse.down(); await page.mouse.move(r[0], r[1] + r[2] * f, { steps: 5 }); await page.waitForTimeout(60); await page.mouse.up(); };
    await page.keyboard.down('f'); await wheel('pitchWheel', 0.05); await wheel('modWheel', 0.2); await page.keyboard.up('f');
    const xy = await rect(page, '#xypad');
    await page.mouse.move(xy.x + 10, xy.y + xy.h - 10); await page.mouse.down(); await page.mouse.move(xy.x + xy.w - 10, xy.y + 10, { steps: 8 }); await page.mouse.up();
    await page.keyboard.down('h'); await page.waitForTimeout(250);
    await page.evaluate(() => document.getElementById('btnRec').click()); await page.waitForTimeout(500); await page.keyboard.up('h');
    assert.equal(await page.evaluate(() => document.getElementById('takePanel').hidden), false, 'aparece la tarjeta de la toma');
    const dl = async (click) => { const [d] = await Promise.all([page.waitForEvent('download'), click()]); const p = join(TMP, d.suggestedFilename()); await d.saveAs(p); return p; };
    const wp = await dl(() => page.click('.zd-reccard button.pri'));
    const mp = await dl(() => page.click('#btnMidi'));
    const w = readFileSync(wp), dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
    const sr = await page.evaluate(() => engine.ctx.sampleRate);
    assert.equal(w.toString('ascii', 0, 4), 'RIFF'); assert.equal(w.toString('ascii', 8, 12), 'WAVE');
    assert.equal(dv.getUint16(20, true), 1, 'PCM'); assert.equal(dv.getUint16(22, true), 2, 'estéreo'); assert.equal(dv.getUint16(34, true), 16, '16 bits');
    assert.equal(dv.getUint32(24, true), sr, 'a la frecuencia real del contexto');
    let peak = 0; for (let o = 44; o < w.length; o += 2) peak = Math.max(peak, Math.abs(dv.getInt16(o, true)));
    assert.ok(peak > 1000, 'el WAV no está en silencio');
    const smf = parseSMF(readFileSync(mp)), an = analyzeNotes(smf);
    const kinds = {}; smf.events.forEach((e) => { const k = e.kind === 'cc' ? 'cc' + e.cc : e.kind; kinds[k] = (kinds[k] || 0) + 1; });
    assert.equal(smf.format, 0); assert.equal(smf.ppq, 96); assert.equal(Math.round(smf.tempoBpm), 120);
    assert.equal(smf.trackName, "ZERO DAY MONOMOON'70");
    assert.ok(an.notes.length >= 8, `notas: ${an.notes.length}`);
    assert.ok(kinds.bend > 2 && kinds.cc1 > 1 && kinds.cc74 > 1 && kinds.cc71 > 1, JSON.stringify(kinds));
    assert.deepEqual(defects(an), [], 'MIDI sin solapes, colgadas, duración cero ni off fuera de orden');
    console.log(`  WAV ${wp.split('/').pop()} · PCM16 estéreo ${sr} Hz · ${((w.length - 44) / 4 / sr).toFixed(2)} s · pico ${(peak / 32768).toFixed(2)}`);
    console.log(`  MIDI ${mp.split('/').pop()} · ${an.notes.length} notas · ${JSON.stringify(kinds)} · 0 defectos`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · R4 · REC: al llegar al tope la toma no se pierde', async () => {
  const { ctx, page, errors } = await open({ width: 1280, height: 860, touch: false });
  try {
    await power(page, false);
    // mismo flujo que el tope de 10 min, con 1 s
    await page.evaluate(() => { const c = ZD.rec.create; ZD.rec.create = (cfg) => c(Object.assign({}, cfg, { maxSec: 1 })); });
    await page.keyboard.down('a');
    await page.evaluate(() => document.getElementById('btnRec').click()); await page.waitForTimeout(1900); await page.keyboard.up('a');
    const s = await page.evaluate(() => ({ state: wavRec.state, card: !document.getElementById('takePanel').hidden, meta: document.querySelector('.zd-reccard .zd-rcmeta')?.textContent, btn: document.getElementById('btnRec').textContent }));
    assert.equal(s.state, 'idle'); assert.ok(s.card, 'aparece la tarjeta con lo grabado'); assert.equal(s.btn, '● REC');
    assert.ok((await toasts(page)).some((t) => /tope de 10 minutos/.test(t)));
    console.log(`  tope (1 s en la prueba): tarjeta "${s.meta}" · aviso en un toast`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── R5 · audio ──────────────────────────────────

test('MonoMoon · R5 · audio: destrabar dentro del gesto, suspend → overlay → reanudar, CLIP', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    assert.equal(await page.evaluate(() => window.__acs.length), 0);
    await power(page);
    const a = await page.evaluate(() => ({ n: window.__acs.length, opts: window.__acs[0], state: engine.ctx.state, unlocked: ZD.audio.unlocked, silent: !!document.querySelector('audio') }));
    assert.equal(a.n, 1); assert.equal(a.opts.latencyHint, 'interactive'); assert.equal(a.state, 'running'); assert.ok(a.unlocked); assert.ok(a.silent, '<audio> silencioso iniciado');
    await page.keyboard.down('a'); await page.waitForTimeout(150);
    await page.evaluate(() => engine.ctx.suspend()); await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.querySelector('.zd-resume.on') !== null), 'overlay "Tocá para reanudar"');
    await page.tap('.zd-resume'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => engine.ctx.state), 'running');
    await page.keyboard.up('a');
    await page.evaluate(() => engine.ctx.suspend()); await page.waitForTimeout(120);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => engine.ctx.state), 'running', 'visibilitychange reanuda');
    // CLIP con un patch posible desde la UI: pulso angosto en 32', filtro abierto, volumen 100, octava 0.
    // La entrada del WaveShaper queda en ~0,63, pero la salida (después del DC-block) llega a ~1,7 FS: ver reporte.
    await page.evaluate(() => { const st = defaultState(); st.osc.forEach((o) => { o.wave = 'pulseNarrow'; o.level = 1; o.foot = 32; });
      st.filter = { cutoff: 18000, res: 0, track: 0 }; st.master.vol = 1; st.contour = 0; loadPatch({ state: st, octave: 0 }); });
    await page.waitForTimeout(600);
    // el LED se vigila dentro de la página durante toda la frase (ataques, cambios de nota y releases)
    await page.evaluate(() => { window.__clip = false; new MutationObserver(() => { if (!document.getElementById('clipLed').hidden) window.__clip = true; })
      .observe(document.getElementById('clipLed'), { attributes: true }); });
    for (const k of ['a', 's', 'd']) { await page.keyboard.down(k); await page.waitForTimeout(450); }
    for (const k of ['a', 's', 'd']) await page.keyboard.up(k);
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => window.__clip), 'CLIP se enciende');
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => document.getElementById('clipLed').hidden), true, 'y se apaga solo');
    console.log('  1 contexto interactive · running · suspend→overlay→toque→running · visibilitychange · CLIP con pulso angosto 32\' a vol 100');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · rotación de tablet 1180×820 ↔ 820×1180 con una nota sonando', async () => {
  const { ctx, page, errors } = await open({ width: 1180, height: 820 });
  try {
    await power(page);
    await page.evaluate(() => kbd.press('test', 60, keyEls[0]));
    const t0 = await page.evaluate(() => engine.ctx.currentTime);
    for (let i = 1; i <= 4; i++) {
      for (const v of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
        await page.setViewportSize(v); await page.waitForTimeout(220);
        const s = await page.evaluate(() => ({ shell: !!ZD.mobile.active, state: engine.ctx.state, held: engine.held.slice(), vca: engine.vca.gain.value,
          stage: Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean),
          kb: document.getElementById('keys').getBoundingClientRect().height, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
        const where = `vuelta ${i} · ${v.width}×${v.height}`;
        assert.equal(s.state, 'running', `${where}: el audio no se corta`);
        assert.deepEqual(s.held, [60], `${where}: la nota sigue apretada`);
        assert.ok(s.vca > 0.1, `${where}: la nota sigue sonando (VCA ${s.vca.toFixed(2)})`);
        assert.equal(s.shell, v.width === 820);
        assert.deepEqual(s.stage, s.shell ? KEEP : [], `${where}: stage`);
        assert.ok(s.kb > 80, `${where}: teclado visible`); assert.equal(s.hscroll, false);
      }
    }
    const t1 = await page.evaluate(() => engine.ctx.currentTime);
    assert.ok(t1 > t0);
    await page.evaluate(() => kbd.release('test'));
    console.log(`  8 rotaciones con Do4 sonando · ctx.currentTime ${t0.toFixed(2)} → ${t1.toFixed(2)}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── R6 · a11y ───────────────────────────────────

test('MonoMoon · R6 · cero diálogos nativos, sliders con nombre y teclado', async () => {
  const src = readFileSync(join(ROOT, FILE), 'utf8').replace(/\/\* ZD-BLOCK:[\s\S]*?\/\* \/ZD-BLOCK:[^*]*\*\//g, '');
  assert.equal((src.match(/(^|[^.\w])(alert|confirm|prompt)\(/g) || []).length, 0, 'no puede quedar alert/confirm/prompt');
  const { ctx, page, errors } = await open({ width: 1280, height: 860, touch: false });
  try {
    await page.focus('#powerOvl'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => engine.ready), 'el overlay se enciende con Enter');
    const sl = await page.evaluate(() => Array.from(document.querySelectorAll('[role=slider]')).map((e) => [e.getAttribute('aria-label'), e.getAttribute('aria-valuetext'), e.tabIndex]));
    assert.ok(sl.length >= 35); assert.ok(sl.every(([l, t, i]) => l && t && i >= 0), 'todos con nombre, valor y foco');
    assert.equal(new Set(sl.map((x) => x[0])).size, sl.length, 'nombres sin repetir');
    await page.focus('#k_cutoff'); await page.keyboard.press('End'); assert.equal(await page.evaluate(() => engine.state.filter.cutoff), 18000);
    await page.keyboard.press('Home'); assert.equal(await page.evaluate(() => engine.state.filter.cutoff), 20);
    const sw = await page.evaluate(() => Array.from(document.querySelectorAll('[role=switch]')).every((t) => t.getAttribute('aria-label') && t.tabIndex === 0 && t.hasAttribute('aria-checked')));
    assert.ok(sw, 'interruptores con role=switch');
    await page.keyboard.down('a'); assert.equal(await page.evaluate(() => keyEls[0].getAttribute('aria-pressed')), 'true'); await page.keyboard.up('a');
    assert.equal(await page.evaluate(() => keyEls[0].getAttribute('aria-label')), 'Do 4');
    console.log(`  0 diálogos nativos · ${sl.length} sliders con nombre único · switches · teclas con aria-pressed`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ──────────────────────── SPEC 3.2 · file://, hosted, iframe ─────────────────

test('MonoMoon · file://: sin SW, sin pedidos de red, solo el aviso local', async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [], net = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) net.push(r.url()); });
  try {
    await page.goto(pathToFileURL(join(ROOT, FILE)).href); await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ active: ZD.pwa.active, local: !!document.querySelector('.zd-pwa-local'), banner: !!document.querySelector('.zd-pwa-banner'),
      href: (document.querySelector('.zd-pwa-local a') || {}).href }));
    assert.equal(s.active, false); assert.ok(s.local); assert.equal(s.banner, false);
    assert.equal(s.href, 'https://zeroday-musicexploits.github.io/instruments/descargables/MonoMoon70.html');
    assert.deepEqual(net, [], 'cero pedidos de red'); assert.deepEqual(errors, []);
    console.log('  file:// · aviso local → canonical · 0 pedidos de red · 0 errores');
  } finally { await ctx.close(); }
});

test('MonoMoon · hosted: SW registrado, manifest estático y theme-color del manifest', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(srv.origin + URL_PATH); await page.waitForTimeout(1500);
    const s = await page.evaluate(async () => ({ reg: ZD.pwa.registered, manifest: document.querySelector('link[rel=manifest]').getAttribute('href'),
      theme: document.querySelector('meta[name=theme-color]').content, title: document.querySelector('meta[name="apple-mobile-web-app-title"]').content,
      blob: Array.from(document.querySelectorAll('link[rel=manifest]')).some((l) => /^(blob|data):/.test(l.href)) }));
    const man = JSON.parse(readFileSync(join(ROOT, 'manifests/monomoon.webmanifest'), 'utf8'));
    assert.ok(s.reg); assert.equal(s.manifest, '../manifests/monomoon.webmanifest'); assert.equal(s.blob, false);
    assert.equal(s.theme, man.theme_color, 'theme-color = theme_color del manifest'); assert.equal(s.title, man.short_name);
    assert.deepEqual(errors, []);
    console.log(`  SW registrado · ${s.manifest} · theme-color ${s.theme} · "${s.title}"`);
  } finally { await ctx.close(); }
});

test('MonoMoon · iframe: zd-pwa inerte, shell activo y el audio arranca', async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 700 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [], reqs = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => reqs.push(r.url()));
  try {
    await page.goto(srv.origin + IFRAME_PATH); await page.waitForTimeout(600);
    const f = page.frame({ url: /MonoMoon70/ });
    await f.evaluate(BIP); await page.waitForTimeout(250);
    const s = await f.evaluate(() => ({ active: ZD.pwa.active, banner: !!document.querySelector('.zd-pwa-banner'), shell: ZD.mobile.active }));
    assert.deepEqual(s, { active: false, banner: false, shell: true });
    assert.equal(reqs.filter((u) => /sw\.js|webmanifest/.test(u)).length, 0, 'sin pedidos al SW ni al manifest');
    await f.evaluate(() => document.getElementById('powerOvl').click()); await page.waitForTimeout(600);
    assert.equal(await f.evaluate(() => engine.ctx.state), 'running');
    assert.deepEqual(errors, []);
    console.log('  iframe · zd-pwa inerte · shell activo · audio running · 0 errores');
  } finally { await ctx.close(); }
});

// ─────────────────────────────────── C2 ──────────────────────────────────────

test('MonoMoon · C2: con un hub falso registra, toca por MIDI, para y no autoguarda el patch', async () => {
  const ctx = await browser.newContext({ viewport: { width: 500, height: 800 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(srv.origin + HUB_PATH); await page.waitForTimeout(1500);
    const f = page.frame({ url: /MonoMoon70/ });
    const reg = await page.evaluate(() => C2.regs.map((a) => [a.id, a.name, a.apiVersion, JSON.stringify(a.capabilities)]));
    assert.deepEqual(reg, [['slotA', 'MonoMoon 70', 1, '{"sequencer":false,"tempoAware":false,"midiIn":true}']]);
    await page.waitForFunction(() => C2.regs[0].diag !== null, null, { timeout: 5000 });
    const s = await f.evaluate(() => ({ title: document.title, midi: document.getElementById('midiTxt').textContent, sameCtx: engine.ctx === window.parent.C2.ctx,
      session: Session, lib: !!Library, ready: engine.ready, resume: !!document.querySelector('.zd-resume') }));
    assert.equal(s.title, 'MonoMoon 70 · C2'); assert.equal(s.midi, 'MIDI ← C2'); assert.ok(s.sameCtx, 'usa el ctx del host');
    assert.equal(s.session, null, 'el patch no se autoguarda dentro del hub'); assert.ok(s.lib, 'la biblioteca sí');
    assert.ok(s.ready);
    await page.evaluate(() => C2.regs[0].midiMessage([0x90, 64, 100])); await page.waitForTimeout(100);
    assert.deepEqual(await f.evaluate(() => engine.held.slice()), [64], 'el MIDI del hub toca');
    await page.evaluate(() => C2.regs[0].onTransport('stop')); await page.waitForTimeout(50);
    assert.deepEqual(await f.evaluate(() => engine.held.slice()), [], 'stop suelta las notas');
    assert.equal(typeof (await page.evaluate(() => C2.regs[0].getState().filter.cutoff)), 'number');
    console.log(`  registro slotA · ctx del host · 'MIDI ← C2' · midiMessage toca · stop suelta · sin sesión, con biblioteca · probe ${await page.evaluate(() => JSON.stringify(C2.regs[0].diag))}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · el adaptador C2 no cambió (git diff filtrado)', () => {
  let diff;
  try { diff = execFileSync('git', ['-C', ROOT, 'diff', '-U0', BASE, '--', FILE], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (e) { console.log('  (sin git o sin la base ' + BASE + ': se saltea)'); return; }
  const lines = diff.split('\n').filter((l) => /^[-+](?![-+])/.test(l) && /HOST|zeroday_sync|registerInstrument|C2_OUT|C2_CHANNEL|SLOT_ID/.test(l));
  // lo único permitido: líneas nuevas que *leen* HOST sin tocar el adaptador (autoguardado y zd-audio apagados en el hub)
  const removed = lines.filter((l) => l.startsWith('-'));
  const added = lines.filter((l) => l.startsWith('+') && !/^\+\s*(if\(!HOST|if\(HOST\)|  if\(!HOST\) Session=|function activityOn\(\)\{ if\(HOST|if\(!HOST && window\.ZD && ZD\.audio\)|\/\/ (Fuera|Dentro) del hub)/.test(l));
  assert.deepEqual(removed, [], 'no se puede quitar ni cambiar ninguna línea con HOST / zeroday_sync / registerInstrument');
  assert.deepEqual(added, [], 'líneas nuevas con HOST fuera de las previstas');
  console.log(`  ${BASE}..HEAD: 0 líneas quitadas con HOST/zeroday_sync/registerInstrument/C2_*; ${lines.length} agregadas (solo lecturas de HOST)`);
});

test('MonoMoon · bloques idénticos (check-blocks)', () => {
  const out = execFileSync(process.execPath, [join(ROOT, 'tools/check-blocks.mjs')], { encoding: 'utf8' });
  assert.match(out, /sin diferencias/);
  assert.doesNotMatch(out, /pendiente: [^\n]*MonoMoon70/);
});
