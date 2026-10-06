#!/usr/bin/env node
// tools/tests/j4-ladder.test.mjs
//
// J4-Sirens Station: el filtro ladder no da NaN (F2d, ver reports/F2d.md).
// Antes, con el corte por encima de ~0,19 × sampleRate (≈ 8,4 kHz a 44,1 kHz,
// ≈ 9,3 kHz a 48 kHz) y la resonancia alta, el estado s3 pasaba √12: ahí la
// saturación cúbica s3 − s3³/6 deja de acotar y el estado crecía hasta Infinity
// y NaN en ~12 muestras. El NaN quedaba en el estado del filtro, pasaba al eco y
// a la reverb y J4 quedaba mudo hasta recargar. Acid Scream llega ahí con la
// envolvente (500 → 8550 Hz, RESO 1,08); con cualquier patch alcanza con llevar
// el pad XY (X = CUTOFF, Y = RESO) a la esquina de arriba a la derecha.
//
//   1  Acid Scream, 52 tomas de SIREN (4 páginas × 13, a 44,1 kHz, con
//      sostenidos y pausas distintos): salida finita en cada toma, cada toma suena
//      (RMS de la nota > −30 dBFS) y, después, Police Alarm suena. Se mide la
//      guarda desde afuera (una sonda en la salida del filtro: la muestra en 0
//      exacto después de una distinta de 0): cuántas veces se activa y cuánto
//      tarda el filtro en volver (< 50 ms). El clic, comparado contra tomas sin
//      activación, se mide en reports/F2d-ladder.mjs --only clic.
//   2  Barrido determinista (semilla fija) de CUTOFF, RESO y DRIVE con notas, en
//      el patch de fábrica y los 6 presets, a 44,1 y 48 kHz (más los extremos):
//      la salida es siempre finita y al final J4 suena.
//   3  Bit a bit, en el navegador: el ladder del commit base y el de ahora corren
//      lado a lado dentro del worklet, muestra por muestra sobre la misma entrada
//      y los mismos parámetros (el grafo recibe el de antes). Los 7 patches con
//      notas a 44,1 y 48 kHz y el barrido del caso 2: toda muestra anterior a la
//      primera activación de la guarda es idéntica, y la guarda solo se activa
//      en una toma que con el código de antes llegaba a un valor no finito
//      (dentro de las 64 muestras siguientes).
//   4  Bit a bit, sin navegador: el código de los dos worklets en Node, con
//      entradas como las de J4 (drive 1, entrada de hasta 2: oscilador + ruido
//      en el cruce de modos), 6 frecuencias de muestreo y trayectorias de corte
//      con envolvente y LFO (semilla fija): las tomas que antes quedaban finitas
//      dan la misma salida bit a bit; las que divergían quedan finitas.
//
//   node tools/tests/j4-ladder.test.mjs          # ~4 min
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

const FILE = 'descargables/J4-Sirens_Station.html';
const URL_PATH = '/' + FILE;
const BASE = '22fb1d2';   // main antes de la guarda del ladder (F2c)

const ladderOf = (html) => { const m = html.match(/const LADDER_CODE = `([\s\S]*?)`;/); if (!m) throw new Error('no encontré LADDER_CODE'); return m[1]; };
const NOW = ladderOf(readFileSync(join(ROOT, FILE), 'utf8'));
let OLD = null;
try { OLD = ladderOf(execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 })); }
catch (e) { OLD = null; }

const PRESETS = ['Classic Wail', 'Police Alarm', 'Acid Scream', 'UFO Random', 'Cosmic Drone', 'Feedback Dub'];
const PATCHES = ['fábrica', ...PRESETS];

/* Antes de la página: sampleRate fijo, tap de la salida y medidor por bloque
   (pico, RMS y muestras no finitas), y la sonda 'zd-lad' (salida del filtro y
   de J4, para medir la guarda). Con `twin`, el worklet 'ladder' se reemplaza
   por el par antes/ahora del caso 3. */
const INIT = ({ sr, twin }) => {
  if (sr) {
    const AC = window.AudioContext;
    window.AudioContext = class extends AC { constructor(o) { super(Object.assign({}, o, { sampleRate: sr })); } };
  }
  if (twin) {
    const add = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, ...rest) {
      let txt = ''; try { txt = await (await fetch(url)).text(); } catch (e) {}
      if (txt.includes("registerProcessor('ladder'")) url = URL.createObjectURL(new Blob([twin], { type: 'application/javascript' }));
      return add.call(this, url, ...rest);
    };
  }
  const conn = AudioNode.prototype.connect;
  window.__conn = conn;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = conn.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) { const c = dest.context; if (!c.__tap) c.__tap = c.createGain(); conn.call(this, c.__tap); }
    return r;
  };
  const CODE = `registerProcessor('zd-meter', class extends AudioWorkletProcessor {
    constructor(){ super(); this.b = []; }
    process(inp){ const ch = inp[0] || []; let pk = 0, ss = 0, n = 0, bad = 0;
      for (const d of ch) { for (let i = 0; i < d.length; i++) { const v = d[i]; if (!(v - v === 0)) { bad++; continue; } const a = v < 0 ? -v : v; if (a > pk) pk = a; ss += v * v; } n += d.length; }
      this.b.push(currentTime, pk, n ? ss / n : 0, bad);
      if (this.b.length >= 64) { this.port.postMessage(this.b); this.b = []; } return true; } });
  /* Sonda de la guarda: entrada 0 = salida del filtro, entrada 1 = salida de J4.
     Activación = una muestra en 0 exacto después de una finita distinta de 0. */
  registerProcessor('zd-lad', class extends AudioWorkletProcessor {
    constructor(){ super(); this.R = 8192; this.f = new Float32Array(this.R); this.o = new Float32Array(this.R); this.i = 0; this.prev = 0; this.pend = [];
      this.ms = sampleRate / 1000; this.badF = 0; this.badO = 0; this.ev = [];
      this.port.onmessage = () => this.port.postMessage({ ev: this.ev, badF: this.badF, badO: this.badO }); }
    win(buf, a, b) { const R = this.R, out = []; for (let k = a; k < b; k++) out.push(buf[((k % R) + R) % R]); return out; }
    rms(a) { let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); }
    process(inp){
      const f = inp[0] && inp[0][0], o = inp[1] && inp[1][0], ms = this.ms;
      for (let n = 0; n < 128; n++) {
        const y = f ? f[n] : 0, z = o ? o[n] : 0, i = this.i++;
        this.f[i % this.R] = y; this.o[i % this.R] = z;
        if (!(y - y === 0)) this.badF++; if (!(z - z === 0)) this.badO++;
        if (y === 0 && this.prev !== 0 && this.prev - this.prev === 0) this.pend.push({ i, t: (currentFrame + n) / sampleRate });
        this.prev = y;
        for (let k = this.pend.length - 1; k >= 0; k--) {
          const e = this.pend[k]; if (i < e.i + Math.round(40 * ms)) continue;
          this.pend.splice(k, 1);
          const pre = this.win(this.f, e.i - Math.round(5 * ms), e.i), last = this.f[(e.i - 1) % this.R];
          const ref = this.rms(pre); let back = -1;
          for (let s = e.i + 1; s + ms <= e.i + 40 * ms; s++) if (this.rms(this.win(this.f, s, s + Math.round(ms))) >= ref / 2) { back = (s + ms - e.i) / ms; break; }
          const step = (a) => { let m = 0; for (let s = 1; s < a.length; s++) m = Math.max(m, Math.abs(a[s] - a[s - 1])); return m; };
          const opre = this.win(this.o, e.i - Math.round(20 * ms), e.i), opost = this.win(this.o, e.i, e.i + Math.round(20 * ms));
          const oref = this.rms(this.win(this.o, e.i - Math.round(10 * ms), e.i)); let dip = 0;
          for (let s = e.i; s + ms <= e.i + 30 * ms; s += Math.round(ms / 4)) dip = Math.min(dip, 20 * Math.log10(Math.max(1e-12, this.rms(this.win(this.o, s, s + Math.round(ms)))) / Math.max(1e-12, oref)));
          let opk = 0; for (const v of opost) opk = Math.max(opk, Math.abs(v));
          this.ev.push({ t: e.t, last, ref, back, stepPre: step(opre), stepPost: step(opost), peakPost: opk, dip });
        }
      }
      return true; }
  });`;
  window.__m = []; window.__mLast = -1;
  window.__meterOn = async (c) => {
    if (!c.__tap) c.__tap = c.createGain();
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' })));
    const node = new AudioWorkletNode(c, 'zd-meter'); const mute = c.createGain(); mute.gain.value = 0;
    conn.call(c.__tap, node); conn.call(node, mute); conn.call(mute, c.destination);
    node.port.onmessage = (e) => { const a = e.data; for (let i = 0; i < a.length; i++) window.__m.push(a[i]); window.__mLast = a[a.length - 4]; };
  };
  window.__ladOn = (c, filt) => {
    const node = new AudioWorkletNode(c, 'zd-lad', { numberOfInputs: 2, numberOfOutputs: 1 }); const mute = c.createGain(); mute.gain.value = 0;
    conn.call(filt, node, 0, 0); conn.call(c.__tap, node, 0, 1); conn.call(node, mute); conn.call(mute, c.destination);
    window.__lad = node;
  };
  window.__win = (t0, t1) => { let pk = 0, ss = 0, n = 0, bad = 0; const m = window.__m; for (let i = 0; i < m.length; i += 4) if (m[i] >= t0 && m[i] < t1) { pk = Math.max(pk, m[i + 1]); ss += m[i + 2]; n++; bad += m[i + 3]; } return { pk, rms: n ? Math.sqrt(ss / n) : 0, bad, n }; };
  window.__bad = () => { let b = 0; const m = window.__m; for (let i = 3; i < m.length; i += 4) b += m[i]; return b; };
};

/* Caso 3: el worklet 'ladder' corre el código de antes (A) y el de ahora (B)
   como objetos, una muestra por vez con los mismos valores, y entrega A. */
function twinSource(oldCode, newCode) {
  const plain = (code) => code.replace('class Ladder extends AudioWorkletProcessor', 'class Ladder extends __P').replace("registerProcessor('ladder',Ladder);", 'return Ladder;');
  const counted = newCode.replace(/if\(!\(Math\.abs\(this\.s\[3\]\)<=SQ12\)\)\{/, '$&this.__g=(this.__g||0)+1;');
  if (counted === newCode) throw new Error('no encontré la guarda en el ladder de ahora');
  const desc = newCode.match(/static get parameterDescriptors\(\)\{return (\[[\s\S]*?\]);\}/)[1];
  return `
class __P { constructor(){ this.port = {}; } }
const A = (function(){ ${plain(oldCode)} })(), B = (function(){ ${plain(counted)} })();
const SQ = Math.sqrt(12);
registerProcessor('ladder', class extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return ${desc}; }
  constructor(){ super(); this.a = new A(); this.b = new B();
    this.ia = [[new Float32Array(1)]]; this.ib = [[new Float32Array(1)]]; this.oa = [[new Float32Array(1)]]; this.ob = [[new Float32Array(1)]];
    this.pa = { cutoff: new Float32Array(1), reso: new Float32Array(1), drive: new Float32Array(1) };
    this.d = { n: 0, firstGuard: -1, guards: 0, firstMism: -1, mism: 0, mismBeforeGuard: 0, aBad: -1, aOver: -1, bBad: 0 };
    this.port.onmessage = () => this.port.postMessage(this.d); }
  process(inp, outp, pr){
    const o = outp[0] && outp[0][0]; if (!o) return true;
    const x = inp[0] && inp[0][0], d = this.d, cA = pr.cutoff, rA = pr.reso;
    this.pa.drive[0] = pr.drive[0];
    for (let n = 0; n < o.length; n++) {
      const fr = currentFrame + n;
      this.pa.cutoff[0] = cA.length > 1 ? cA[n] : cA[0]; this.pa.reso[0] = rA.length > 1 ? rA[n] : rA[0];
      if (x) { this.ia[0][0][0] = x[n]; this.ib[0][0][0] = x[n]; }
      this.a.process(x ? this.ia : [[]], this.oa, this.pa); this.b.process(x ? this.ib : [[]], this.ob, this.pa);
      const ya = this.oa[0][0][0], yb = this.ob[0][0][0], g = this.b.__g || 0;
      if (g > d.guards) { d.guards = g; if (d.firstGuard < 0) d.firstGuard = fr; }
      if (d.aOver < 0 && Math.abs(ya) > SQ) d.aOver = fr;
      if (d.aBad < 0 && !(ya - ya === 0)) d.aBad = fr;
      if (!(yb - yb === 0)) d.bBad++;
      if (!Object.is(ya, yb)) { d.mism++; if (d.firstMism < 0) d.firstMism = fr; if (d.firstGuard < 0) d.mismBeforeGuard++; }
      d.n++;
      o[n] = ya;
    }
    return true;
  }
});`;
}

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');
let seed = 0;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.click('#power');
  await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
  await page.evaluate(() => window.__meterOn(ctx));
  return { ctx, page, errors };
}
async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}
/** Una nota de `hold` ms, `pause` ms de silencio; → RMS y pico de la nota, no finitos en toda la toma. */
async function take(page, hold, pause) {
  const tOn = await page.evaluate(() => { noteOn('pad', 57); return ctx.currentTime; });
  await page.waitForTimeout(hold);
  const tOff = await page.evaluate(() => { noteOff('pad'); return ctx.currentTime; });
  await page.waitForTimeout(pause);
  const tEnd = await page.evaluate(() => ctx.currentTime);
  await page.waitForFunction((x) => window.__mLast >= x, tEnd, { timeout: 10000 });
  const on = await page.evaluate(([a, b]) => window.__win(a, b), [tOn + 0.05, tOff]);
  const all = await page.evaluate(([a, b]) => window.__win(a, b), [tOn, tEnd]);
  return { rms: dB(on.rms), bad: all.bad };
}
/** Control al final: Police Alarm, una nota de 600 ms. */
async function control(page) {
  await page.evaluate(() => applyPatch(FACTORY['Police Alarm']));
  await page.waitForTimeout(300);
  return take(page, 600, 300);
}

// ─────────────── 1 · Acid Scream, 52 tomas ───────────────

/* Las 52 tomas se corren una vez; los casos 1 y 1b miran lo mismo. */
let acid = null;
const acidRuns = () => acid || (acid = pool(Array.from({ length: 4 }, (_, pi) => async () => {
  const { ctx, page, errors } = await open({ sr: 44100 });
  try {
    await page.evaluate(() => { applyPatch(FACTORY['Acid Scream']); window.__ladOn(ctx, filter); });
    await page.waitForTimeout(500);
    const takes = [];
    for (let t = 0; t < 13; t++) takes.push(await take(page, 250 + ((t * 377 + pi * 131) % 950), 150 + ((t * 619 + pi * 71) % 1350)));
    const ctl = await control(page);
    await page.waitForTimeout(100);
    const lad = await page.evaluate(() => new Promise((ok) => { const n = window.__lad; n.port.onmessage = (e) => ok(e.data); n.port.postMessage(0); }));
    return { takes, ctl, lad, errors, sr: await page.evaluate(() => ctx.sampleRate) };
  } finally { await ctx.close(); }
})));

test('1 · Acid Scream, 52 tomas de SIREN a 44,1 kHz: salida finita, cada toma suena y después Police Alarm suena', async () => {
  const res = await acidRuns();
  let failed = 0;
  res.forEach((r, pi) => {
    const f = r.takes.filter((x) => x.bad || !(x.rms > -30)).length; failed += f;
    console.log(`  página ${pi + 1} (${r.sr} Hz): ${r.takes.map((x) => (x.bad ? 'NaN' : fmt(x.rms, 1))).join(' ')} · tomas fallidas ${f} · control Police Alarm ${r.ctl.bad ? 'NaN' : fmt(r.ctl.rms, 1) + ' dBFS'}`);
  });
  console.log(`  tomas fallidas (no finitas o mudas): ${failed} de ${res.length * 13}`);
  for (const r of res) {
    assert.equal(r.sr, 44100, 'control: el contexto corre a 44,1 kHz');
    r.takes.forEach((x, i) => {
      assert.equal(x.bad, 0, `toma ${i + 1}: la salida tiene muestras no finitas`);
      assert.ok(x.rms > -30, `toma ${i + 1}: J4 no suena (${fmt(x.rms)} dBFS)`);
    });
    assert.ok(r.ctl.bad === 0 && r.ctl.rms > -30, `después de las tomas, Police Alarm tiene que sonar (${r.ctl.bad ? 'NaN' : fmt(r.ctl.rms) + ' dBFS'})`);
    assert.deepEqual(r.errors, []);
  }
});

test('1b · la guarda en esas 52 tomas: activaciones y el filtro vuelve en < 50 ms', async () => {
  const res = await acidRuns();
  for (const r of res) assert.equal(r.lad.badF, 0, 'la salida del filtro no tiene muestras no finitas');
  const ev = res.flatMap((r) => r.lad.ev);
  console.log(`  activaciones de la guarda: ${ev.length} en ${res.length * 13} tomas (${res.map((r) => r.lad.ev.length).join(' + ')})`);
  // el clic, contra tomas sin activación en el mismo momento de la nota: reports/F2d-ladder.mjs --only clic
  for (const e of ev) console.log(`    t ${e.t.toFixed(3)} s · filtro: última muestra ${e.last.toFixed(3)} → 0, vuelve a −6 dB del RMS previo en ${fmt(e.back, 2)} ms · salida de J4 en los 20 ms siguientes: escalón máx. ${fmt(dB(e.stepPost), 1)} dBFS, pico ${fmt(dB(e.peakPost), 1)} dBFS`);
  if (ev.length) console.log(`  peor vuelta del filtro ${fmt(Math.max(...ev.map((e) => e.back)), 2)} ms`);
  ev.forEach((e) => assert.ok(e.back >= 0 && e.back < 50, `t ${e.t}: el filtro tiene que volver en < 50 ms (${e.back} ms)`));
});

// ─────────────── 2 · barrido determinista ───────────────

const KNOB = { cutoff: [30, 12000], reso: [0, 1.15], drive: [1, 8] };
/** Pasos del barrido: los extremos y 26 al azar (semilla por patch y sampleRate). */
function steps(name, sr) {
  seed = 0x9e3779b9 ^ (PATCHES.indexOf(name) * 7919) ^ sr;
  const out = [
    { cutoff: 12000, reso: 1.15, drive: 8 }, { cutoff: 12000, reso: 0, drive: 1 }, { cutoff: 30, reso: 1.15, drive: 8 },
    { cutoff: 9000, reso: 0.62, drive: 1.6 }, { cutoff: 8550, reso: 1.08, drive: 1.6 },
  ];
  for (let i = 0; i < 26; i++) out.push({
    cutoff: Math.round(KNOB.cutoff[0] * Math.pow(KNOB.cutoff[1] / KNOB.cutoff[0], rnd())),
    reso: +(rnd() * KNOB.reso[1]).toFixed(3), drive: +(1 + rnd() * 7).toFixed(2),
  });
  return out;
}
async function sweep(name, sr, twin = null) {
  const { ctx, page, errors } = await open({ sr, twin });
  try {
    await page.evaluate((n) => { if (n !== 'fábrica') applyPatch(FACTORY[n]); }, name);
    await page.waitForTimeout(300);
    const list = steps(name, sr), bad = [];
    for (const s of list) {
      await page.evaluate((p) => applyPatch(p), s);
      const r = await take(page, 160, 90);
      if (r.bad) bad.push(s);
    }
    const ctl = await control(page);
    return { name, sr, n: list.length, bad, ctl, total: await page.evaluate(() => window.__bad()), errors, page, ctx };
  } catch (e) { await ctx.close(); throw e; }
}

test('2 · barrido determinista de CUTOFF, RESO y DRIVE en los 7 patches a 44,1 y 48 kHz: salida siempre finita y J4 sigue sonando', async () => {
  const jobs = [];
  for (const sr of [44100, 48000]) for (const n of PATCHES) jobs.push(async () => { const r = await sweep(n, sr); await r.ctx.close(); return r; });
  const res = await pool(jobs);
  for (const r of res) console.log(`  ${r.name.padEnd(13)} ${r.sr} Hz · ${r.n} pasos · no finitas: ${r.total}${r.bad.length ? ' · primer paso con NaN ' + JSON.stringify(r.bad[0]) : ''} · control ${r.ctl.bad ? 'NaN' : fmt(r.ctl.rms) + ' dBFS'}`);
  for (const r of res) {
    assert.equal(r.total, 0, `${r.name} a ${r.sr} Hz: la salida tiene muestras no finitas (primer paso: ${JSON.stringify(r.bad[0])})`);
    assert.ok(r.ctl.rms > -30, `${r.name} a ${r.sr} Hz: al final J4 tiene que sonar (${fmt(r.ctl.rms)} dBFS)`);
    assert.deepEqual(r.errors, []);
  }
});

// ─────────────── 3 · bit a bit en el navegador ───────────────

test('3 · bit a bit: antes de la primera activación de la guarda, el ladder de ahora da lo mismo que el de antes; la guarda solo se activa donde el de antes divergía', async (t) => {
  if (!OLD) { t.skip(`sin git o sin la base ${BASE}`); return; }
  const twin = twinSource(OLD, NOW);
  const jobs = [];
  // los 7 patches con 6 notas de largo y pausa distintos
  for (const sr of [44100, 48000]) for (const n of PATCHES) jobs.push(async () => {
    const { ctx, page, errors } = await open({ sr, twin });
    try {
      await page.evaluate((x) => { if (x !== 'fábrica') applyPatch(FACTORY[x]); }, n);
      await page.waitForTimeout(300);
      for (let k = 0; k < 6; k++) await take(page, 200 + k * 130, 120 + k * 90);
      const d = await page.evaluate(() => new Promise((ok) => { filter.port.onmessage = (e) => ok(e.data); filter.port.postMessage(0); }));
      return { what: `${n} · ${sr} Hz · notas`, d, errors };
    } finally { await ctx.close(); }
  });
  // el barrido del caso 2 en 3 patches
  for (const sr of [44100, 48000]) for (const n of ['fábrica', 'Acid Scream', 'Cosmic Drone']) jobs.push(async () => {
    const r = await sweep(n, sr, twin);
    try {
      const d = await r.page.evaluate(() => new Promise((ok) => { filter.port.onmessage = (e) => ok(e.data); filter.port.postMessage(0); }));
      return { what: `${n} · ${sr} Hz · barrido`, d, errors: r.errors };
    } finally { await r.ctx.close(); }
  });
  const res = await pool(jobs);
  let stable = 0, div = 0;
  for (const r of res) {
    const d = r.d, diverged = d.aBad >= 0;
    if (diverged) div++; else stable++;
    console.log(`  ${r.what.padEnd(32)} ${d.n} muestras · antes: ${diverged ? 'no finito en el frame ' + d.aBad + ' (pasó √12 en ' + d.aOver + ')' : 'finito'} · guarda: ${d.guards ? d.guards + ' (primera en ' + d.firstGuard + ')' : '0'} · distintas antes de la guarda: ${d.mismBeforeGuard} · ahora no finitas: ${d.bBad}`);
  }
  console.log(`  ${stable} páginas en las que el ladder de antes quedó finito, ${div} en las que divergió`);
  for (const r of res) {
    const d = r.d;
    assert.ok(d.n > 0, `${r.what}: control, el par corrió`);
    assert.equal(d.mismBeforeGuard, 0, `${r.what}: ${d.mismBeforeGuard} muestras distintas antes de la primera activación de la guarda (primera en ${d.firstMism})`);
    assert.equal(d.bBad, 0, `${r.what}: el ladder de ahora dio muestras no finitas`);
    if (d.aBad < 0) assert.equal(d.guards, 0, `${r.what}: con el de antes finito la guarda no se puede activar`);
    if (d.firstGuard >= 0) assert.ok(d.aBad >= d.firstGuard && d.aBad - d.firstGuard <= 64, `${r.what}: la primera activación (${d.firstGuard}) tiene que caer en una divergencia del de antes (no finito en ${d.aBad})`);
    assert.deepEqual(r.errors, []);
  }
  assert.ok(stable >= 10, `control: al menos 10 páginas sin divergencia para comparar (${stable})`);
});

// ─────────────── 4 · bit a bit sin navegador ───────────────

function makeLadder(code, sr) {
  let C = null;
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C = c; }, sr);
  return new C();
}
function render(code, c) {
  const L = makeLadder(code, c.sr), BS = 128, N = Math.round(c.secs * c.sr), y = new Float32Array(N);
  const inp = [[new Float32Array(BS)]], out = [[new Float32Array(BS)]];
  const pr = { cutoff: new Float32Array(BS), reso: new Float32Array(BS), drive: new Float32Array([1]) };
  let ph = 0, nz = 0x2545f491;
  for (let b = 0; b * BS < N; b++) {
    for (let n = 0; n < BS; n++) {
      const t = (b * BS + n) / c.sr;
      let fc = c.cutoff;
      for (const g of c.gates) if (t >= g.on && t < g.off) { const a = c.atk; fc = t - g.on < a ? c.cutoff + (c.peak - c.cutoff) * (t - g.on) / a : c.cutoff + (c.peak - c.cutoff) * Math.exp(-(t - g.on - a) / c.tau); }
      pr.cutoff[n] = Math.max(20, Math.min(16000, fc + c.fLfo * Math.sin(2 * Math.PI * c.fLfoHz * t)));
      pr.reso[n] = c.reso;
      ph = (ph + Math.max(1, c.f0 * (1 + c.vib * Math.sin(2 * Math.PI * 5 * t))) / c.sr) % 1;
      nz ^= nz << 13; nz ^= nz >>> 17; nz ^= nz << 5;
      const osc = c.wave === 'saw' ? 2 * ph - 1 : c.wave === 'square' ? (ph < 0.5 ? 1 : -1) : c.wave === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * ph);
      inp[0][0][n] = c.amp * osc + c.noise * ((nz >>> 0) / 2147483648 - 1);
    }
    L.process(inp, out, pr);
    y.set(out[0][0].subarray(0, Math.min(BS, N - b * BS)), b * BS);
  }
  return y;
}

test('4 · bit a bit en Node: 1200 tomas como las de J4 (drive 1, entrada hasta 2), 6 sampleRates: las finitas, idénticas; las que divergían, finitas', (t) => {
  if (!OLD) { t.skip(`sin git o sin la base ${BASE}`); return; }
  seed = 0x51f15e;
  const pick = (a) => a[Math.floor(rnd() * a.length)], logU = (a, b) => a * Math.pow(b / a, rnd());
  const tally = { runs: 0, stable: 0, div: 0, mism: 0, nowBad: 0 }, bySr = {};
  for (let r = 0; r < 1200; r++) {
    const sr = pick([22050, 32000, 44100, 48000, 88200, 96000]);
    const near = rnd() < 0.5;   // la mitad, con el pico del corte cerca de la frontera (0,17–0,23 × sr)
    const cutoff = near && rnd() < 0.5 ? Math.min(12000, sr * (0.17 + rnd() * 0.06)) : logU(30, 12000);
    const peak = near ? Math.min(12000, sr * (0.17 + rnd() * 0.06)) : Math.max(30, Math.min(12000, cutoff + (rnd() * 2 - 1) * 12000));
    const both = rnd() < 0.15;  // oscilador + ruido (cruce de modos): hasta 2
    const c = { sr, secs: 0.8, cutoff, peak, reso: rnd() * 1.15, atk: logU(0.001, 0.5), tau: logU(0.005, 1), wave: pick(['saw', 'square', 'triangle', 'sine']),
      amp: both ? 1 : 0.3 + rnd() * 0.7, noise: both ? rnd() : (rnd() < 0.2 ? 0.3 + rnd() * 0.7 : 0), f0: logU(30, 2000), vib: rnd() < 0.5 ? 0 : rnd() * 0.5,
      fLfo: rnd() < 0.7 ? 0 : rnd() * 4500, fLfoHz: logU(0.02, 30), gates: [{ on: 0.05, off: 0.05 + rnd() * 0.4 }, { on: 0.5, off: 0.5 + rnd() * 0.25 }] };
    const a = render(OLD, c), b = render(NOW, c);
    let aBad = false, mism = 0, bBad = 0;
    for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i])) aBad = true; if (!Number.isFinite(b[i])) bBad++; if (!Object.is(a[i], b[i])) mism++; }
    const s = (bySr[sr] ||= { runs: 0, div: 0 }); s.runs++;
    tally.runs++; if (aBad) { tally.div++; s.div++; } else { tally.stable++; if (mism) tally.mism++; }
    if (bBad) tally.nowBad++;
  }
  console.log(`  ${tally.runs} tomas · antes finitas ${tally.stable} (con alguna muestra distinta: ${tally.mism}) · antes divergían ${tally.div} (ahora no finitas: ${tally.nowBad}) · divergían por sampleRate: ${Object.entries(bySr).map(([k, v]) => `${k} ${v.div}/${v.runs}`).join(', ')}`);
  assert.equal(tally.mism, 0, 'las tomas que antes quedaban finitas tienen que dar la misma salida bit a bit');
  assert.equal(tally.nowBad, 0, 'ninguna toma da muestras no finitas con el ladder de ahora');
  assert.ok(tally.div >= 100 && tally.stable >= 600, `control: hay tomas de los dos tipos (${tally.div} divergían, ${tally.stable} no)`);
});
