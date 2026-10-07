#!/usr/bin/env node
// reports/F2d-ladder.mjs — mediciones del ladder de J4 para reports/F2d.md. No es
// un test (los tests están en tools/tests/j4-ladder.test.mjs).
//
//   diag    el ladder de antes (22fb1d2) instrumentado en el navegador: en qué
//           variable aparece el primer valor no finito, con qué parámetros, y la
//           historia de s3 hasta ahí. Acid Scream a 44,1 y 48 kHz (4 páginas × 13
//           tomas cada una) y el pad XY en la esquina (patch de fábrica, CUTOFF
//           12 kHz, RESO 0,62, sin tocar ninguna nota).
//   mapa    en Node, con el código real: dónde diverge con el corte fijo
//           (CUTOFF × RESO, sierra de 220 Hz, 1 s) a 44,1 y 48 kHz.
//   umbral  en Node: ¿hay tomas que pasan √12 y vuelven solas? Con drive 1
//           (el de J4) y la entrada de 0,3 a 4, y con drive 4–8: cuántas, y la
//           menor amplitud de entrada × drive con la que aparece una.
//   zona    en Node, con el código de ahora: el corte quieto en la zona de
//           divergencia (el pad XY en la esquina): activaciones por segundo y
//           nivel de la salida del filtro.
//   clic    la guarda en el navegador: Acid Scream con la nota en un frame fijo y
//           la salida de J4 y la del filtro grabadas desde 5 ms antes hasta 60 ms
//           después; tomas con activación contra tomas sin activación.
//
//   node reports/F2d-ladder.mjs                 # todo (~5 min)
//   node reports/F2d-ladder.mjs --only mapa,umbral
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('only', 'diag,mapa,umbral,zona,clic').split(',');
const FILE = 'descargables/J4-Sirens_Station.html', BASE = '22fb1d2';
const ladderOf = (html) => html.match(/const LADDER_CODE = `([\s\S]*?)`;/)[1];
const OLD = ladderOf(execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const NOW = ladderOf(readFileSync(join(ROOT, FILE), 'utf8'));
const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

/* ─────────────── el ladder de antes, instrumentado (solo lee) ─────────────── */
const DIAG = OLD
  .replace('constructor(){super();', 'constructor(){super();this.__d={maxU:0,hist:[],bad:null,ep:null};this.port.onmessage=()=>this.port.postMessage(this.__d);')
  .replace('this.s[3]=this.s[3]-(this.s[3]*this.s[3]*this.s[3])/6; // sigmoide band-limited', `const __u=this.s[3];
        this.s[3]=this.s[3]-(this.s[3]*this.s[3]*this.s[3])/6; // sigmoide band-limited
        { const D=this.__d, au=Math.abs(__u);
          if(!D.bad){ D.hist.push(+__u.toPrecision(4)); if(D.hist.length>16) D.hist.shift();
            if(au>D.maxU) D.maxU=au;
            if(!D.ep && !(au<=3.4641016151377544)) D.ep={frame:currentFrame+n, fc, res, dr, f, k, p, r, xin:(inc?inc[n]:0), x, s:[this.s[0],this.s[1],this.s[2]], u:__u};
            const v={x, s0:this.s[0], s1:this.s[1], s2:this.s[2], u:__u, y:this.s[3]};
            for(const kk in v) if(!Number.isFinite(v[kk])){ D.bad={var:kk, frame:currentFrame+n, t:(currentFrame+n)/sr, fc, res, dr, f, k, p, r, xin:(inc?inc[n]:0), sr, hist:D.hist.slice(), ep:D.ep}; break; }
            if(D.ep && au<=3.4641016151377544 && !D.bad){ D.recup=(D.recup||0)+1; D.ep=null; } } }`);
if (DIAG === OLD) throw new Error('no pude instrumentar el ladder');

const INIT = ({ sr, code }) => {
  if (sr) { const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o) { super(Object.assign({}, o, { sampleRate: sr })); } }; }
  if (code) {
    const add = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, ...rest) {
      let txt = ''; try { txt = await (await fetch(url)).text(); } catch (e) {}
      if (txt.includes("registerProcessor('ladder'")) url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
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
  const CAP = `registerProcessor('cap2', class extends AudioWorkletProcessor {
    constructor(){ super(); this.q = null; this.port.onmessage = (e) => { const n = e.data.n; this.q = { f0: e.data.f0, a: new Float32Array(n), b: new Float32Array(n), k: 0 }; }; }
    process(inp){ const q = this.q; if (!q) return true;
      const a = inp[0] && inp[0][0], b = inp[1] && inp[1][0];
      for (let i = 0; i < 128 && q.k < q.a.length; i++) { if (currentFrame + i < q.f0) continue; q.a[q.k] = a ? a[i] : 0; q.b[q.k] = b ? b[i] : 0; q.k++; }
      if (q.k === q.a.length) { this.port.postMessage({ a: q.a, b: q.b }, [q.a.buffer, q.b.buffer]); this.q = null; }
      return true; } });`;
  window.__capOn = async (c, filt) => {
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([CAP], { type: 'application/javascript' })));
    const n = new AudioWorkletNode(c, 'cap2', { numberOfInputs: 2 }); const m = c.createGain(); m.gain.value = 0;
    conn.call(filt, n, 0, 0); conn.call(c.__tap, n, 0, 1); conn.call(n, m); conn.call(m, c.destination);
    return (f0, len) => new Promise((ok) => { n.port.onmessage = (e) => ok({ filt: Array.from(e.data.a), out: Array.from(e.data.b) }); n.port.postMessage({ f0, n: len }); });
  };
};

let srv, browser;
async function open({ sr = 0, code = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(INIT, { sr, code });
  const page = await ctx.newPage();
  await page.goto(srv.origin + '/' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.click('#power');
  await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
  return { ctx, page };
}
const diagOf = (page) => page.evaluate(() => new Promise((ok) => { filter.port.onmessage = (e) => ok(e.data); filter.port.postMessage(0); }));
async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

async function diag() {
  const jobs = [];
  for (const sr of [44100, 48000]) for (let pi = 0; pi < 4; pi++) jobs.push(async () => {
    const { ctx, page } = await open({ sr, code: DIAG });
    try {
      await page.evaluate(() => applyPatch(FACTORY['Acid Scream']));
      await page.waitForTimeout(400);
      let takes = 0;
      for (let t = 0; t < 13; t++) {
        await page.evaluate(() => noteOn('pad', 57)); await page.waitForTimeout(250 + ((t * 377 + pi * 131) % 950));
        await page.evaluate(() => noteOff('pad')); await page.waitForTimeout(150 + ((t * 619 + pi * 71) % 1350));
        takes++;
        if ((await diagOf(page)).bad) break;
      }
      return { what: `Acid Scream · ${sr} Hz · página ${pi + 1}`, takes, d: await diagOf(page) };
    } finally { await ctx.close(); }
  });
  for (const sr of [44100, 48000]) jobs.push(async () => {
    const { ctx, page } = await open({ sr, code: DIAG });
    try {
      await page.evaluate(() => applyPatch({ cutoff: 12000, reso: 0.62 }));   // el pad XY arriba a la derecha (X = CUTOFF, Y = RESO)
      await page.waitForTimeout(1500);
      return { what: `fábrica · pad en la esquina (12 kHz, RESO 0,62) sin notas · ${sr} Hz`, takes: 0, d: await diagOf(page) };
    } finally { await ctx.close(); }
  });
  const res = await pool(jobs);
  console.log('── diag: el ladder de antes, instrumentado');
  for (const r of res) {
    const b = r.d.bad;
    if (!b) { console.log(`   ${r.what}: finito en ${r.takes} tomas · max|s3| antes de la sigmoide ${r.d.maxU.toFixed(3)} · excursiones sobre √12 que volvieron solas: ${r.d.recup || 0}`); continue; }
    const e = b.ep;
    console.log(`   ${r.what}: primer no finito en ${b.var} (toma ${r.takes}), frame ${b.frame} · fc ${b.fc.toFixed(0)} Hz, RESO ${b.res.toFixed(3)}, drive del ladder ${b.dr}, f ${b.f.toFixed(4)}, k ${b.k.toFixed(4)}, p ${b.p.toFixed(4)}, r ${b.r.toFixed(3)} · entrada ${b.xin.toFixed(3)}`);
    if (e) console.log(`     pasó √12 ${b.frame - e.frame} muestras antes: fc ${e.fc.toFixed(0)} Hz, k ${e.k.toFixed(4)}, r ${e.r.toFixed(3)}, x ${e.x} (recortada a ±3), s0..s2 ${e.s.map((v) => v.toFixed(3)).join(' ')}, s3 ${e.u.toFixed(3)}`);
    console.log(`     s3 (antes de la sigmoide), últimas muestras: ${b.hist.join(' → ')}`);
    console.log(`     excursiones sobre √12 que volvieron solas antes: ${r.d.recup || 0} · max|s3| sin contar la divergencia: hasta ${r.d.maxU.toExponential(2)}`);
  }
}

/* ─────────────── Node: el código real ─────────────── */
function makeLadder(code, sr) {
  let C = null;
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C = c; }, sr);
  return new C();
}
function renderStatic(code, sr, fc, res, secs = 1) {
  const L = makeLadder(code, sr), B = 128, N = Math.round(secs * sr);
  const inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]], pr = { cutoff: new Float32Array([fc]), reso: new Float32Array([res]), drive: new Float32Array([1]) };
  let ph = 0, mx = 0;
  for (let b = 0; b * B < N; b++) {
    for (let n = 0; n < B; n++) { ph = (ph + 220 / sr) % 1; inp[0][0][n] = 0.8 * (2 * ph - 1); }
    L.process(inp, out, pr);
    for (const v of out[0][0]) { if (!Number.isFinite(v)) return { bad: true }; mx = Math.max(mx, Math.abs(v)); }
  }
  return { bad: false, mx };
}
function mapa() {
  const fcs = [6000, 7000, 7500, 8000, 8250, 8500, 8750, 9000, 9250, 9500, 10000, 11000, 12000];
  const ress = [0, 0.2, 0.35, 0.5, 0.62, 0.8, 1.0, 1.08, 1.15];
  for (const sr of [44100, 48000]) {
    console.log(`── mapa: ${sr} Hz, corte fijo, sierra de 220 Hz (0,8), 1 s · ✕ = NaN con el ladder de antes · número = max|salida| (finito)`);
    console.log('   CUTOFF \\ RESO ' + ress.map((r) => String(r).padStart(6)).join(''));
    for (const fc of fcs) console.log('   ' + String(fc).padStart(13) + ' ' + ress.map((r) => { const x = renderStatic(OLD, sr, fc, r); return x.bad ? '     ✕' : x.mx.toFixed(2).padStart(6); }).join(''));
  }
}
function umbral() {
  let s = 0x7a11;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const logU = (a, b) => a * Math.pow(b / a, rnd());
  const run = (drive, amp) => {
    const sr = [44100, 48000][Math.floor(rnd() * 2)], cutoff = rnd() < 0.5 ? sr * (0.17 + rnd() * 0.06) : logU(30, 12000);
    const peak = Math.min(12000, sr * (0.15 + rnd() * 0.1)), res = rnd() * 1.15, f0 = logU(30, 2000), atk = logU(0.001, 0.3), tau = logU(0.01, 1), wave = Math.floor(rnd() * 4);
    const go = (code) => {
      const L = makeLadder(code, sr), B = 128, N = Math.round(0.8 * sr), y = new Float32Array(N);
      const inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]], pr = { cutoff: new Float32Array(B), reso: new Float32Array([res]), drive: new Float32Array([drive]) };
      let ph = 0;
      for (let b = 0; b * B < N; b++) {
        for (let n = 0; n < B; n++) {
          const t = (b * B + n) / sr; ph = (ph + f0 / sr) % 1;
          const fc = t < 0.05 ? cutoff : (t - 0.05 < atk ? cutoff + (peak - cutoff) * (t - 0.05) / atk : cutoff + (peak - cutoff) * Math.exp(-(t - 0.05 - atk) / tau));
          pr.cutoff[n] = Math.max(20, Math.min(16000, fc));
          inp[0][0][n] = amp * (wave === 0 ? 2 * ph - 1 : wave === 1 ? (ph < 0.5 ? 1 : -1) : wave === 2 ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * ph));
        }
        L.process(inp, out, pr); y.set(out[0][0].subarray(0, Math.min(B, N - b * B)), b * B);
      }
      return y;
    };
    const a = go(OLD), b = go(NOW);
    let aBad = false, mism = 0; for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i])) aBad = true; if (!Object.is(a[i], b[i])) mism++; }
    return { aBad, mism, c: { sr, cutoff: Math.round(cutoff), peak: Math.round(peak), res: +res.toFixed(3), f0: Math.round(f0), drive, amp } };
  };
  console.log('── umbral: ¿pasa √12 y vuelve solo? (el ladder de antes queda finito y la guarda cambia la salida)');
  const rows = [['drive 1 · entrada 0,3–1 (J4)', 1, 0.3, 1, 1500], ['drive 1 · entrada 1–2', 1, 1, 2, 1500], ['drive 1 · entrada 2–4', 1, 2, 4, 1000], ['drive 4–8 · entrada 0,3–1', 0, 0.3, 1, 1000]];
  for (const [label, drive, a0, a1, n] of rows) {
    let div = 0, stable = 0, changed = 0, minProd = Infinity, ex = null;
    for (let i = 0; i < n; i++) {
      const dr = drive || 4 + rnd() * 4, amp = a0 + rnd() * (a1 - a0), r = run(dr, amp);
      if (r.aBad) div++; else { stable++; if (r.mism) { changed++; if (dr * amp < minProd) { minProd = dr * amp; ex = r.c; } } }
    }
    console.log(`   ${label.padEnd(28)} ${n} tomas · divergían ${div} · finitas ${stable} · finitas que la guarda cambia: ${changed}${ex ? ` · menor entrada × drive ${minProd.toFixed(2)} (${JSON.stringify(ex)})` : ''}`);
  }
}

function zona() {
  const code = NOW.replace('if(!(Math.abs(this.s[3])<=SQ12)){', 'if(!(Math.abs(this.s[3])<=SQ12)){ this.__g=(this.__g||0)+1;');
  if (code === NOW) throw new Error('no encontré la guarda');
  console.log('── zona: el corte quieto, sierra de 220 Hz (0,8), 2 s (se mide el segundo)');
  for (const sr of [44100, 48000]) for (const [fc, res] of [[8000, 0.62], [8600, 0.62], [9000, 0.62], [9600, 0.62], [12000, 0.62], [12000, 1.15], [8550, 1.08]]) {
    const L = makeLadder(code, sr), B = 128, N = sr * 2, inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]];
    const pr = { cutoff: new Float32Array([fc]), reso: new Float32Array([res]), drive: new Float32Array([1]) };
    let ph = 0, ss = 0, n = 0, pk = 0;
    for (let b = 0; b * B < N; b++) {
      for (let i = 0; i < B; i++) { ph = (ph + 220 / sr) % 1; inp[0][0][i] = 0.8 * (2 * ph - 1); }
      L.process(inp, out, pr);
      if (b * B > sr) for (const v of out[0][0]) { ss += v * v; n++; pk = Math.max(pk, Math.abs(v)); }
    }
    console.log(`   ${sr} Hz · corte ${fc} Hz · RESO ${res}: ${((L.__g || 0) / 2).toFixed(0)} activaciones por segundo · salida del filtro RMS ${fmt(dB(Math.sqrt(ss / n)))} dB, pico ${pk.toFixed(2)}`);
  }
}

/* ─────────────── el clic ─────────────── */
async function clic() {
  const all = await pool(Array.from({ length: 4 }, (_, pi) => async () => {
    const { ctx, page } = await open({ sr: 44100 });
    try {
      await page.evaluate(() => applyPatch(FACTORY['Acid Scream']));
      await page.evaluate(async () => { window.__cap = await window.__capOn(ctx, filter); });
      await page.waitForTimeout(400);
      const out = [];
      for (let t = 0; t < 13; t++) {
        const sr = 44100, T = await page.evaluate(() => Math.ceil((ctx.currentTime + 0.25) * ctx.sampleRate / 128) * 128 / ctx.sampleRate);
        await page.evaluate(([t0, n]) => { window.__got = window.__cap(t0, n); }, [Math.round((T - 0.005) * sr), Math.round(0.065 * sr)]);
        await page.waitForFunction((x) => ctx.currentTime > x - 0.1, T, { timeout: 5000 });
        await page.evaluate((x) => { Object.defineProperty(ctx, 'currentTime', { configurable: true, get: () => x }); try { noteOn('pad', 57); } finally { delete ctx.currentTime; } }, T);
        const hold = 250 + ((t * 377 + pi * 131) % 950);
        await page.waitForTimeout(hold);
        await page.evaluate(() => noteOff('pad'));
        const g = await page.evaluate(() => window.__got);
        await page.waitForTimeout(150 + ((t * 619 + pi * 71) % 1350));
        out.push(g);
      }
      return out;
    } finally { await ctx.close(); }
  }));
  const sr = 44100, pre = Math.round(0.005 * sr), ms = sr / 1000;
  const takes = all.flat().map((g) => {
    const ev = []; for (let i = 1; i < g.filt.length; i++) if (g.filt[i] === 0 && g.filt[i - 1] !== 0) ev.push(i);
    const step = (a, i0, i1) => { let m = 0; for (let i = Math.max(1, i0); i < Math.min(a.length, i1); i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
    const rms = (a, i0, i1) => { let s = 0, n = 0; for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { s += a[i] * a[i]; n++; } return n ? Math.sqrt(s / n) : 0; };
    const env = []; for (let k = 0; k < 60; k++) env.push(rms(g.out, Math.round(pre + k * ms), Math.round(pre + (k + 1) * ms)));
    const fenv = []; for (let k = 0; k < 60; k++) fenv.push(rms(g.filt, Math.round(pre + k * ms), Math.round(pre + (k + 1) * ms)));
    return { ev: ev.map((i) => (i - pre) / ms), last: ev.map((i) => g.filt[i - 1]), stepOut: step(g.out, pre, Math.round(pre + 60 * ms)), stepFilt: step(g.filt, pre, Math.round(pre + 60 * ms)), env, fenv, peak: Math.max(...g.out.slice(pre).map(Math.abs)) };
  });
  const withEv = takes.filter((t) => t.ev.length), without = takes.filter((t) => !t.ev.length);
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
  console.log(`── clic: ${takes.length} tomas de Acid Scream a 44,1 kHz con la nota en un frame fijo · con activación ${withEv.length}, sin ${without.length}`);
  console.log(`   activaciones (ms después de la nota): ${withEv.map((t) => t.ev.map((x) => x.toFixed(2)).join('+')).join(' · ')} · última muestra del filtro antes del 0: ${withEv.flatMap((t) => t.last).map((x) => x.toFixed(2)).join(' ')}`);
  const row = (label, a) => console.log(`   ${label.padEnd(18)} escalón máx. entre muestras en la salida (0–60 ms): mediana ${fmt(dB(med(a.map((t) => t.stepOut))))} · máx. ${fmt(dB(Math.max(...a.map((t) => t.stepOut))))} dBFS · en el filtro: mediana ${fmt(med(a.map((t) => t.stepFilt)), 2)} · pico de la salida: mediana ${fmt(dB(med(a.map((t) => t.peak))))} dBFS`);
  if (withEv.length) row('con activación', withEv);
  if (without.length) row('sin activación', without);
  const curve = (a, key) => Array.from({ length: 30 }, (_, k) => dB(Math.sqrt(a.reduce((s, t) => s + t[key][k] * t[key][k], 0) / a.length)));
  if (withEv.length && without.length) {
    const cw = curve(withEv, 'env'), co = curve(without, 'env'), fw = curve(withEv, 'fenv'), fo = curve(without, 'fenv');
    console.log('   RMS por ms después de la nota (dBFS):  ms   salida con / sin activación (Δ)   filtro con / sin activación (Δ)');
    for (let k = 0; k < 30; k++) console.log(`     ${String(k).padStart(2)}  ${fmt(cw[k]).padStart(7)} ${fmt(co[k]).padStart(7)} (${fmt(cw[k] - co[k]).padStart(5)})     ${fmt(fw[k]).padStart(7)} ${fmt(fo[k]).padStart(7)} (${fmt(fw[k] - fo[k]).padStart(5)})`);
    const worst = Math.min(...cw.map((v, k) => v - co[k]).slice(0, 20)), best = Math.max(...cw.map((v, k) => v - co[k]).slice(0, 20));
    console.log(`   salida, 0–20 ms: diferencia por ms entre ${fmt(worst)} y ${fmt(best)} dB`);
  }
}

srv = await serveRoot(ROOT);
const { chromium } = await loadPlaywright();
browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  if (ONLY.includes('mapa')) mapa();
  if (ONLY.includes('umbral')) umbral();
  if (ONLY.includes('zona')) zona();
  if (ONLY.includes('diag')) await diag();
  if (ONLY.includes('clic')) await clic();
} finally { await browser.close(); await srv.close(); }
