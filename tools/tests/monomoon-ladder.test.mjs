#!/usr/bin/env node
// tools/tests/monomoon-ladder.test.mjs
//
// MonoMoon'70: el filtro 'moog-ladder' no da NaN (F2d, reports/F2d-monomoon.md) y
// su estado queda acotado (F2e, reports/F2e.md). Antes el estado era lineal (la
// tanh estaba solo en la salida): con Mod → Filtro y el Osc3 a frecuencia de audio
// crecía sin límite hasta Infinity y NaN, y MonoMoon quedaba mudo hasta recargar.
// F2d agregó una guarda (si el estado deja de ser finito, se reinicia). F2e satura
// la realimentación (x −= tanh(out4)·fb): como cada etapa tiene polo |1−f| < 1, con
// la realimentación acotada el estado queda acotado y la guarda no debería
// activarse nunca, tampoco en la condición dirigida de F2d (patch de fábrica +
// Mod → Filtro + rueda Mod 1 + Osc3 en 2').
//
//   1  Mod → Filtro con el Osc3 a frecuencia de audio (RESO 0,32 · 0,6 · 0,9;
//      Osc3 en 2' y 8'; rueda Mod 0,7 y 1; 44,1 y 48 kHz): con notas, la salida y
//      la del filtro son finitas, y después el patch «Bajo gordo» suena.
//   2  Fuzz determinista (semilla fija, 60 s) con Mod → Filtro: notas, acordes,
//      ruedas, macros, Osc3, voz: salida finita y al final suena.
//   3  En el navegador, el ladder de antes de F2d (BASE, lineal y sin guarda) y el
//      de ahora corren lado a lado dentro del worklet sobre la misma entrada (el
//      grafo recibe el de antes). Los 7 presets con notas, ruedas y macros, la
//      condición dirigida y el fuzz del caso 2: con el de ahora la guarda se
//      activa 0 veces, la salida es finita y |out4| no pasa de la cota
//      demostrable (1,7e14 con la entrada ≤ 7); control: el de antes diverge en
//      la condición dirigida.
//   4  En Node, 1500 tomas al azar (corte, contorno y modulación hasta frecuencia
//      de audio, entrada hasta 6,3; semilla fija): con el de ahora, 0 activaciones,
//      salida finita y |out4| bajo la cota; con RESO 0 (realimentación 0) la
//      salida es la misma bit a bit que con el de F2d (BASE_F2D); control: el de
//      antes de F2d diverge en al menos 20.
//
//   node tools/tests/monomoon-ladder.test.mjs          # ~3 min
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const FILE = 'descargables/MonoMoon70.html';
const URL_PATH = '/' + FILE;
const BASE = '22fb1d2';       // main antes de la guarda (F2d): realimentación lineal, sin guarda
const BASE_F2D = '70a916a';   // main con la guarda de F2d, antes de la realimentación saturada (F2e)
/* Cota demostrable de |out4| con la realimentación saturada: |x| ≤ (I + 3,86)·0,35013·f⁴ con
   f ≤ 1,148, cada etapa tiene ganancia ≤ 1,3/(1 − máx|1−f|) = 1,3/0,00058 (f ≥ 1,16·0,0005):
   |out4| ≤ (1,3/0,00058)⁴ · 0,609 · (I + 3,86) ≈ 1,54e13·(I + 3,86). */
const bound = (I) => Math.pow(1.3 / (1.16 * 0.0005), 4) * 0.35013 * Math.pow(1.16 * 0.99, 4) * (I + 4 * 0.965);

const moogOf = (html) => { const m = html.match(/const MOOG_WORKLET = `([\s\S]*?)`;/); if (!m) throw new Error('no encontré MOOG_WORKLET'); return m[1]; };
const NOW = moogOf(readFileSync(join(ROOT, FILE), 'utf8'));
let OLD = null, F2D = null;
try {
  OLD = moogOf(execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  F2D = moogOf(execFileSync('git', ['-C', ROOT, 'show', `${BASE_F2D}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
} catch (e) { OLD = null; F2D = null; }
const PRESETS = ['Bajo gordo', 'Sub redondo', 'Lead filoso', 'Pad cálido', 'Órgano hueco', 'Auto-wah (osc3 LFO)', 'Resonante zumbón'];

/* Antes de la página: sampleRate, tap de la salida y medidor (no finitas, pico,
   RMS por medio segundo). Con `twin`, 'moog-ladder' es el par antes/ahora. */
const INIT = ({ sr, twin }) => {
  if (sr) { const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { super(Object.assign({}, o, { sampleRate: sr })); } }; }
  if (twin) {
    const add = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, ...rest) {
      let txt = ''; try { txt = await (await fetch(url)).text(); } catch (e) {}
      if (txt.includes("registerProcessor('moog-ladder'")) url = URL.createObjectURL(new Blob([twin], { type: 'application/javascript' }));
      return add.call(this, url, ...rest);
    };
  }
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = conn.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) { const c = dest.context; if (!c.__tap) c.__tap = c.createGain(); conn.call(this, c.__tap); }
    return r;
  };
  const CODE = `registerProcessor('mm-meter', class extends AudioWorkletProcessor {
    constructor(){ super(); this.bad = 0; this.w = []; this.ss = 0; this.n = 0; this.t0 = currentTime;
      this.port.onmessage = () => this.port.postMessage({ bad: this.bad, w: this.w }); }
    process(inp){ const ch = inp[0] || [];
      for (const d of ch) for (let i = 0; i < d.length; i++) { const v = d[i]; if (!(v - v === 0)) { this.bad++; continue; } this.ss += v * v; this.n++; }
      if (currentTime - this.t0 >= 0.25) { this.w.push([currentTime, this.n ? Math.sqrt(this.ss / this.n) : 0]); this.ss = 0; this.n = 0; this.t0 = currentTime; }
      return true; } });`;
  window.__meters = {};
  window.__meter = async (c, node, id) => {
    if (!c.__mm) c.__mm = c.audioWorklet.addModule(URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' })));
    await c.__mm;
    const m = new AudioWorkletNode(c, 'mm-meter'); const mute = c.createGain(); mute.gain.value = 0;
    conn.call(node, m); conn.call(m, mute); conn.call(mute, c.destination); window.__meters[id] = m;
  };
  window.__read = (id) => new Promise((ok) => { const m = window.__meters[id]; m.port.onmessage = (e) => ok(e.data); m.port.postMessage(0); });
};
/* Los mismos caminos que la UI (Knob.set, Wheel.set, los interruptores, kbd). */
const HELPERS = () => {
  const K = { cutoff: () => MAC.cutoff, res: () => MAC.res, env: () => MAC.env, vol: () => MAC.vol, glide: () => MAC.glide, modmix: () => REG.knob.k_modmix, f2: () => REG.knob.f2, d2: () => REG.knob.d2 };
  window.__fz = {
    knob(k, n) { const kn = K[k](); kn.set(kn._denorm(n)); },
    wheel(w, v) { REG.wheels[w].set(v); },
    tog(id, on) { const t = document.getElementById(id); if ((t.dataset.on === '1') !== on) t.click(); },
    preset(n) { const s = document.getElementById('presetSel'); s.value = n; s.onchange(); },
    voice(m) { document.querySelector('#voiceSeg button[data-m="' + m + '"]').click(); },
    press(id, m, ms) { kbd.press(id, m, null, 100); if (ms) setTimeout(() => kbd.release(id), ms); },
    /** Mod → Filtro con el Osc3 como fuente. foot: índice del knob Rango del Osc3 (0 = LO … 5 = 2'). */
    filtmod({ res, foot, wheel }) { this.tog('filtModTog', true); this.tog('osc3KbdTog', true); this.knob('modmix', 0); REG.knob.f2.set(foot); this.wheel('mod', wheel); this.knob('res', res); },
  };
};

/* Caso 3: 'moog-ladder' corre el de antes (A) y el de ahora (B) como objetos,
   una muestra por vez con los mismos valores, y entrega A. En B se cuentan las
   activaciones de la guarda y el máximo de |out4|. */
function twinSource(oldCode, newCode) {
  const plain = (code) => code.replace('class MoogLadder extends AudioWorkletProcessor', 'class MoogLadder extends __P').replace("registerProcessor('moog-ladder', MoogLadder);", 'return MoogLadder;');
  const counted = newCode.replace(/if\(!Number\.isFinite\(this\.out4\)\)\{/, '$&this.__g=(this.__g||0)+1;');
  if (counted === newCode) throw new Error('no encontré la guarda en el ladder de ahora');
  const desc = newCode.match(/static get parameterDescriptors\(\)\{\s*return (\[[\s\S]*?\]);\s*\}/)[1];
  return `
class __P { constructor(){ this.port = {}; } }
const A = (function(){ ${plain(oldCode)} })(), B = (function(){ ${plain(counted)} })();
registerProcessor('moog-ladder', class extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return ${desc}; }
  constructor(){ super(); this.a = new A(); this.b = new B();
    this.i = [[new Float32Array(1)]]; this.oa = [[new Float32Array(1)]]; this.ob = [[new Float32Array(1)]];
    this.p = { cutoff: new Float32Array(1), cutoffMod: new Float32Array(1), resonance: new Float32Array(1) };
    this.d = { n: 0, firstGuard: -1, guards: 0, aBadState: -1, bBad: 0, bMax: 0 };
    this.port.onmessage = () => this.port.postMessage(this.d); }
  process(inputs, outputs, params){
    const o = outputs[0][0]; if (!o) return true;
    const x = inputs[0][0], d = this.d, cA = params.cutoff, mA = params.cutoffMod;
    this.p.resonance[0] = params.resonance[0];
    for (let n = 0; n < o.length; n++) {
      const fr = currentFrame + n;
      this.p.cutoff[0] = cA.length === 1 ? cA[0] : cA[n]; this.p.cutoffMod[0] = mA.length === 1 ? mA[0] : mA[n];
      const inp = x ? (this.i[0][0][0] = x[n], this.i) : [[]];
      this.a.process(inp, this.oa, this.p); this.b.process(inp, this.ob, this.p);
      const ya = this.oa[0][0][0], yb = this.ob[0][0][0], g = this.b.__g || 0;
      if (g > d.guards) { d.guards = g; if (d.firstGuard < 0) d.firstGuard = fr; }
      if (d.aBadState < 0 && !Number.isFinite(this.a.out4)) d.aBadState = fr;
      if (!(yb - yb === 0)) d.bBad++;
      if (Math.abs(this.b.out4) > d.bMax) d.bMax = Math.abs(this.b.out4);
      d.n++;
      o[n] = ya;
    }
    return true;
  }
});`;
}

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

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

async function open({ sr = 0, twin = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(INIT, { sr, twin });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.click('#powerOvl');
  await page.waitForFunction(() => typeof engine !== 'undefined' && engine.ready && engine.ctx.state === 'running', null, { timeout: 10000 });
  await page.evaluate(async () => { await window.__meter(engine.ctx, engine.ctx.__tap, 'out'); await window.__meter(engine.ctx, engine.filter.output, 'filt'); });
  await page.evaluate(HELPERS);
  return { ctx, page, errors };
}
async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}
/** Control: Bajo gordo sin modulación, una nota de 700 ms → RMS de la salida. */
async function control(page) {
  await page.evaluate(() => { clearAllKeys(); __fz.wheel('mod', 0); __fz.preset('Bajo gordo'); __fz.voice('mono'); });
  await page.waitForTimeout(400);
  const t0 = await page.evaluate(() => { __fz.press('ctl', 48, 700); return engine.ctx.currentTime; });
  await page.waitForTimeout(950);
  const w = (await page.evaluate(() => window.__read('out'))).w.filter(([t]) => t > t0 + 0.25 && t <= t0 + 0.75);
  return dB(Math.sqrt(w.reduce((a, [, r]) => a + r * r, 0) / Math.max(1, w.length)));
}
/** Acordes y notas sueltas durante `secs` s (secuencia fija). */
async function play(page, secs) {
  const seq = [[48, 52, 55], [60], [41, 44, 53], [72, 76], [36], [65, 69, 72], [57]];
  const t0 = Date.now(); let k = 0;
  while (Date.now() - t0 < secs * 1000) {
    const ch = seq[k % seq.length], ms = 180 + (k * 137) % 420;
    await page.evaluate(([c, t, k2]) => c.forEach((m, j) => __fz.press('p' + k2 + '_' + j, m, t)), [ch, ms, k]);
    await page.waitForTimeout(ms + 60); k++;
  }
}

// ─────────────── 1 · Mod → Filtro con el Osc3 a frecuencia de audio ───────────────

test('1 · Mod → Filtro con el Osc3 a frecuencia de audio (24 configuraciones): salida finita y después «Bajo gordo» suena', async () => {
  const cases = [];
  for (const sr of [44100, 48000]) for (const res of [0.32, 0.6, 0.9]) for (const foot of [5, 3]) for (const wheel of [0.7, 1]) cases.push({ sr, res, foot, wheel });
  const res = await pool(cases.map((c) => async () => {
    const { ctx, page, errors } = await open({ sr: c.sr });
    try {
      await page.evaluate((x) => __fz.filtmod(x), c);
      await play(page, 3);
      const out = await page.evaluate(() => window.__read('out')), filt = await page.evaluate(() => window.__read('filt'));
      const ctl = await control(page);
      return { c, out: out.bad, filt: filt.bad, ctl, errors };
    } finally { await ctx.close(); }
  }));
  for (const r of res) console.log(`  ${r.c.sr} Hz · RESO ${r.c.res} · Osc3 ${["LO", "32'", "16'", "8'", "4'", "2'"][r.c.foot]} · rueda ${r.c.wheel}: no finitas salida ${r.out} · filtro ${r.filt} · control ${fmt(r.ctl)} dBFS`);
  console.log(`  configuraciones con NaN: ${res.filter((r) => r.out || r.filt).length} de ${res.length}`);
  for (const r of res) {
    const k = `${r.c.sr} Hz, RESO ${r.c.res}, Osc3 ${r.c.foot}, rueda ${r.c.wheel}`;
    assert.equal(r.filt, 0, `${k}: la salida del filtro tiene muestras no finitas`);
    assert.equal(r.out, 0, `${k}: la salida tiene muestras no finitas`);
    assert.ok(r.ctl > -40, `${k}: después, «Bajo gordo» tiene que sonar (${fmt(r.ctl)} dBFS)`);
    assert.deepEqual(r.errors, []);
  }
});

// ─────────────── 2 · fuzz determinista ───────────────

async function fuzz(page, secs, seed) {
  let s = seed;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const n = () => (rnd() < 0.3 ? (rnd() < 0.5 ? 0 : 1) : rnd());
  await page.evaluate(() => __fz.filtmod({ res: 0.5, foot: 4, wheel: 0.8 }));
  const t0 = Date.now(); let id = 0;
  while (Date.now() - t0 < secs * 1000) {
    const a = rnd();
    if (a < 0.4) await page.evaluate(([i, m, ms]) => __fz.press(i, m, ms), ['z' + id++, 36 + Math.floor(rnd() * 48), 60 + Math.floor(rnd() * 700)]);
    else if (a < 0.48) { const m = 40 + Math.floor(rnd() * 36), ms = 200 + Math.floor(rnd() * 600); await page.evaluate(([b, t, i]) => [0, 4, 7].forEach((d, j) => __fz.press('c' + i + j, b + d, t)), [m, ms, id++]); }
    else if (a < 0.58) await page.evaluate((v) => __fz.wheel('mod', v), n());
    else if (a < 0.64) await page.evaluate((v) => __fz.wheel('pitch', v), rnd() * 2 - 1);
    else if (a < 0.84) await page.evaluate(([k, v]) => __fz.knob(k, v), [['cutoff', 'res', 'env', 'vol', 'glide', 'modmix', 'f2', 'd2'][Math.floor(rnd() * 8)], n()]);
    else if (a < 0.9) await page.evaluate((m) => __fz.voice(m), ['mono', 'unison', 'duo'][Math.floor(rnd() * 3)]);
    else if (a < 0.94) await page.evaluate((p) => { __fz.preset(p); __fz.tog('filtModTog', true); }, PRESETS[Math.floor(rnd() * PRESETS.length)]);
    else await page.evaluate((on) => __fz.tog('osc3KbdTog', on), rnd() < 0.7);
    await page.waitForTimeout(40 + Math.floor(rnd() * 260));
  }
}

test('2 · fuzz determinista de 60 s con Mod → Filtro (44,1 y 48 kHz): salida finita y al final suena', async () => {
  const res = await pool([44100, 48000].map((sr, i) => async () => {
    const { ctx, page, errors } = await open({ sr });
    try {
      await fuzz(page, 60, 0x6d6f6f6e + i);
      const out = await page.evaluate(() => window.__read('out')), filt = await page.evaluate(() => window.__read('filt'));
      const ctl = await control(page);
      return { sr, out: out.bad, filt: filt.bad, ctl, errors };
    } finally { await ctx.close(); }
  }));
  for (const r of res) console.log(`  ${r.sr} Hz: no finitas salida ${r.out} · filtro ${r.filt} · control ${fmt(r.ctl)} dBFS`);
  for (const r of res) {
    assert.equal(r.filt, 0, `${r.sr} Hz: la salida del filtro tiene muestras no finitas`);
    assert.equal(r.out, 0, `${r.sr} Hz: la salida tiene muestras no finitas`);
    assert.ok(r.ctl > -40, `${r.sr} Hz: al final tiene que sonar (${fmt(r.ctl)} dBFS)`);
    assert.deepEqual(r.errors, []);
  }
});

// ─────────────── 3 · en el navegador: la guarda no se activa ───────────────

test('3 · navegador: con el de ahora la guarda se activa 0 veces (presets, condición dirigida y fuzz), la salida es finita y |out4| queda bajo la cota', async (t) => {
  if (!OLD) { t.skip(`sin git o sin la base ${BASE}`); return; }
  const twin = twinSource(OLD, NOW);
  const read = (page) => page.evaluate(() => new Promise((ok) => { const n = engine.filter.node; n.port.onmessage = (e) => ok(e.data); n.port.postMessage(0); }));
  /* Una página que casi no renderizó (el worklet procesó menos de la mitad de lo que dura
     la página) es un problema del arnés, no del filtro: pasó ~1 de cada 10 corridas en F2e,
     sin errores, con el worklet en 0 muestras o cortado a los 0,4 s. Se informa y se repite
     una vez; si se repite, el caso falla. */
  const once = (fn) => async () => {
    for (let k = 1; ; k++) {
      const t0 = Date.now(), r = await fn();
      r.want = Math.round((Date.now() - t0) / 1000 * r.sr * 0.5);
      if (r.d.n >= r.want || k === 2) return r;
      console.log(`  ${r.what}: el worklet procesó ${r.d.n} muestras (esperadas ≥ ${r.want}): la página casi no renderizó, se repite`);
    }
  };
  const jobs = [];
  for (const sr of [44100, 48000]) for (const p of PRESETS) jobs.push(once(async () => {
    const { ctx, page, errors } = await open({ sr, twin });
    try {
      await page.evaluate((x) => __fz.preset(x), p);
      await page.waitForTimeout(200);
      // notas, ruedas y macros, sin tocar Mod → Filtro más allá de lo que trae el preset
      for (let k = 0; k < 6; k++) {
        await page.evaluate(([i, m]) => __fz.press('b' + i, m, 350), [k, 40 + k * 7]);
        await page.evaluate(([v, w]) => { __fz.wheel('mod', v); __fz.wheel('pitch', w); }, [(k % 3) / 2, (k % 2 ? 0.6 : -0.4)]);
        await page.evaluate(([c, r]) => { __fz.knob('cutoff', c); __fz.knob('res', r); }, [(k * 0.37) % 1, (k * 0.29) % 1]);
        await page.waitForTimeout(420);
      }
      return { what: `${p} · ${sr} Hz`, sr, d: await read(page), errors };
    } finally { await ctx.close(); }
  }));
  for (const sr of [44100, 48000]) jobs.push(once(async () => {
    const { ctx, page, errors } = await open({ sr, twin });
    try {
      // la condición dirigida de F2d: patch de fábrica + Mod → Filtro + rueda 1 + Osc3 en 2'
      await page.evaluate(() => __fz.filtmod({ res: 0.32, foot: 5, wheel: 1 }));
      await play(page, 8);
      return { what: `dirigida · ${sr} Hz`, sr, d: await read(page), errors };
    } finally { await ctx.close(); }
  }));
  for (const sr of [44100, 48000]) jobs.push(once(async () => {
    const { ctx, page, errors } = await open({ sr, twin });
    try {
      await fuzz(page, 30, 0x6d6f6f6e + sr);
      return { what: `fuzz con Mod → Filtro · ${sr} Hz`, sr, d: await read(page), errors };
    } finally { await ctx.close(); }
  }));
  const res = await pool(jobs);
  for (const r of res) {
    const d = r.d;
    console.log(`  ${r.what.padEnd(36)} ${d.n} muestras · antes de F2d: ${d.aBadState >= 0 ? 'estado no finito en el frame ' + d.aBadState : 'finito'} · ahora: guarda ${d.guards}, máx |out4| ${d.bMax.toFixed(2)}, no finitas ${d.bBad}`);
  }
  for (const r of res) {
    const d = r.d;
    assert.ok(d.n >= r.want, `${r.what}: control, el par corrió (${d.n} muestras, esperadas ≥ ${r.want})`);
    assert.equal(d.guards, 0, `${r.what}: con la realimentación saturada la guarda no se tiene que activar (${d.guards}, la primera en ${d.firstGuard})`);
    assert.equal(d.bBad, 0, `${r.what}: el ladder de ahora dio muestras no finitas`);
    assert.ok(d.bMax <= bound(7), `${r.what}: |out4| ${d.bMax} por encima de la cota ${bound(7).toExponential(2)}`);
  }
  const dir = res.filter((r) => /^dirigida/.test(r.what));
  assert.ok(dir.every((r) => r.d.aBadState >= 0), `control: en la condición dirigida el ladder de antes de F2d diverge (${dir.map((r) => r.d.aBadState).join(', ')})`);
});

// ─────────────── 4 · en Node ───────────────

function makeLadder(code, sr) {
  let C = null;
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C = c; }, sr);
  return new C();
}
/** `onLadder` recibe el objeto del worklet; se lleva en `__max` el máximo de |out4|. */
function render(code, c, onLadder) {
  const L = makeLadder(code, c.sr), B = 128, N = Math.round(c.secs * c.sr), y = new Float32Array(N);
  if (onLadder) onLadder(L);
  const inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]];
  const pr = { cutoff: new Float32Array(B), cutoffMod: new Float32Array(B), resonance: new Float32Array([c.res]) };
  let ph = 0, mph = 0;
  for (let b = 0; b * B < N; b++) {
    for (let n = 0; n < B; n++) {
      const t = (b * B + n) / c.sr;
      ph = (ph + c.f0 / c.sr) % 1; mph = (mph + c.modHz / c.sr) % 1;
      inp[0][0][n] = c.amp * (c.wave === 'saw' ? 2 * ph - 1 : c.wave === 'square' ? (ph < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(ph - 0.5));
      const env = t < c.fa ? t / c.fa : Math.exp(-(t - c.fa) / c.fd);
      const m = c.modWave === 'saw' ? 2 * mph - 1 : c.modWave === 'tri' ? 1 - 4 * Math.abs(mph - 0.5) : Math.sin(2 * Math.PI * mph);
      pr.cutoff[n] = c.cutoff; pr.cutoffMod[n] = Math.max(-12000, Math.min(12000, c.modC * m + c.contour * env));
    }
    L.process(inp, out, pr);
    if (onLadder) L.__max = Math.max(L.__max || 0, Math.abs(L.out4));   // al final de cada bloque de 128
    y.set(out[0][0].subarray(0, Math.min(B, N - b * B)), b * B);
  }
  return y;
}

test('4 · Node: 1500 tomas al azar, con el de ahora 0 activaciones de la guarda, salida finita y |out4| bajo la cota; con RESO 0, igual bit a bit al de F2d', (t) => {
  if (!OLD || !F2D) { t.skip(`sin git o sin las bases ${BASE} y ${BASE_F2D}`); return; }
  const counted = NOW.replace(/if\(!Number\.isFinite\(this\.out4\)\)\{/, '$&this.__g=(this.__g||0)+1;');
  assert.notEqual(counted, NOW, 'control: la guarda de F2d sigue en el código');
  let s = 0x4d6f6f6e;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)], logU = (a, b) => a * Math.pow(b / a, rnd());
  const tally = { runs: 0, guards: 0, nowBad: 0, maxOut4: 0, overBound: 0, oldDiv: 0, zero: 0, zeroMism: 0 };
  for (let r = 0; r < 1500; r++) {
    const c = { sr: pick([22050, 32000, 44100, 48000, 96000]), secs: 0.7, cutoff: logU(20, 18000), res: rnd() < 0.1 ? 0 : rnd() * 0.965, f0: logU(30, 2000), amp: 0.3 + rnd() * 6, wave: pick(['saw', 'square', 'tri']),
      modHz: logU(0.1, 4200), modC: rnd() < 0.3 ? 0 : rnd() * 4200, modWave: pick(['saw', 'tri', 'sin']), contour: (rnd() * 2 - 1) * 4800, fa: logU(0.001, 0.5), fd: logU(0.002, 2) };
    const L = { code: counted, ref: null };
    const b = render(L.code, c, (lad) => { L.ref = lad; });
    if (b.some((v) => !Number.isFinite(v))) tally.nowBad++;
    tally.guards += L.ref.__g || 0;
    tally.maxOut4 = Math.max(tally.maxOut4, L.ref.__max || 0);
    if ((L.ref.__max || 0) > bound(c.amp)) tally.overBound++;
    const a = render(OLD, c);
    if (a.some((v) => !Number.isFinite(v))) tally.oldDiv++;
    if (c.res === 0) {
      tally.zero++;
      const f = render(F2D, c);
      for (let i = 0; i < b.length; i++) if (!Object.is(f[i], b[i])) { tally.zeroMism++; break; }
    }
    tally.runs++;
  }
  console.log(`  ${tally.runs} tomas · ahora: guarda ${tally.guards}, no finitas ${tally.nowBad}, máx |out4| ${tally.maxOut4.toFixed(2)} (cota con la entrada ≤ 6,3: ${bound(6.3).toExponential(2)}) · antes de F2d divergían ${tally.oldDiv} · con RESO 0 (${tally.zero} tomas) distintas del de F2d: ${tally.zeroMism}`);
  assert.equal(tally.guards, 0, 'con la realimentación saturada la guarda no se tiene que activar');
  assert.equal(tally.nowBad, 0, 'ninguna toma da muestras no finitas');
  assert.equal(tally.overBound, 0, '|out4| tiene que quedar bajo la cota');
  assert.equal(tally.zeroMism, 0, 'con RESO 0 la salida es la misma que con el ladder de F2d');
  assert.ok(tally.oldDiv >= 20 && tally.zero >= 50, `control: el de antes de F2d diverge en ${tally.oldDiv} tomas; ${tally.zero} tomas con RESO 0`);
});
