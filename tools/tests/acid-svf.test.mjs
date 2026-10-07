#!/usr/bin/env node
// tools/tests/acid-svf.test.mjs
//
// Acid Bass-303: el SVF (`acid-svf`) acota el corte a 0,45 × sampleRate (F2e,
// reports/F2e.md). El corte llega a 16 kHz (CUTOFF hasta 8 kHz × la envolvente);
// con el AudioContext a menos de 32 kHz pasaba Nyquist, tan(π·fc/sr) daba
// negativo y el filtro divergía a NaN, para siempre (reports/F2d-barrido-nan.md).
//
//   1  Node, el código real de antes (BASE) y el de ahora: la grilla del barrido
//      de F2d (CUTOFF de 0 a 100 % en pasos de 5 %, con el pico de la envolvente
//      sin acento y con acento, RESO 0–100 %, LP/BP/HP) con la caída de la
//      envolvente como en trigFilter. A 44,1, 48, 88,2 y 96 kHz la salida es
//      idéntica muestra a muestra; a 32 kHz difiere solo donde el corte pasa de
//      14,4 kHz (se informa cuánto); a 22,05 y 32 kHz, siempre finita.
//   2  Navegador, el instrumento real a 44,1 y 48 kHz: el SVF de antes y el de
//      ahora corren lado a lado dentro del worklet, muestra por muestra (el grafo
//      recibe el de antes), con el secuenciador sonando, la grilla CUTOFF × RESO
//      con DRIVE y FUZZ en los extremos, y ENV MOD y ACCENT al máximo: 0 muestras
//      distintas.
//   3  Navegador a 22,05 y 32 kHz: la misma grilla con el secuenciador sonando,
//      salida finita, y al final, con CUTOFF y VOLUME al 75 %, suena.
//
//   node tools/tests/acid-svf.test.mjs          # ~1 min
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

const FILE = 'descargables/Acid_Bass-303.html';
const URL_PATH = '/' + FILE;
const BASE = '70a916a';   // main antes del tope (F2d)

const workletOf = (html) => { const m = html.match(/const WORKLET_CODE *= *`([\s\S]*?)`;/); if (!m) throw new Error('no encontré WORKLET_CODE'); return m[1]; };
const NOW = workletOf(readFileSync(join(ROOT, FILE), 'utf8'));
let OLD = null;
try { OLD = workletOf(execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 })); }
catch (e) { OLD = null; }

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

// ─────────────── 1 · Node ───────────────

function svfOf(code, sr) {
  const C = {};
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C[n] = c; }, sr);
  return new C['acid-svf']();
}
/** Una nota: el corte salta al pico y cae exponencial a la base en `dec` s (trigFilter), sierra de 55 Hz. */
function render(code, sr, { base, peak, res, mode, dec }) {
  const L = svfOf(code, sr), B = 128, N = Math.round(0.6 * sr), y = new Float32Array(N);
  const inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]];
  const pr = { cutoff: new Float32Array(B), resonance: new Float32Array([res]), mode: new Float32Array([mode]) };
  let ph = 0;
  for (let b = 0; b * B < N; b++) {
    for (let n = 0; n < B; n++) {
      const t = (b * B + n) / sr; ph = (ph + 55 / sr) % 1; inp[0][0][n] = 0.8 * (2 * ph - 1);
      pr.cutoff[n] = Math.fround(t < dec ? peak * Math.pow(base / peak, t / dec) : base);   // exponentialRamp
    }
    L.process(inp, out, pr);
    y.set(out[0][0].subarray(0, Math.min(B, N - b * B)), b * B);
  }
  return y;
}
const CUT_MIN = 40, CUT_MAX = 8000, cutoffHz = (k) => CUT_MIN * Math.pow(CUT_MAX / CUT_MIN, k);
function grid() {
  const out = [];
  for (let i = 0; i <= 20; i++) for (const mult of [1, 3.39, 9.33]) for (const res of [0, 0.25, 0.5, 0.75, 1]) for (const mode of [0, 1, 2]) {
    const base = Math.max(30, Math.min(16000, cutoffHz(i / 20)));
    out.push({ base, peak: Math.max(30, Math.min(16000, base * mult)), res, mode, dec: 0.3 });
  }
  return out;
}

test('1 · Node: idéntico a 44,1 · 48 · 88,2 · 96 kHz en la grilla de F2d; a 32 kHz difiere solo con el corte sobre 14,4 kHz; a 22,05 y 32 kHz, finito', (t) => {
  if (!OLD) { t.skip(`sin git o sin la base ${BASE}`); return; }
  const G = grid();
  for (const sr of [44100, 48000, 88200, 96000]) {
    let mism = 0, cases = 0;
    for (const c of G) { const a = render(OLD, sr, c), b = render(NOW, sr, c); cases++; for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) { mism++; break; } }
    console.log(`  ${sr} Hz · ${cases} tomas · con alguna muestra distinta: ${mism}`);
    assert.equal(mism, 0, `${sr} Hz: la salida tiene que ser idéntica muestra a muestra`);
  }
  {
    const sr = 32000, cap = 0.45 * sr; let diff = 0, wrong = 0, worst = -Infinity, worstC = null, oldBad = 0;
    for (const c of G) {
      const a = render(OLD, sr, c), b = render(NOW, sr, c);
      let d = 0, ss = 0, s2 = 0; for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i])) oldBad++; const e = b[i] - a[i]; if (!Object.is(a[i], b[i])) d++; ss += e * e; s2 += a[i] * a[i]; }
      for (const v of b) assert.ok(Number.isFinite(v), `32 kHz: ${JSON.stringify(c)} da no finitos`);
      if (d) { diff++; if (c.peak <= cap) wrong++; const rel = 10 * Math.log10(ss / s2); if (rel > worst) { worst = rel; worstC = c; } }
    }
    console.log(`  32000 Hz · ${G.length} tomas · distintas: ${diff} (todas con el pico del corte > ${cap} Hz: ${wrong === 0}) · la mayor diferencia, RMS de (ahora − antes) contra la señal: ${fmt(worst)} dB en ${JSON.stringify(worstC && { base: Math.round(worstC.base), peak: Math.round(worstC.peak), res: worstC.res, mode: worstC.mode })} · antes no finitas: ${oldBad}`);
    assert.equal(wrong, 0, '32 kHz: solo cambian las tomas en que el corte pasa del tope');
  }
  {
    const sr = 22050; let oldBad = 0, nowBad = 0;
    for (const c of G) {
      const a = render(OLD, sr, c), b = render(NOW, sr, c);
      if (a.some((v) => !Number.isFinite(v))) oldBad++;
      if (b.some((v) => !Number.isFinite(v))) nowBad++;
    }
    console.log(`  22050 Hz · ${G.length} tomas · no finitas antes: ${oldBad} · ahora: ${nowBad}`);
    assert.equal(nowBad, 0, '22,05 kHz: ninguna toma no finita');
    assert.ok(oldBad > 0, 'control: antes había tomas no finitas a 22,05 kHz');
  }
});

// ─────────────── navegador ───────────────

/* Antes de la página: sampleRate fijo, medidor de la salida (no finitas, RMS) y,
   con `twin`, el worklet de Acid con 'acid-svf' corriendo el de antes y el de
   ahora lado a lado. */
const INIT = ({ sr, twin }) => {
  if (sr) { const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { super(Object.assign({}, o, { sampleRate: sr })); window.__ctx = this; } }; }
  if (twin) {
    const add = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, ...rest) {
      let txt = ''; try { txt = await (await fetch(url)).text(); } catch (e) {}
      if (txt.includes("registerProcessor('acid-svf'")) url = URL.createObjectURL(new Blob([twin], { type: 'application/javascript' }));
      return add.call(this, url, ...rest);
    };
  }
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = conn.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) { const c = dest.context; if (!c.__tap) c.__tap = c.createGain(); conn.call(this, c.__tap); }
    return r;
  };
  const CODE = `registerProcessor('svf-meter', class extends AudioWorkletProcessor {
    constructor(){ super(); this.bad = 0; this.w = []; this.ss = 0; this.n = 0; this.t0 = currentTime;
      this.port.onmessage = () => this.port.postMessage({ bad: this.bad, w: this.w }); }
    process(inp){ const ch = inp[0] || [];
      for (const d of ch) for (let i = 0; i < d.length; i++) { const v = d[i]; if (!(v - v === 0)) { this.bad++; continue; } this.ss += v * v; this.n++; }
      if (currentTime - this.t0 >= 0.25) { this.w.push([currentTime, this.n ? Math.sqrt(this.ss / this.n) : 0]); this.ss = 0; this.n = 0; this.t0 = currentTime; }
      return true; } });`;
  window.__meterOn = async (c) => {
    if (!c.__tap) c.__tap = c.createGain();
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' })));
    const m = new AudioWorkletNode(c, 'svf-meter'); const mute = c.createGain(); mute.gain.value = 0;
    conn.call(c.__tap, m); conn.call(m, mute); conn.call(mute, c.destination); window.__m = m;
  };
  window.__read = () => new Promise((ok) => { window.__m.port.onmessage = (e) => ok(e.data); window.__m.port.postMessage(0); });
};

/* El módulo de Acid con 'acid-svf' = el de antes (A) y el de ahora (B) como objetos, una muestra por vez. */
function twinSource(oldCode, newCode) {
  const scope = (code, into) => `(function(){ const AudioWorkletProcessor = class { constructor(){ this.port = {}; } }; const registerProcessor = (n, c) => { ${into}[n] = c; }; ${code} })();`;
  const real = `(function(){ const registerProcessor = (n, c) => { if (n !== 'acid-svf') globalThis.registerProcessor(n, c); }; ${newCode} })();`;
  return `const __A = {}, __B = {};
${scope(oldCode, '__A')}
${scope(newCode, '__B')}
${real}
registerProcessor('acid-svf', class extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return __B['acid-svf'].parameterDescriptors; }
  constructor(){ super(); this.a = new __A['acid-svf'](); this.b = new __B['acid-svf']();
    this.i = [[new Float32Array(1)]]; this.oa = [new Float32Array(1)]; this.ob = [new Float32Array(1)];
    this.p = { cutoff: new Float32Array(1), resonance: new Float32Array(1), mode: new Float32Array(1) };
    this.d = { n: 0, mism: 0, first: -1, over: 0 };
    this.port.onmessage = () => this.port.postMessage(this.d); }
  process(inputs, outputs, params){
    const out = outputs[0]; if (!out || !out.length) return true;
    const o = out[0], x = inputs[0] && inputs[0].length ? inputs[0][0] : null, cut = params.cutoff, d = this.d;
    this.p.resonance[0] = params.resonance[0]; this.p.mode[0] = params.mode[0];
    for (let n = 0; n < o.length; n++) {
      this.p.cutoff[0] = cut.length === 1 ? cut[0] : cut[n];
      if (this.p.cutoff[0] > 0.45 * sampleRate) d.over++;
      const inp = x ? (this.i[0][0][0] = x[n], this.i) : [[]];
      this.a.process(inp, [this.oa], this.p); this.b.process(inp, [this.ob], this.p);
      const ya = this.oa[0][0], yb = this.ob[0][0];
      if (!Object.is(ya, yb)) { d.mism++; if (d.first < 0) d.first = currentFrame + n; }
      d.n++; o[n] = ya;
    }
    for (let c = 1; c < out.length; c++) out[c].set(o);
    return true;
  }
});`;
}

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

async function open({ sr, twin = null }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT, { sr, twin });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.click('#playBtn');
  await page.waitForFunction(() => Engine.started && Engine.ctx.state === 'running' && Seq.playing, null, { timeout: 10000 });
  await page.evaluate(() => window.__meterOn(Engine.ctx));
  return { ctx, page, errors };
}
/** La grilla de F2d (CUTOFF × RESO, DRIVE y FUZZ en los extremos) y después ENV MOD y ACCENT al máximo. */
async function sweep(page) {
  for (const a of [0, 0.25, 0.5, 0.75, 1]) for (const b of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate(([c, r, x]) => { setParam('cutoff', c); setParam('reso', r); setParam('drive', x); setParam('fuzz', x); }, [a, b, (a + b) % 1 > 0.5 ? 1 : 0]);
    await page.waitForTimeout(260);
  }
  await page.evaluate(() => { setParam('envmod', 1); setParam('accent', 1); setParam('decay', 1); });
  for (const a of [0.6, 0.8, 1]) for (const m of [0, 1, 2]) {
    await page.evaluate(([c, mm]) => { setParam('cutoff', c); setModeUI(mm); }, [a, m]);
    await page.waitForTimeout(400);
  }
}

test('2 · navegador a 44,1 y 48 kHz: el SVF de antes y el de ahora, lado a lado en el instrumento, dan las mismas muestras', async (t) => {
  if (!OLD) { t.skip(`sin git o sin la base ${BASE}`); return; }
  const twin = twinSource(OLD, NOW);
  const res = await Promise.all([44100, 48000].map(async (sr) => {
    const { ctx, page, errors } = await open({ sr, twin });
    try {
      await sweep(page);
      const d = await page.evaluate(() => new Promise((ok) => { const n = Engine.filtU.input; n.port.onmessage = (e) => ok(e.data); n.port.postMessage(0); }));
      return { sr, d, type: await page.evaluate(() => Engine.filtU.type), errors };
    } finally { await ctx.close(); }
  }));
  for (const r of res) console.log(`  ${r.sr} Hz · filtro ${r.type} · ${r.d.n} muestras · distintas ${r.d.mism} · muestras con el corte sobre 0,45·sr: ${r.d.over}`);
  for (const r of res) {
    assert.equal(r.type, 'worklet', 'control: el filtro es el worklet');
    assert.ok(r.d.n > r.sr * 8, 'control: el par corrió');
    assert.equal(r.d.mism, 0, `${r.sr} Hz: muestras distintas (la primera en el frame ${r.d.first})`);
    assert.deepEqual(r.errors, []);
  }
});

test('3 · navegador a 22,05 y 32 kHz: la grilla con el secuenciador sonando da salida finita y al final suena', async () => {
  const res = await Promise.all([22050, 32000].map(async (sr) => {
    const { ctx, page, errors } = await open({ sr });
    try {
      await sweep(page);
      await page.evaluate(() => { setParam('cutoff', 0.75); setParam('volume', 0.75); setParam('reso', 0.62); setModeUI(0); });
      const t0 = await page.evaluate(() => Engine.ctx.currentTime);
      await page.waitForTimeout(2000);
      const m = await page.evaluate(() => window.__read());
      const end = m.w.filter(([tt]) => tt > t0 + 0.25);
      const rms = dB(Math.sqrt(end.reduce((a, [, r]) => a + r * r, 0) / Math.max(1, end.length)));
      return { sr, bad: m.bad, rms, actual: await page.evaluate(() => Engine.ctx.sampleRate), errors };
    } finally { await ctx.close(); }
  }));
  for (const r of res) console.log(`  ${r.actual} Hz · no finitas ${r.bad} · al final ${fmt(r.rms)} dBFS`);
  for (const r of res) {
    assert.equal(r.actual, r.sr, 'control: el contexto corre a esa frecuencia');
    assert.equal(r.bad, 0, `${r.sr} Hz: la salida tiene muestras no finitas`);
    assert.ok(r.rms > -40, `${r.sr} Hz: al final tiene que sonar (${fmt(r.rms)} dBFS)`);
    assert.deepEqual(r.errors, []);
  }
});
