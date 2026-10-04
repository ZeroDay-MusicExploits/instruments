#!/usr/bin/env node
// tools/tests/zd-audio-resumed.test.mjs
//
// Pedido de CronBeat (reports/cronbeat-block-request.md punto 2): en zd-audio
// v1, `unlock()` llama a `onResumed` también cuando el contexto ya estaba en
// 'running', y `bindGesture()` llama a `unlock()` en cada pointerup, click,
// keydown y touchend. Resultado: `onResumed` corre dos veces por clic, no solo
// cuando el audio se reanuda. CronBeat midió 12 llamadas en 6 clics.
//
// Contrato de v2: `onResumed` corre solo en la transición a 'running': el
// primer destrabe, o volver de 'suspended'/'interrupted' (por un gesto o por
// `ZD.audio.resume()`, que es lo que corre en visibilitychange/pageshow/focus).
//
// 1. La copia canónica de tools/blocks/zd-audio.html, en una página mínima.
// 2. CronBeat publicado: su `onResumed` es `resyncSamples()`, que vuelve a
//    decodificar a la frecuencia real los samples restaurados antes del primer
//    gesto (con un OfflineAudioContext a 48 kHz). Para que el re-decode se vea,
//    el AudioContext de la página se fuerza a 44,1 kHz. Tiene que seguir
//    pasando en el primer destrabe, y solo ahí.
//
//   node tools/tests/zd-audio-resumed.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT, extractBlock } from './lib/load-block.mjs';
import { blockPage, blockVersion } from './lib/block-page.mjs';

const V = blockVersion('zd-audio');
const PAGE = '/__zd-audio-test.html';
const CRONBEAT = 'descargables/CronBeat-808.html';
const CB_V = extractBlock(readFileSync(join(ROOT, CRONBEAT), 'utf8'), 'zd-audio').version;

const WIRE = `<script>
window.__n = 0; window.__c = null;
ZD.audio.attach({
  getContext: () => window.__c,
  ensure: () => { if (!window.__c) window.__c = new AudioContext(ZD.audio.options()); },
  onResumed: () => { window.__n++; }
});
ZD.audio.bindGesture(window);
</script>`;

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, {
    [PAGE]: { body: blockPage({ blocks: ['zd-audio'], body: '<button id="b" type="button" style="width:200px;height:80px">tocar</button>' + WIRE, title: 'zd-audio test' }) },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function clicks(page, sel, n) {
  for (let i = 0; i < n; i++) { await page.click(sel); await page.waitForTimeout(40); }
  await page.waitForTimeout(250);
}

test(`zd-audio v${V} · onResumed solo en la transición a 'running', no en cada gesto`, async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  try {
    await page.goto(srv.origin + PAGE, { waitUntil: 'load' });
    const n = () => page.evaluate(() => ({ n: window.__n, state: window.__c && window.__c.state, unlocked: ZD.audio.unlocked }));
    const got = {};
    got.antes = await n();
    await clicks(page, '#b', 1);
    got.primerDestrabe = await n();
    await clicks(page, '#b', 6);
    got.seisClicsCorriendo = await n();
    await page.keyboard.press('Enter'); await page.keyboard.press('a'); await page.waitForTimeout(250);
    got.dosTeclas = await n();
    await page.evaluate(() => window.__c.suspend());
    await clicks(page, '#b', 1);
    got.gestoDesdeSuspended = await n();
    await clicks(page, '#b', 6);
    got.seisClicsMas = await n();
    await page.evaluate(() => window.__c.suspend());
    await page.evaluate(() => ZD.audio.resume());        // visibilitychange / pageshow / focus
    await page.waitForTimeout(300);
    got.resumeDesdeSuspended = await n();
    console.log('  ' + Object.entries(got).map(([k, v]) => `${k}: n=${v.n} (${v.state})`).join(' · '));
    assert.deepEqual(
      Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.n])),
      { antes: 0, primerDestrabe: 1, seisClicsCorriendo: 1, dosTeclas: 1, gestoDesdeSuspended: 2, seisClicsMas: 2, resumeDesdeSuspended: 3 },
      'onResumed: 1 en el primer destrabe, +0 con el contexto ya corriendo, +1 por cada vuelta desde suspended');
    assert.equal(got.resumeDesdeSuspended.state, 'running');
    assert.equal(got.primerDestrabe.unlocked, true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

/* AudioContext a 44,1 kHz (el decoder offline de CronBeat es de 48 kHz) y un
   contador alrededor del onResumed que CronBeat le pasa a ZD.audio.attach. */
const CB_INIT = () => {
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(o) { super(Object.assign({}, o || {}, { sampleRate: 44100 })); } };
  window.webkitAudioContext = window.AudioContext;
  window.__resumed = 0;
  const ZD = window.ZD || (window.ZD = {});
  let au;
  Object.defineProperty(ZD, 'audio', {
    configurable: true, enumerable: true, get: () => au,
    set(v) {
      const attach = v.attach;
      v.attach = (o) => {
        if (o && o.onResumed) { const f = o.onResumed; o = Object.assign({}, o, { onResumed() { window.__resumed++; return f(); } }); }
        return attach(o);
      };
      au = v;
    },
  });
};

test(`${CRONBEAT} (zd-audio v${CB_V}) · el primer destrabe re-decodifica los samples restaurados, y los clics siguientes no llaman a onResumed`, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(CB_INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  try {
    await page.goto(srv.origin + '/' + CRONBEAT, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    // un sample "restaurado": bytes decodificados sin AudioContext (offline, 48 kHz)
    await page.evaluate(async () => {
      const sr = 22050, n = Math.floor(sr / 4), buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf); let o = 0;
      const S = (t) => { for (const c of t) dv.setUint8(o++, c.charCodeAt(0)); }, U32 = (v) => { dv.setUint32(o, v, true); o += 4; }, U16 = (v) => { dv.setUint16(o, v, true); o += 2; };
      S('RIFF'); U32(36 + n * 2); S('WAVE'); S('fmt '); U32(16); U16(1); U16(1); U32(sr); U32(sr * 2); U16(2); U16(16); S('data'); U32(n * 2);
      for (let i = 0; i < n; i++) { dv.setInt16(o, Math.round(Math.sin(i / 8) * 12000 * (1 - i / n)), true); o += 2; }
      await setSampleFromBytes(3, new Uint8Array(buf), 'restaurado.wav', 'audio/wav', null);
    });
    const st = () => page.evaluate(() => ({ n: window.__resumed, ctx: ctx ? ctx.state : null, sr: ctx ? ctx.sampleRate : null, at: decodedAt[3], orig: sampleOrig[3] && sampleOrig[3].sampleRate }));
    const antes = await st();
    await clicks(page, '.brand', 1);               // primer gesto: crea el contexto
    await page.waitForTimeout(400);                // el re-decode es asíncrono
    const primero = await st();
    await clicks(page, '.brand', 6);
    const despues = await st();
    console.log(`  antes: ctx=${antes.ctx} · sample a ${antes.at} Hz · primer gesto: ctx ${primero.ctx} a ${primero.sr} Hz, sample re-decodificado a ${primero.at} Hz (buffer ${primero.orig} Hz), onResumed ×${primero.n} · 6 clics más: onResumed ×${despues.n}`);
    assert.deepEqual(
      { antes: [antes.ctx, antes.at], primero: [primero.ctx, primero.sr, primero.at, primero.orig, primero.n], seisClicsMas: despues.n },
      { antes: [null, 48000], primero: ['running', 44100, 44100, 44100, 1], seisClicsMas: 1 },
      'el primer destrabe llama una vez a resyncSamples y el sample queda a la frecuencia real; los clics siguientes no la vuelven a llamar');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
