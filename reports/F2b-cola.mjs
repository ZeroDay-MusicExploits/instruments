#!/usr/bin/env node
// reports/F2b-cola.mjs
//
// Mediciones de reports/F2b.md. No es un test de aceptación: no falla por lo
// que encuentra, imprime lo que mide. Nada de esto cambia el instrumento: las
// opciones se simulan dentro de la página medida (applyPatch, o reemplazando
// setSat / la ganancia del feedback en esa página).
//
//   cola     Patch de fábrica, SIREN 1 s (noteOn('pad', 57)), soltar y medir
//            la salida (RMS y pico por segundo) durante 60 s. Con la versión
//            actual (VCA en 0) y con la de antes (224763d).
//   lazo     Ganancia de lazo del eco medida: con el VCA en 0 (silencio) se
//            inyecta en echoIn una ráfaga de 20 ms (a 250 Hz…4 kHz) y 1e-4 de amplitud, y
//            se ajusta una recta al RMS por repetición (ventanas de un tiempo de
//            eco) entre −160 y −45 dBFS (sin saturar): dB/s × tiempo de eco =
//            dB por repetición. Depende de la frecuencia: los biquads del lazo
//            (highpass 170 Hz y lowpass TONE, Q = 1 dB) suman hasta ~+2 dB cerca de
//            0,78·TONE, así que cada opción se mide a 1 kHz y en ese pico.
//   opciones Lo mismo que "cola" (40 s) y "lazo" con cada opción simulada:
//            FEEDBACK por defecto más bajo, techo de la ganancia del lazo y
//            TAPE SAT normalizada (tanh(k·x)/k). Más FEEDBACK ∞ sostenido 6 s
//            con la curva de hoy y con la normalizada.
//   presets  Los 6 presets de fábrica: SIREN 1 s y la salida a los 30 s.
//
//   node reports/F2b-cola.mjs                       # todo (~6 min)
//   node reports/F2b-cola.mjs --only cola,lazo      # una parte
//   node reports/F2b-cola.mjs --json <archivo>      # además guarda los números
//
// Necesita Playwright + Chromium (no es dependencia del runtime).
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ONLY = (arg('--only') || 'cola,lazo,opciones,presets').split(',');
const JSON_OUT = arg('--json');

const FILE = 'descargables/J4-Sirens_Station.html';
const URL_PATH = '/' + FILE;
const BASE = '224763d';
const BASE_PATH = '/descargables/__base-J4.html';
const baseHtml = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 });

/* Tap de salida + medidor (el de tools/tests/j4-mute y j4-reposo). */
const INIT_TAP = () => {
  const conn = AudioNode.prototype.connect;
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
  window.__m = []; window.__mLast = -1;
  window.__meterOn = async (c) => {
    if (!c.__tap) c.__tap = c.createGain();
    const url = URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' }));
    await c.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(c, 'zd-meter');
    const mute = c.createGain(); mute.gain.value = 0;
    conn.call(c.__tap, node); conn.call(node, mute); conn.call(mute, c.destination);
    node.port.onmessage = (e) => { const a = e.data; for (let i = 0; i < a.length; i++) window.__m.push(a[i]); window.__mLast = a[a.length - 3]; };
  };
  /** RMS y pico (lineales) por ventana de `w` s desde t0, n ventanas. */
  window.__curve = (t0, w, n) => {
    const out = Array.from({ length: n }, () => ({ ss: 0, n: 0, pk: 0 }));
    const m = window.__m;
    for (let i = 0; i < m.length; i += 3) {
      const k = Math.floor((m[i] - t0) / w);
      if (k >= 0 && k < n) { const o = out[k]; o.ss += m[i + 2]; o.n++; if (m[i + 1] > o.pk) o.pk = m[i + 1]; }
    }
    return out.map((o) => ({ rms: o.n ? Math.sqrt(o.ss / o.n) : 0, pk: o.pk }));
  };
};

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

/* Opciones, simuladas en la página (después de encender). Cada una devuelve una descripción. */
const OPTS = {
  hoy: { label: 'hoy (FEEDBACK 0,42 · SAT 1,8)', run: () => {} },
  fb037: { label: 'A · FEEDBACK por defecto 0,37', run: () => { applyPatch({ echo: { fb: 0.37 } }); } },
  fb034: { label: 'A · FEEDBACK por defecto 0,34', run: () => { applyPatch({ echo: { fb: 0.34 } }); } },
  fb030: { label: 'A · FEEDBACK por defecto 0,30', run: () => { applyPatch({ echo: { fb: 0.30 } }); } },
  fb025: { label: 'A · FEEDBACK por defecto 0,25', run: () => { applyPatch({ echo: { fb: 0.25 } }); } },
  // B · techo: FEEDBACK × k ≤ L (k = 1,5·SAT), salvo ∞. Con el patch por defecto equivale a FEEDBACK = L/k.
  techo080: { label: 'B · techo FEEDBACK·k ≤ 0,80', run: () => {
    const lim = () => Math.min(P.echo.fb, 0.8 / (1.5 * P.echo.sat));
    echoFB.gain.cancelScheduledValues(ctx.currentTime); echoFB.gain.setTargetAtTime(lim(), ctx.currentTime, 0.02);
  } },
  // C · TAPE SAT normalizada: pendiente 1 en el origen, la ganancia del lazo es la de la perilla FEEDBACK
  norm: { label: 'C · TAPE SAT normalizada tanh(k·x)/k', run: () => {
    window.setSat = (node, amt) => { const n = 1024, c = new Float32Array(n), k = amt * 1.5;
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / k; } node.curve = c; node.oversample = '2x'; };
    applyEcho();
  } },
};

let srv, browser;

async function open(path = URL_PATH) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(INIT_TAP);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(srv.origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.click('#power');
  await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
  await page.evaluate(() => window.__meterOn(ctx));
  return { ctx, page, errors };
}
const curve = async (page, t0, w, n) => {
  await page.waitForFunction((t) => window.__mLast >= t, t0 + w * n, { timeout: (w * n + 20) * 1000 });
  return (await page.evaluate(([a, b, c]) => window.__curve(a, b, c), [t0, w, n])).map((x) => ({ rms: dB(x.rms), pk: dB(x.pk) }));
};

/** SIREN `hold` s y la salida por segundo durante `dur` s desde que se suelta. */
async function cola({ path = URL_PATH, opt = 'hoy', preset = null, dur = 60, hold = 1 }) {
  const { ctx, page, errors } = await open(path);
  try {
    if (preset) await page.evaluate((n) => applyPatch(FACTORY[n]), preset);
    await page.evaluate(OPTS[opt].run);
    await page.waitForTimeout(500);
    const pre = await page.evaluate(() => ({ fb: P.echo.fb, sat: P.echo.sat, time: P.echo.time, gfb: echoFB.gain.value }));
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(hold * 1000);
    const tOff = await page.evaluate(() => { noteOff('pad'); return ctx.currentTime; });
    const per = await curve(page, tOff, 1, dur);
    const first2 = (await curve(page, tOff, 2, 1))[0];
    return { opt, preset, pre, per, first2, errors };
  } finally { await ctx.close(); }
}

/** Ganancia de lazo medida con una semilla de −80 dB inyectada en el eco (VCA en 0: nada más entra). */
async function lazo({ opt = 'hoy', freq = 1000 }) {
  const { ctx, page, errors } = await open(URL_PATH);
  try {
    await page.evaluate(OPTS[opt].run);
    await page.waitForTimeout(1000);
    const t0 = await page.evaluate((hz) => {
      const sr = ctx.sampleRate, n = Math.round(0.02 * sr), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = 1e-4 * Math.sin(2 * Math.PI * hz * i / sr) * Math.sin(Math.PI * i / n) ** 2;
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(echoIn);
      const t = ctx.currentTime + 0.05; s.start(t); return t;
    }, freq);
    const time = await page.evaluate(() => P.echo.time);
    const W = time, N = Math.ceil(16 / time);      // una repetición por ventana
    const c = await curve(page, t0, W, N);
    // recta por mínimos cuadrados en el tramo lineal: sin saturar y sobre el piso numérico (sin la ventana de la ráfaga)
    const pts = c.map((x, i) => [i * W + W / 2, x.rms]).filter(([t, v]) => t > W && v > -160 && v < -45);
    let slope = NaN;
    if (pts.length >= 4) {
      const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
      const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
      slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    }
    const perRep = slope * time;
    return { opt, freq, slope, perRep, gain: 10 ** (perRep / 20), npts: pts.length, time, errors, curve: c.map((x) => +x.rms.toFixed(1)) };
  } finally { await ctx.close(); }
}

/** FEEDBACK ∞ sostenido 6 s después de una nota (curva de hoy o normalizada). */
async function infinito({ opt = 'hoy' }) {
  const { ctx, page, errors } = await open(URL_PATH);
  try {
    await page.evaluate(OPTS[opt].run);
    await page.waitForTimeout(500);
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(1000);
    const tOff = await page.evaluate(() => { noteOff('pad'); setFbInf(true); return ctx.currentTime; });
    const per = await curve(page, tOff, 1, 6);
    await page.evaluate(() => setFbInf(false));
    return { opt, per, errors };
  } finally { await ctx.close(); }
}

/** Gráfico de texto: RMS por segundo (una columna por segundo, una fila cada 5 dB, de 0 a −100 dBFS;
 *  lo que queda por debajo va en la última fila). series: [{ ch, label, per }] */
function plot(series, { top = 0, bottom = -100, step = 5 } = {}) {
  const w = Math.max(...series.map((x) => x.per.length)), n = Math.round((top - bottom) / step) + 1;
  const g = Array.from({ length: n }, () => Array(w).fill(' '));
  for (const x of series) x.per.forEach((v, i) => {
    const r = Number.isFinite(v.rms) ? Math.round((top - v.rms) / step) : n - 1;
    g[Math.min(n - 1, Math.max(0, r))][i] = x.ch;
  });
  const rows = g.map((row, k) => { const y = top - k * step; return `${y % 10 === 0 ? String(y).padStart(5) : '     '} │${row.join('')}`; });
  rows[n - 1] = rows[n - 1].replace(/^ *-?\d+/, (m) => '≤' + m.trim().padStart(4));
  rows.push(`      └${'─'.repeat(w)}`);
  rows.push(`       ${Array.from({ length: Math.ceil(w / 10) }, (_, i) => String(i * 10).padEnd(10)).join('')}s desde que se suelta SIREN`);
  rows.push('       ' + series.map((x) => `${x.ch} ${x.label}`).join(' · '));
  return rows.join('\n');
}
const when = (per, lim) => { const i = per.findIndex((x) => x.rms < lim); return i < 0 ? '—' : `${i} s`; };

const out = {};
try {
  srv = await serveRoot(ROOT, { [BASE_PATH]: { body: baseHtml } });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  if (ONLY.includes('cola')) {
    console.log('\n── cola · patch de fábrica, SIREN 1 s y soltar, 60 s ──');
    const [now, base] = await Promise.all([cola({}), cola({ path: BASE_PATH })]);
    out.cola = { now, base };
    for (const [name, r] of [['ahora (VCA en 0)', now], [`antes (${BASE})`, base]]) {
      console.log(`\n${name} · FEEDBACK ${r.pre.fb} · SAT ${r.pre.sat} · eco ${r.pre.time} s · primeros 2 s ${f1(r.first2.rms)} dBFS RMS`);
      console.log('  s   RMS    pico');
      r.per.forEach((x, i) => { if (i < 15 || i % 5 === 4) console.log(`${String(i + 1).padStart(3)}  ${f1(x.rms).padStart(6)}  ${f1(x.pk).padStart(6)}`); });
      console.log(`  < −60 dBFS: ${when(r.per, -60)} · < −80: ${when(r.per, -80)} · últimos 10 s: ${f1(Math.max(...r.per.slice(-10).map((x) => x.rms)))} dBFS RMS (máx)`);
      if (r.errors.length) console.log('  errores:', r.errors);
    }
    console.log('\n' + plot([{ ch: '○', label: `antes (${BASE})`, per: base.per }, { ch: '●', label: 'ahora (VCA en 0)', per: now.per }]));
  }

  if (ONLY.includes('lazo') || ONLY.includes('opciones')) {
    const runs = async (jobs) => { const r = []; for (let i = 0; i < jobs.length; i += 4) r.push(...await Promise.all(jobs.slice(i, i + 4).map(lazo))); return r; };
    const sg = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
    console.log('\n── lazo · ganancia del patch de fábrica según la frecuencia de la semilla (−80 dB) ──');
    const sweep = await runs([250, 500, 1000, 2000, 2600, 3000, 4000].map((freq) => ({ opt: 'hoy', freq })));
    for (const r of sweep) console.log(`  ${String(r.freq).padStart(5)} Hz  ${sg(r.perRep)} dB/repetición · ganancia ${r.gain.toFixed(3)} (${r.npts} puntos)${r.errors.length ? ' · errores ' + r.errors : ''}`);
    console.log('\n── lazo · cada opción a 1 kHz y a 2,6 kHz (el pico del lowpass con TONE 3400) ──');
    const keys = Object.keys(OPTS);
    const res = await runs(keys.flatMap((opt) => [{ opt, freq: 1000 }, { opt, freq: 2600 }]));
    out.lazo = { sweep, opciones: res };
    for (const opt of keys) {
      const [a, b] = [1000, 2600].map((fr) => res.find((r) => r.opt === opt && r.freq === fr));
      const max = a.gain > b.gain ? a : b;
      console.log(`  ${OPTS[opt].label.padEnd(38)} 1 kHz ${sg(a.perRep)} dB/rep (${a.gain.toFixed(3)}) · 2,6 kHz ${sg(b.perRep)} dB/rep (${b.gain.toFixed(3)}) → ${max.gain > 1 ? 'crece' : 'decae'}`);
    }
  }

  if (ONLY.includes('opciones')) {
    console.log('\n── opciones · SIREN 1 s y soltar, 40 s ──');
    const keys = Object.keys(OPTS);
    const res = [];
    for (let i = 0; i < keys.length; i += 4) res.push(...await Promise.all(keys.slice(i, i + 4).map((opt) => cola({ opt, dur: 40 }))));
    out.opciones = res;
    console.log(`  ${'opción'.padEnd(38)} 0–2 s   5 s    10 s   20 s   30 s   40 s   < −60  < −80`);
    for (const r of res) {
      const at = (s) => f1(r.per[s - 1].rms).padStart(6);
      console.log(`  ${OPTS[r.opt].label.padEnd(38)} ${f1(r.first2.rms).padStart(6)} ${at(5)} ${at(10)} ${at(20)} ${at(30)} ${at(40)}  ${when(r.per, -60).padStart(5)}  ${when(r.per, -80).padStart(5)}`);
    }
    const CH = { hoy: '█', fb037: '7', fb034: '4', fb030: '3', fb025: '2', techo080: 'B', norm: 'C' };
    console.log('\n' + plot(res.map((r) => ({ ch: CH[r.opt], label: OPTS[r.opt].label, per: r.per }))));
    console.log('\n── FEEDBACK ∞ sostenido 6 s después de una nota (RMS por segundo) ──');
    const inf = await Promise.all(['hoy', 'norm'].map((opt) => infinito({ opt })));
    out.infinito = inf;
    for (const r of inf) console.log(`  ${OPTS[r.opt].label.padEnd(38)} ${r.per.map((x) => f1(x.rms)).join(' · ')}`);
  }

  if (ONLY.includes('presets')) {
    console.log('\n── presets de fábrica · SIREN 1 s y soltar, 30 s ──');
    const names = ['Classic Wail', 'Police Alarm', 'Acid Scream', 'UFO Random', 'Cosmic Drone', 'Feedback Dub'];
    const res = [];
    for (let i = 0; i < names.length; i += 3) res.push(...await Promise.all(names.slice(i, i + 3).map((preset) => cola({ preset, dur: 30 }))));
    out.presets = res;
    for (const r of res) {
      const k = 1.5 * r.pre.sat;
      console.log(`  ${r.preset.padEnd(13)} FEEDBACK ${String(r.pre.fb).padEnd(4)} × k ${k.toFixed(2)} = ${(r.pre.fb * k).toFixed(2)} · a los 10 s ${f1(r.per[9].rms)} · 20 s ${f1(r.per[19].rms)} · 30 s ${f1(r.per[29].rms)} dBFS RMS · < −80: ${when(r.per, -80)}`);
    }
  }
} finally {
  if (browser) await browser.close();
  if (srv) await srv.close();
}
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(out, null, 1)); console.log(`\nJSON: ${JSON_OUT}`); }
