#!/usr/bin/env node
// tools/tests/j4-reposo.test.mjs
//
// J4-Sirens Station en reposo: encendido y sin tocar nada, tiene que quedar en
// silencio. Antes el VCA quedaba en 0,0001 en reposo: esa fuga del oscilador
// (~−70 dBFS) cebaba el lazo del eco, que con el patch de fábrica tiene
// ganancia de pequeña señal ≈ 1,13 (FEEDBACK 0,42 × TAPE SAT tanh(2,7·x)), y la
// salida subía de −81 a −14 dBFS RMS en ~10 s. Ver reports/j4.md (riesgos) y
// reports/F2b.md.
//
// La salida se mide como en j4-mute: un AudioWorklet medidor (pico y RMS por
// bloque de 128 muestras, con su currentTime) colgado de un tap propio, al que
// se conecta todo nodo que va a un AudioDestinationNode.
//
//   1  Patch de fábrica, encender y 30 s sin tocar nada: RMS < −80 dBFS
//      (en total y en cada segundo).
//
//   node tools/tests/j4-reposo.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const FILE = 'descargables/J4-Sirens_Station.html';
const URL_PATH = '/' + FILE;

/* Tap de salida + medidor. Corre antes que la página (addInitScript). */
const INIT_TAP = () => {
  const conn = AudioNode.prototype.connect;
  window.__conn = conn;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = conn.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
      const c = dest.context;
      if (!c.__tap) c.__tap = c.createGain();
      conn.call(this, c.__tap);
    }
    return r;
  };
  const CODE = `registerProcessor('zd-meter', class extends AudioWorkletProcessor {
    constructor(){ super(); this.b = []; }
    process(inp){
      const ch = inp[0] || []; let pk = 0, ss = 0, n = 0;
      for (const d of ch) { for (let i = 0; i < d.length; i++) { const v = d[i], a = v < 0 ? -v : v; if (a > pk) pk = a; ss += v * v; } n += d.length; }
      this.b.push(currentTime, pk, n ? ss / n : 0);
      if (this.b.length >= 48) { this.port.postMessage(this.b); this.b = []; }
      return true;
    }
  });`;
  window.__m = []; window.__mLast = -1; window.__mFirst = -1;
  window.__meterOn = async (c) => {
    if (c.__meter) return;
    if (!c.__tap) c.__tap = c.createGain();
    const url = URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' }));
    await c.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(c, 'zd-meter');
    const mute = c.createGain(); mute.gain.value = 0;
    conn.call(c.__tap, node); conn.call(node, mute); conn.call(mute, c.destination);
    node.port.onmessage = (e) => {
      const a = e.data; if (window.__mFirst < 0) window.__mFirst = a[0];
      for (let i = 0; i < a.length; i++) window.__m.push(a[i]); window.__mLast = a[a.length - 3];
    };
    c.__meter = node;
  };
  window.__stats = (t0, t1) => {
    let pk = 0, ss = 0, n = 0;
    const m = window.__m;
    for (let i = 0; i < m.length; i += 3) { const t = m[i]; if (t >= t0 && t < t1) { if (m[i + 1] > pk) pk = m[i + 1]; ss += m[i + 2]; n++; } }
    return { pk, rms: n ? Math.sqrt(ss / n) : 0, n };
  };
};

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

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

async function open(viewport = { width: 390, height: 844 }, { path = URL_PATH, init } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 1200 });
  await ctx.addInitScript(INIT_TAP);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}
async function powerOn(page) {
  await page.click('#power');
  await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
  await page.evaluate(() => window.__meterOn(ctx));
  await page.waitForFunction(() => window.__mFirst >= 0, null, { timeout: 5000 });
}
/** Espera a que el medidor haya cubierto hasta t1 y devuelve pico/RMS en dBFS de [t0, t1). */
async function level(page, t0, t1) {
  await page.waitForFunction((t) => window.__mLast >= t, t1, { timeout: 15000 });
  const s = await page.evaluate(([a, b]) => window.__stats(a, b), [t0, t1]);
  return { pk: dB(s.pk), rms: dB(s.rms), n: s.n };
}

// ───────────────────── 1 · encendido y sin tocar nada: silencio ───────────────

test('1 · patch de fábrica, encender y 30 s sin tocar nada: RMS < −80 dBFS', async () => {
  const { ctx, page, errors } = await open();
  try {
    const fresh = await page.evaluate(() => ({ fb: P.echo.fb, sat: P.echo.sat, on: P.echo.on, rel: P.rel }));
    assert.deepEqual(fresh, { fb: 0.42, sat: 1.8, on: true, rel: 340 }, 'control: arranca con el patch de fábrica (sin sesión guardada)');
    await powerOn(page);
    const t0 = await page.evaluate(() => window.__mFirst);
    await page.waitForTimeout(30500);
    const all = await level(page, t0, t0 + 30);
    const secs = [];
    for (let s = 0; s < 30; s++) secs.push(await level(page, t0 + s, t0 + s + 1));
    const curve = secs.filter((_, i) => i % 3 === 0 || i === 29).map((x, i, a) => `${i === a.length - 1 ? 29 : i * 3} s ${fmt(x.rms)}`).join(' · ');
    const worst = secs.reduce((a, b) => (b.rms > a.rms ? b : a));
    console.log(`  30 s en reposo · RMS ${fmt(all.rms)} dBFS · pico ${fmt(all.pk)} dBFS · peor segundo ${fmt(worst.rms)} dBFS RMS`);
    console.log(`  RMS por segundo: ${curve}`);
    assert.ok(all.n > 30 * 300, `control: el medidor cubrió los 30 s (${all.n} bloques)`);
    assert.ok(all.rms < -80, `30 s en reposo: RMS ${fmt(all.rms)} dBFS (tiene que ser < −80)`);
    assert.ok(worst.rms < -80, `ningún segundo por encima de −80 dBFS RMS (el peor: ${fmt(worst.rms)})`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
