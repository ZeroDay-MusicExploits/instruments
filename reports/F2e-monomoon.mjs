#!/usr/bin/env node
// reports/F2e-monomoon.mjs — MonoMoon con la realimentación saturada (F2e,
// reports/F2e.md): acotación y cuánto cambia el sonido. No es un test.
//
//   cota     Node, el worklet de antes (BASE: la guarda de F2d, realimentación
//            lineal) y el de ahora (realimentación con tanh) sobre las mismas
//            entradas: fuzz determinista con RESO 0–1, el Osc3 de 1 Hz a 4 kHz en
//            sus 6 ondas, rueda Mod 0–1, corte base de 100 Hz a 18 kHz, contorno
//            y sampleRate 22,05 · 32 · 44,1 · 48 · 96 kHz, con la entrada de
//            los osciladores hasta su máximo (3 + unison 3 + ruido 1 = 7). Por toma:
//            max |out4|, activaciones de la guarda y el tramo más largo con la
//            salida clavada (ventanas de 10 ms con ≥ 90 % de las muestras en
//            |salida| ≥ 0,99).
//   dirigida en el navegador, el instrumento real: patch de fábrica + Mod → Filtro +
//            rueda 1 + Osc3 en 2' (la condición dirigida de F2d), notas y acordes
//            durante --secs s; los dos worklets lado a lado sobre la misma
//            entrada (el grafo recibe el de ahora): activaciones de la guarda,
//            max |out4| y tramos con la salida clavada, antes y ahora.
//   sonido   en el navegador: los 8 patches de fábrica (el de arranque y los 7
//            presets) con una nota sostenida (C2, C3 y C4), los dos worklets lado
//            a lado; de la ventana sostenida (2,5–4,0 s) se compara la salida del
//            filtro y la del instrumento (modelo: sustain × volumen → la curva del
//            WaveShaper): RMS y bandas de 1/3 de octava.
//
//   node reports/F2e-monomoon.mjs                    # todo (~4 min)
//   node reports/F2e-monomoon.mjs --only cota --runs 3000
//   node reports/F2e-monomoon.mjs --only dirigida --secs 120
//   node reports/F2e-monomoon.mjs --only cota,d          # suma la variante (d), no aplicada
//   node reports/F2e-monomoon.mjs --only dirigida,sonido --b d   # en el navegador, (d) en vez de lo de ahora
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('only', 'cota,dirigida,sonido').split(',');
const RUNS = +arg('runs', 2000), SECS = +arg('secs', 60);
const FILE = 'descargables/MonoMoon70.html', BASE = '70a916a';
const moogOf = (html) => html.match(/const MOOG_WORKLET = `([\s\S]*?)`;/)[1];
const OLD = moogOf(execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const NOW = moogOf(readFileSync(join(ROOT, FILE), 'utf8'));
/* Variante (d), solo para medir (no está en el instrumento): la normalización
   0,35013·f⁴ = (f/1,3)⁴ repartida en cada etapa en vez de aplicada a la entrada.
   Con el corte fijo es la misma cuenta (salvo redondeo); con el corte modulado,
   los estados no quedan a la escala de otro f. */
function variant(code) {
  const v = code
    .replace('x -= Math.tanh(this.out4) * fb; x *= 0.35013 * ff * ff;', 'x -= Math.tanh(this.out4) * fb; const g = f / 1.3;')
    .replace('this.out1 = x         + 0.3*this.in1 + (1-f)*this.out1;', 'this.out1 = g*(x         + 0.3*this.in1) + (1-f)*this.out1;')
    .replace('this.out2 = this.out1 + 0.3*this.in2 + (1-f)*this.out2;', 'this.out2 = g*(this.out1 + 0.3*this.in2) + (1-f)*this.out2;')
    .replace('this.out3 = this.out2 + 0.3*this.in3 + (1-f)*this.out3;', 'this.out3 = g*(this.out2 + 0.3*this.in3) + (1-f)*this.out3;')
    .replace('this.out4 = this.out3 + 0.3*this.in4 + (1-f)*this.out4;', 'this.out4 = g*(this.out3 + 0.3*this.in4) + (1-f)*this.out4;');
  if ((v.match(/g\*\(/g) || []).length !== 4 || !v.includes('const g = f / 1.3;')) throw new Error('no pude armar la variante (d)');
  return v;
}
const VAR = ONLY.includes('d') || arg('b', '') === 'd' ? variant(NOW) : null;
const B_CODE = arg('b', '') === 'd' ? VAR : NOW;
const GUARD = 'if(!Number.isFinite(this.out4)){';
const counted = (code) => { const c = code.replace(GUARD, GUARD + 'this.__g=(this.__g||0)+1;'); if (c === code) throw new Error('no encontré la guarda'); return c; };
const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

/* ─────────────── cota (Node) ─────────────── */
function mk(code, sr) {
  let C; new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C = c; }, sr);
  return new C();
}
const WAVES = ['triangle', 'trisaw', 'sawtooth', 'square', 'pulseWide', 'pulseNarrow'];
function wave(w, ph) {
  const saw = 2 * ph - 1, tri = 1 - 4 * Math.abs(ph - 0.5);
  switch (w) {
    case 'triangle': return tri;
    case 'trisaw': return 0.55 * saw + 0.45 * tri;
    case 'sawtooth': return saw;
    case 'square': return ph < 0.5 ? 1 : -1;
    case 'pulseWide': return ph < 0.3 ? 1 : -1;
    default: return ph < 0.12 ? 1 : -1;
  }
}
/** Una toma: misma entrada y parámetros para los dos códigos. → por código: max|out4|, guarda, tramo clavado (ms), no finitas. */
function take(c) {
  const engines = [mk(counted(OLD), c.sr), mk(counted(NOW), c.sr)].concat(VAR ? [mk(counted(VAR), c.sr)] : []);
  const B = 128, N = Math.round(c.secs * c.sr), W = Math.round(0.01 * c.sr);
  const inp = [[new Float32Array(B)]], outs = engines.map(() => [[new Float32Array(B)]]);
  const pr = { cutoff: new Float32Array([c.base]), cutoffMod: new Float32Array(B), resonance: new Float32Array([c.res * 0.965]) };
  const st = engines.map(() => ({ max: 0, bad: 0, win: 0, sat: 0, run: 0, longest: 0 }));
  let ph = [0, 0, 0], mph = 0, nz = 0x2545f491;
  for (let b = 0; b * B < N; b++) {
    for (let n = 0; n < B; n++) {
      const t = (b * B + n) / c.sr;
      let x = 0;
      for (let k = 0; k < 3; k++) { ph[k] = (ph[k] + c.f0 * c.det[k] / c.sr) % 1; x += c.lvl[k] * wave(c.oscWave[k], ph[k]); }
      nz ^= nz << 13; nz ^= nz >>> 17; nz ^= nz << 5;
      inp[0][0][n] = x * c.uni + c.noise * ((nz >>> 0) / 2147483648 - 1);
      mph = (mph + c.modHz / c.sr) % 1;
      const env = t < c.fa ? t / c.fa : c.fs + (1 - c.fs) * Math.exp(-(t - c.fa) / c.fd);
      pr.cutoffMod[n] = Math.max(-12000, Math.min(12000, 4200 * c.wheel * wave(c.modWave, mph) + c.contour * 4800 * env));
    }
    engines.forEach((L, e) => {
      L.process(inp, outs[e], pr);
      const s = st[e], o = outs[e][0][0];
      if (Math.abs(L.out4) > s.max) s.max = Math.abs(L.out4);
      for (let n = 0; n < B; n++) {
        if (!Number.isFinite(o[n])) s.bad++;
        if (Math.abs(o[n]) >= 0.99) s.sat++;
        if (++s.win === W) { if (s.sat >= 0.9 * W) { s.run++; if (s.run > s.longest) s.longest = s.run; } else s.run = 0; s.win = 0; s.sat = 0; }
      }
    });
  }
  return engines.map((L, e) => ({ max: st[e].max, guard: L.__g || 0, longestMs: st[e].longest * 10, bad: st[e].bad }));
}
function cota() {
  let s = 0x0f2e;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)], logU = (a, b) => a * Math.pow(b / a, rnd());
  const res = [];
  for (let r = 0; r < RUNS; r++) {
    const loud = rnd() < 0.3;   // con unison y los niveles al máximo: entrada hasta 7
    const c = {
      sr: pick([22050, 32000, 44100, 48000, 96000]), secs: 1.0,
      res: rnd(), base: logU(100, 18000), wheel: rnd() < 0.2 ? (rnd() < 0.5 ? 0 : 1) : rnd(), modHz: logU(1, 4000), modWave: pick(WAVES),
      contour: rnd() * 2 - 1, fa: logU(0.001, 0.5), fd: logU(0.002, 2), fs: rnd(),
      f0: logU(30, 2000), det: [1, Math.pow(2, (rnd() - 0.5) * 14 / 1200), Math.pow(2, (rnd() - 0.5) * 14 / 1200)], oscWave: [pick(WAVES), pick(WAVES), pick(WAVES)],
      lvl: loud ? [1, 1, 1] : [0.3 + rnd() * 0.7, rnd(), rnd()], uni: loud ? 2 : 1, noise: rnd() < 0.2 ? rnd() : 0,
    };
    const [o, n, d] = take(c);
    res.push({ c, o, n, d });
  }
  const now = res.map((x) => x.n), old = res.map((x) => x.o);
  const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
  console.log(`── cota (Node): ${RUNS} tomas de 1 s, semilla fija, el worklet de ${BASE} (antes) y el de ahora sobre la misma entrada`);
  console.log(`   ahora: max |out4| ${q(now.map((x) => x.max), 1).toFixed(2)} (p50 ${q(now.map((x) => x.max), 0.5).toFixed(2)} · p99 ${q(now.map((x) => x.max), 0.99).toFixed(2)}) · activaciones de la guarda ${now.reduce((a, x) => a + x.guard, 0)} · no finitas ${now.reduce((a, x) => a + x.bad, 0)}`);
  console.log(`   antes: max |out4| ${q(old.map((x) => x.max), 1).toExponential(2)} (p50 ${q(old.map((x) => x.max), 0.5).toFixed(2)} · p99 ${q(old.map((x) => x.max), 0.99).toExponential(2)}) · tomas con la guarda activada ${old.filter((x) => x.guard).length} (${old.reduce((a, x) => a + x.guard, 0)} activaciones)`);
  const oldLong = res.filter((x) => x.o.longestMs > 100), nowLong = res.filter((x) => x.n.longestMs > 100);
  console.log(`   salida clavada más de 100 ms: antes en ${oldLong.length} tomas · ahora en ${nowLong.length} (de esas, antes también: ${nowLong.filter((x) => x.o.longestMs > 100).length}) · el tramo más largo ahora ${Math.max(...now.map((x) => x.longestMs))} ms, antes ${Math.max(...old.map((x) => x.longestMs))} ms`);
  const only = nowLong.filter((x) => x.o.longestMs <= 100).slice(0, 3);
  for (const x of only) console.log(`     clavada ahora y no antes: ${x.n.longestMs} ms · ${JSON.stringify({ sr: x.c.sr, res: +x.c.res.toFixed(2), base: Math.round(x.c.base), wheel: +x.c.wheel.toFixed(2), modHz: Math.round(x.c.modHz), lvl: x.c.lvl.map((v) => +v.toFixed(2)), uni: x.c.uni })}`);
  const loudNow = nowLong.filter((x) => x.c.uni === 2).length;
  console.log(`   de las ${nowLong.length} tomas clavadas ahora, ${loudNow} son con la entrada al máximo (unison y niveles en 1)`);
  if (VAR) {
    const d = res.map((x) => x.d), dl = res.filter((x) => x.d.longestMs > 100);
    console.log(`   variante (d), no aplicada: max |out4| ${q(d.map((x) => x.max), 1).toFixed(2)} (p99 ${q(d.map((x) => x.max), 0.99).toFixed(2)}) · guarda ${d.reduce((a, x) => a + x.guard, 0)} · no finitas ${d.reduce((a, x) => a + x.bad, 0)} · salida clavada más de 100 ms en ${dl.length} tomas (con la entrada al máximo: ${dl.filter((x) => x.c.uni === 2).length}), el tramo más largo ${Math.max(...d.map((x) => x.longestMs))} ms`);
    for (const x of dl.filter((y) => y.c.uni !== 2).slice(0, 3)) console.log(`     clavada con (d) y entrada normal: ${x.d.longestMs} ms · ${JSON.stringify({ sr: x.c.sr, res: +x.c.res.toFixed(2), base: Math.round(x.c.base), wheel: +x.c.wheel.toFixed(2), modHz: Math.round(x.c.modHz), lvl: x.c.lvl.map((v) => +v.toFixed(2)) })}`);
  }
  // RESO 0: la realimentación vale 0 en los dos códigos
  let zeroMism = 0;
  for (let r = 0; r < 60; r++) {
    const c = { ...res[r].c, res: 0 };
    const a = [mk(OLD, c.sr), mk(NOW, c.sr)], B = 128, inp = [[new Float32Array(B)]], o = [[[new Float32Array(B)]], [[new Float32Array(B)]]];
    const pr = { cutoff: new Float32Array([c.base]), cutoffMod: new Float32Array([4200 * c.wheel]), resonance: new Float32Array([0]) };
    let ph = 0;
    for (let b = 0; b < 200; b++) {
      for (let n = 0; n < B; n++) { ph = (ph + c.f0 / c.sr) % 1; inp[0][0][n] = 2 * ph - 1; }
      a[0].process(inp, o[0], pr); a[1].process(inp, o[1], pr);
      for (let n = 0; n < B; n++) if (!Object.is(o[0][0][0][n], o[1][0][0][n])) zeroMism++;
    }
  }
  console.log(`   control: con RESO 0 (realimentación 0) los dos dan las mismas muestras: ${zeroMism === 0 ? 'sí' : 'NO (' + zeroMism + ')'}`);
}

/* ─────────────── navegador: los dos worklets lado a lado ─────────────── */
function twinSource(oldCode, newCode) {
  const plain = (code) => code.replace('class MoogLadder extends AudioWorkletProcessor', 'class MoogLadder extends __P').replace("registerProcessor('moog-ladder', MoogLadder);", 'return MoogLadder;');
  const desc = newCode.match(/static get parameterDescriptors\(\)\{\s*return (\[[\s\S]*?\]);\s*\}/)[1];
  return `
class __P { constructor(){ this.port = {}; } }
const A = (function(){ ${plain(counted(oldCode))} })(), B = (function(){ ${plain(counted(newCode))} })();
registerProcessor('moog-ladder', class extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return ${desc}; }
  constructor(){ super(); this.e = [new A(), new B()];
    this.i = [[new Float32Array(1)]]; this.o = [[[new Float32Array(1)]], [[new Float32Array(1)]]];
    this.p = { cutoff: new Float32Array(1), cutoffMod: new Float32Array(1), resonance: new Float32Array(1) };
    this.W = Math.round(0.01 * sampleRate);
    this.s = [0, 1].map(() => ({ max: 0, win: 0, sat: 0, run: 0, longest: 0, runs100: 0, bad: 0 }));
    this.cap = null;
    this.port.onmessage = (e) => {
      if (e.data && e.data.cap) { const n = e.data.cap; this.cap = { f0: e.data.f0, a: new Float32Array(n), b: new Float32Array(n), k: 0 }; return; }
      this.port.postMessage(this.s.map((s, i) => ({ max: s.max, longest: s.longest * 10, runs100: s.runs100, bad: s.bad, guard: this.e[i].__g || 0 })));
    }; }
  process(inputs, outputs, params){
    const o = outputs[0][0]; if (!o) return true;
    const x = inputs[0][0], cA = params.cutoff, mA = params.cutoffMod, W = this.W, c = this.cap;
    this.p.resonance[0] = params.resonance[0];
    for (let n = 0; n < o.length; n++) {
      this.p.cutoff[0] = cA.length === 1 ? cA[0] : cA[n]; this.p.cutoffMod[0] = mA.length === 1 ? mA[0] : mA[n];
      const inp = x ? (this.i[0][0][0] = x[n], this.i) : [[]];
      for (let e = 0; e < 2; e++) {
        const L = this.e[e], s = this.s[e]; L.process(inp, this.o[e], this.p);
        const y = this.o[e][0][0][0], a = Math.abs(L.out4);
        if (a > s.max) s.max = a; if (!(y - y === 0)) s.bad++;
        if (Math.abs(y) >= 0.99) s.sat++;
        if (++s.win === W) { if (s.sat >= 0.9 * W) { s.run++; if (s.run > s.longest) s.longest = s.run; if (s.run === 10) s.runs100++; } else s.run = 0; s.win = 0; s.sat = 0; }
      }
      if (c && currentFrame + n >= c.f0 && c.k < c.a.length) { c.a[c.k] = this.o[0][0][0][0]; c.b[c.k] = this.o[1][0][0][0]; c.k++;
        if (c.k === c.a.length) { this.port.postMessage({ a: c.a, b: c.b }, [c.a.buffer, c.b.buffer]); this.cap = null; } }
      o[n] = this.o[1][0][0][0];
    }
    return true;
  }
});`;
}
const INIT = ({ twin }) => {
  const add = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = async function (url, ...rest) {
    let txt = ''; try { txt = await (await fetch(url)).text(); } catch (e) {}
    if (txt.includes("registerProcessor('moog-ladder'")) url = URL.createObjectURL(new Blob([twin], { type: 'application/javascript' }));
    return add.call(this, url, ...rest);
  };
};
const HELPERS = () => {
  const K = { cutoff: () => MAC.cutoff, res: () => MAC.res, env: () => MAC.env, modmix: () => REG.knob.k_modmix };
  window.__fz = {
    knob(k, n) { const kn = K[k](); kn.set(kn._denorm(n)); },
    wheel(w, v) { REG.wheels[w].set(v); },
    tog(id, on) { const t = document.getElementById(id); if ((t.dataset.on === '1') !== on) t.click(); },
    preset(n) { const s = document.getElementById('presetSel'); s.value = n; s.onchange(); },
    press(id, m, ms) { kbd.press(id, m, null, 100); if (ms) setTimeout(() => kbd.release(id), ms); },
  };
};
let srv, browser;
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(INIT, { twin: twinSource(OLD, B_CODE) });
  const page = await ctx.newPage();
  await page.goto(srv.origin + '/' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.click('#powerOvl');
  await page.waitForFunction(() => typeof engine !== 'undefined' && engine.ready && engine.ctx.state === 'running', null, { timeout: 10000 });
  await page.evaluate(HELPERS);
  return { ctx, page };
}
const stats = (page) => page.evaluate(() => new Promise((ok) => { const n = engine.filter.node; n.port.onmessage = (e) => ok(e.data); n.port.postMessage(0); }));

async function dirigida() {
  const { ctx, page } = await open();
  try {
    await page.evaluate(() => { __fz.tog('filtModTog', true); __fz.tog('osc3KbdTog', true); __fz.knob('modmix', 0); REG.knob.f2.set(5); __fz.wheel('mod', 1); });
    const seq = [[48, 52, 55], [60], [41, 44, 53], [72, 76], [36], [65, 69, 72], [57]];
    const t0 = Date.now(); let k = 0;
    while (Date.now() - t0 < SECS * 1000) {
      const ch = seq[k % seq.length], ms = 180 + (k * 137) % 420;
      await page.evaluate(([c, t, kk]) => c.forEach((m, j) => __fz.press('d' + kk + '_' + j, m, t)), [ch, ms, k]);
      // cada 8 acordes, RESO y corte a otro valor
      if (k % 8 === 7) await page.evaluate(([r, c]) => { __fz.knob('res', r); __fz.knob('cutoff', c); }, [[0.32, 0.6, 0.9, 1][(k >> 3) % 4], [0.3, 0.5, 0.7][(k >> 3) % 3]]);
      await page.waitForTimeout(ms + 60); k++;
    }
    const [o, n] = await stats(page);
    console.log(`── dirigida (navegador, ${SECS} s): patch de fábrica + Mod → Filtro + rueda 1 + Osc3 en 2', acordes; RESO 0,32 → 1 y corte cambiando cada 8 acordes`);
    console.log(`   antes (${BASE}): guarda ${o.guard} · max |out4| ${o.max.toExponential(2)} · salida clavada: tramos ≥ 100 ms ${o.runs100}, el más largo ${o.longest} ms · no finitas ${o.bad}`);
    console.log(`   ahora:           guarda ${n.guard} · max |out4| ${n.max.toFixed(2)} · salida clavada: tramos ≥ 100 ms ${n.runs100}, el más largo ${n.longest} ms · no finitas ${n.bad}`);
  } finally { await ctx.close(); }
}

/* ─────────────── sonido: presets con una nota sostenida ─────────────── */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
/** Bandas de 1/3 de octava (25 Hz–16 kHz): potencia por banda, promedio de ventanas de Hann de 16 384. */
function bands(x, sr) {
  const N = 16384, centers = []; for (let k = -16; k <= 12; k++) centers.push(1000 * Math.pow(2, k / 3));
  const pw = new Float64Array(centers.length); let segs = 0;
  for (let s = 0; s + N <= x.length; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im); segs++;
    for (let b = 1; b < N / 2; b++) { const f = b * sr / N, p = re[b] * re[b] + im[b] * im[b];
      const k = Math.round(3 * Math.log2(f / 1000)) + 16; if (k >= 0 && k < centers.length) pw[k] += p; }
  }
  return { centers, pw: Array.from(pw, (p) => p / Math.max(1, segs)) };
}
const SHAPE = (v) => { const x = Math.max(-1, Math.min(1, v)); return Math.tanh(x * 1.4) / Math.tanh(1.4); };
async function sonido() {
  const PRESETS = ['(fábrica)', 'Bajo gordo', 'Sub redondo', 'Lead filoso', 'Pad cálido', 'Órgano hueco', 'Auto-wah (osc3 LFO)', 'Resonante zumbón'];
  const rows = [];
  for (const p of PRESETS) {
    const { ctx, page } = await open();
    try {
      if (p !== '(fábrica)') await page.evaluate((x) => __fz.preset(x), p);
      const st = await page.evaluate(() => ({ res: engine.state.filter.res, vol: engine.state.master.vol, sus: engine.state.env.s, filt: engine.state.mod.filt, sr: engine.ctx.sampleRate }));
      for (const midi of [36, 48, 60]) {
        const sr = st.sr, n = Math.round(1.5 * sr);
        const tOn = await page.evaluate(([m, n]) => { const sr = engine.ctx.sampleRate, t = engine.ctx.currentTime;
          window.__got = new Promise((ok) => { const node = engine.filter.node; node.port.onmessage = (e) => ok(e.data); node.port.postMessage({ cap: n, f0: Math.round((t + 2.5) * sr) }); });
          __fz.press('s', m, 0); return t; }, [midi, n]);
        const g = await page.evaluate(async () => { const x = await window.__got; return { a: Array.from(x.a), b: Array.from(x.b) }; });
        await page.evaluate(() => kbd.release('s'));
        await page.waitForTimeout(3000);
        void tOn;
        const inst = (y) => y.map((v) => SHAPE(v * st.sus * st.vol));
        const rms = (y) => Math.sqrt(y.reduce((s, v) => s + v * v, 0) / y.length);
        const fa = bands(g.a, sr), fb = bands(g.b, sr), ia = bands(inst(g.a), sr), ib = bands(inst(g.b), sr);
        // bandas que llevan al menos el 1 % de la potencia: la peor, y el promedio de |Δ| ponderado por energía
        const cmp = (A, Bb) => { const tot = A.pw.reduce((s, v) => s + v, 0); let worst = 0, worstF = 0, wsum = 0, wd = 0;
          A.pw.forEach((pa, k) => { if (pa >= tot * 0.01) { const d = 10 * Math.log10(Bb.pw[k] / pa); wsum += pa; wd += pa * Math.abs(d); if (Math.abs(d) > Math.abs(worst)) { worst = d; worstF = A.centers[k]; } } });
          return { worst, worstF, mean: wd / wsum }; };
        const cf = cmp(fa, fb), ci = cmp(ia, ib);
        rows.push({ p, midi, res: st.res, filt: st.filt, dF: dB(rms(g.b)) - dB(rms(g.a)), dI: dB(rms(inst(g.b))) - dB(rms(inst(g.a))), worst: ci.worst, worstF: ci.worstF, mean: ci.mean, fworst: cf.worst, lvl: dB(rms(inst(g.a))) });
      }
    } finally { await ctx.close(); }
  }
  console.log('── sonido (navegador): nota sostenida, ventana 2,5–4,0 s; Δ = ahora − antes. "instrumento" = sustain × volumen por la curva del WaveShaper');
  console.log('   bandas de 1/3 de octava con al menos el 1 % de la potencia: la de mayor |Δ| y el |Δ| medio ponderado por energía (salida del instrumento)');
  console.log('   preset · RESO · Mod → Filtro · nota · nivel (antes) · ΔRMS filtro · ΔRMS instrumento · peor banda · |Δ| medio');
  for (const r of rows) console.log(`   ${r.p.padEnd(20)} ${r.res.toFixed(2)} ${r.filt ? 'sí' : 'no'}  ${['C2', 'C3', 'C4'][[36, 48, 60].indexOf(r.midi)]}  ${fmt(r.lvl).padStart(6)} dBFS  ${fmt(r.dF, 2).padStart(6)} dB  ${fmt(r.dI, 2).padStart(6)} dB  ${fmt(r.worst, 2).padStart(6)} dB a ${Math.round(r.worstF)} Hz  ${r.mean.toFixed(2)} dB`);
  const tgt = rows.filter((r) => r.res <= 0.6 && !r.filt), rest = rows.filter((r) => !(r.res <= 0.6 && !r.filt));
  console.log(`   RESO ≤ 0,6 sin Mod → Filtro: |ΔRMS| máx. ${Math.max(...tgt.map((r) => Math.abs(r.dI))).toFixed(2)} dB · peor banda ${Math.max(...tgt.map((r) => Math.abs(r.worst))).toFixed(2)} dB · el resto: |ΔRMS| máx. ${Math.max(...rest.map((r) => Math.abs(r.dI))).toFixed(2)} dB, peor banda ${Math.max(...rest.map((r) => Math.abs(r.worst))).toFixed(2)} dB`);
}

if (ONLY.includes('cota')) cota();
if (ONLY.includes('dirigida') || ONLY.includes('sonido')) {
  srv = await serveRoot(ROOT);
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    if (ONLY.includes('dirigida')) await dirigida();
    if (ONLY.includes('sonido')) await sonido();
  } finally { await browser.close(); await srv.close(); }
}
