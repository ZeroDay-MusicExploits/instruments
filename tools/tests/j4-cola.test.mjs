#!/usr/bin/env node
// tools/tests/j4-cola.test.mjs
//
// J4-Sirens Station: el eco se calla solo (F2c, opción B de reports/F2b.md).
// Con ∞ apagado, la ganancia del lazo del eco (FEEDBACK efectivo × pendiente de
// TAPE SAT × pico de los filtros del lazo) no pasa de un techo L < 1 que
// depende del TIME: L = min(0,97; 10^(−1,8·TIME/20)), la misma caída de
// 1,8 dB/s en el pico de los filtros con cualquier tiempo de eco. Se calibró con
// el delay más largo (2 s, el del DelayNode) y la perilla al máximo; con delays
// más cortos el mismo L cae más rápido (reports/F2c.md). La perilla FEEDBACK
// hace lo mismo que antes mientras el lazo queda por debajo del 93 % del techo
// (la rodilla) y de ahí sube en línea recta hasta el techo, que es el máximo de
// la perilla. Con ∞ el lazo queda como antes.
//
// La salida se mide como en j4-mute / j4-reposo: un AudioWorklet medidor (pico,
// RMS y muestras no finitas por bloque de 128) colgado de un tap propio.
// "Cola" = RMS en ventanas de un número entero de repeticiones del eco
// (TIME × ⌈1 s / TIME⌉), desde que se suelta SIREN.
//
//   1  Decaimiento: el patch de fábrica y los 6 presets, cada uno tal cual,
//      con la perilla al máximo y con la perilla al máximo y TIME 2 s: SIREN
//      1 s y soltar → < −60 dBFS RMS antes de los 30 s, sin crecimiento (ninguna
//      ventana más de 0,5 dB por encima de la más baja anterior). Si el filtro
//      ladder da NaN (bug previo de Acid Scream, ver reports/F2c.md) la toma no
//      mide el eco: se avisa y se repite.
//   2  El techo, en el grafo: en 12 posiciones de la perilla, en los 7 patches
//      y en extremos (SAT 1 y 6, TONE 300 y 12 k, TIME 0,02 y 2 s), la ganancia
//      del lazo ≤ L, = L al máximo, estrictamente creciente, y por debajo de la
//      rodilla FEEDBACK efectivo = perilla (el patch de fábrica hasta 0,25). El
//      pico de los filtros sale de las fórmulas de la spec (Q = 1 dB) y se
//      controla contra getFrequencyResponse.
//   2b El techo, medido como en F2b (semilla de −80 dB en 219 Hz y 2,6 kHz, dB
//      por repetición): con la perilla al máximo, ≤ L (TIME de fábrica y 2 s).
//   3  Más perilla = cola más larga: fábrica en 0,25 · 0,5 · 0,8 · 1,1, la
//      energía de la cola crece y las cuatro bajan de −60 antes de los 30 s.
//   4  ∞ intacto, contra el commit base: con ∞ puesto, el FEEDBACK efectivo en
//      el grafo es 1,06 en las dos versiones y, con ∞ desde antes de la nota
//      (render repetible), la salida tiene el mismo RMS por segundo (±0,05 dB).
//      La forma de onda no se compara: con ganancia 2,86 el lazo es caótico y
//      ni el mismo código da la misma señal muestra a muestra en dos páginas
//      (medido: −38 dBFS en el lazo, −43 a −46 dBFS a la salida). Con ∞ al
//      soltar SIREN, el mismo nivel (±0,5 dB); al soltar ∞, la cola decae.
//   5  Feedback bajo, contra el commit base: fábrica con 0,1 y 0,25 y Police
//      Alarm tal cual (0,3): cada repetición por encima de −60 dBFS ±0,5 dB.
//   6  Valores guardados: autoguardado, slot, JSON y presets guardan el mismo
//      número que antes (currentPatch idéntico al del commit base) y se leen
//      con la escala nueva.
//
//   node tools/tests/j4-cola.test.mjs          # ~8 min (tomas de 35 s, de a 4)
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const FILE = 'descargables/J4-Sirens_Station.html';
const URL_PATH = '/' + FILE;
const BASE = '27707d5';   // main antes del techo (F2b)
const BASE_PATH = '/descargables/__base-J4.html';

let baseHtml = null;
try { baseHtml = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
catch (e) { baseHtml = null; }

/* El diseño (reports/F2c.md). */
const R = 1.8, CAP = 0.97, KNEE = 0.93, FBMAX = 1.1;
const ceilOf = (time) => Math.min(CAP, 10 ** (-R * time / 20));
/** FEEDBACK efectivo para la perilla v (kH = 1,5·SAT × pico de los filtros). */
const effOf = (v, kH, time) => {
  const L = ceilOf(time), gk = KNEE * L, vk = gk / kH;
  if (v <= vk) return v;
  return (gk + (L - gk) * (v - vk) / (FBMAX - vk)) / kH;
};
const PRESETS = ['Classic Wail', 'Police Alarm', 'Acid Scream', 'UFO Random', 'Cosmic Drone', 'Feedback Dub'];
const PATCHES = ['fábrica', ...PRESETS];

/* Tap de salida + medidor (pico, RMS y muestras no finitas). Corre antes que la página. */
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
      const ch = inp[0] || []; let pk = 0, ss = 0, n = 0, bad = 0;
      for (const d of ch) { for (let i = 0; i < d.length; i++) { const v = d[i];
        if (!(v - v === 0)) { bad++; continue; } const a = v < 0 ? -v : v; if (a > pk) pk = a; ss += v * v; } n += d.length; }
      this.b.push(currentTime, pk, n ? ss / n : 0, bad);
      if (this.b.length >= 64) { this.port.postMessage(this.b); this.b = []; }
      return true;
    }
  });
  registerProcessor('zd-cap', class extends AudioWorkletProcessor {
    constructor(){ super(); this.req = null;
      this.port.onmessage = (e) => { const n = e.data.n; this.req = { f0: Math.round(e.data.t0 * sampleRate), first: -1, bufs: [new Float32Array(n), new Float32Array(n)], k: 0 }; }; }
    process(inp){
      const r = this.req; if (!r) return true;
      const ch = inp[0] || [], d0 = ch[0], d1 = ch[1] || ch[0], n = r.bufs[0].length;
      for (let i = 0; i < 128 && r.k < n; i++) {
        if (currentFrame + i < r.f0) continue;
        if (r.first < 0) r.first = currentFrame + i;
        r.bufs[0][r.k] = d0 ? d0[i] : 0; r.bufs[1][r.k] = d1 ? d1[i] : 0; r.k++;
      }
      if (r.k === n) { this.port.postMessage({ first: r.first, sr: sampleRate, bufs: r.bufs }, r.bufs.map((b) => b.buffer)); this.req = null; }
      return true;
    }
  });`;
  const sink = (c, src, name) => {
    const node = new AudioWorkletNode(c, name);
    const mute = c.createGain(); mute.gain.value = 0;
    conn.call(src, node); conn.call(node, mute); conn.call(mute, c.destination);
    return node;
  };
  window.__m = []; window.__mLast = -1;
  window.__meterOn = async (c) => {
    if (!c.__tap) c.__tap = c.createGain();
    const url = URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' }));
    await c.audioWorklet.addModule(url);
    sink(c, c.__tap, 'zd-meter').port.onmessage = (e) => { const a = e.data; for (let i = 0; i < a.length; i++) window.__m.push(a[i]); window.__mLast = a[a.length - 4]; };
  };
  /** RMS (lineal) y muestras no finitas por ventana de `w` s desde t0, n ventanas. */
  window.__curve = (t0, w, n) => {
    const out = Array.from({ length: n }, () => ({ ss: 0, n: 0, bad: 0 }));
    const m = window.__m;
    for (let i = 0; i < m.length; i += 4) {
      const k = Math.floor((m[i] - t0) / w + 1e-9);
      if (k >= 0 && k < n) { const o = out[k]; o.ss += m[i + 2]; o.n++; o.bad += m[i + 3]; }
    }
    return out.map((o) => ({ rms: o.n ? Math.sqrt(o.ss / o.n) : 0, bad: o.bad, n: o.n }));
  };
  window.__bad = (t0, t1) => { let b = 0; const m = window.__m; for (let i = 0; i < m.length; i += 4) if (m[i] >= t0 && m[i] < t1) b += m[i + 3]; return b; };
  window.__capOn = (c, src) => { const cap = sink(c, src || c.__tap, 'zd-cap'); return (t0, n) => new Promise((ok) => { cap.port.onmessage = (e) => ok(e.data); cap.port.postMessage({ t0, n }); }); };
  /** Biquad de la spec de Web Audio (lowpass/highpass, Q en dB): |H| a la frecuencia f. */
  window.__bq = (type, f0, Qdb, f, sr) => {
    const w0 = 2 * Math.PI * f0 / sr, cw = Math.cos(w0), al = Math.sin(w0) / (2 * Math.pow(10, Qdb / 20));
    const b0 = type === 'lowpass' ? (1 - cw) / 2 : (1 + cw) / 2, b1 = type === 'lowpass' ? 1 - cw : -(1 + cw), b2 = b0;
    const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al, w = 2 * Math.PI * f / sr;
    const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
    const dr = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), di = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  };
  /** Pico de |HP 170 Hz · LP tone| (los filtros del lazo), con la fórmula y con los nodos reales. */
  window.__peak = (tone, sr) => {
    const N = 600, f = new Float32Array(N), a = new Float32Array(N), b = new Float32Array(N), ph = new Float32Array(N);
    let m = 0;
    for (let i = 0; i < N; i++) { f[i] = 20 * Math.pow(1000, i / N); if (f[i] < sr / 2) m = Math.max(m, window.__bq('highpass', 170, 1, f[i], sr) * window.__bq('lowpass', tone, 1, f[i], sr)); }
    let node = 0;
    if (typeof echoHP !== 'undefined' && echoHP) { echoHP.getFrequencyResponse(f, a, ph); echoLP.getFrequencyResponse(f, b, ph); for (let i = 0; i < N; i++) if (f[i] < sr / 2) node = Math.max(node, a[i] * b[i]); }
    return { m, node };
  };
  /** FEEDBACK efectivo del lazo, tal como está en el grafo (sin ∞). */
  window.__eff = () => echoFB.gain.value * (typeof echoCap !== 'undefined' && echoCap ? echoCap.gain.value : 1);
};

/* Render repetible entre páginas (como j4-reposo 3): semilla para Math.random,
   fuentes alineadas a un mismo frame (1 s después del primer start() de un
   oscilador), patch aplicado antes de encender y ctx.currentTime fijo durante
   noteOn/noteOff/setFbInf. */
const REPEAT = () => {
  let x = 0x2545f491;
  Math.random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const start = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (when, ...rest) {
    const c = this.context;
    if (!c.__t0 && this instanceof OscillatorNode) c.__t0 = Math.ceil((c.currentTime + 1) * c.sampleRate / 128) * 128 / c.sampleRate;
    return start.call(this, !when && c.__t0 && c.currentTime < c.__t0 ? c.__t0 : when, ...rest);
  };
  window.__at = (T, fn) => {
    Object.defineProperty(ctx, 'currentTime', { configurable: true, get: () => T });
    try { fn(); } finally { delete ctx.currentTime; }
  };
};

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

let srv, browser;

test.before(async () => {
  srv = await serveRoot(ROOT, baseHtml ? { [BASE_PATH]: { body: baseHtml } } : {});
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open({ path = URL_PATH, init, patch } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(INIT_TAP);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  if (patch) await page.evaluate(patch);           // antes de encender: solo P
  await page.click('#power');
  await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
  await page.evaluate(() => window.__meterOn(ctx));
  return { ctx, page, errors };
}
/** Aplica un patch de la lista y las variantes (perilla al máximo, TIME). */
const setup = (page, name, { fbMax = false, time = null, fb = null } = {}) => page.evaluate(([n, mx, t, v]) => {
  if (n !== 'fábrica') applyPatch(FACTORY[n]);
  const echo = {};
  if (mx) echo.fb = 1.1; if (v !== null) echo.fb = v; if (t !== null) echo.time = t;
  if (Object.keys(echo).length) applyPatch({ echo });
  return { fb: P.echo.fb, sat: P.echo.sat, tone: P.echo.tone, time: P.echo.time, sr: ctx.sampleRate };
}, [name, fbMax, time, fb]);
/** Corre trabajos asíncronos de a `n`. */
async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

/** SIREN 1 s, soltar y la cola en ventanas de repeticiones enteras durante `dur` s. */
async function tail(name, variant = {}, { path = URL_PATH, dur = 34, tries = 8 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const { ctx, page, errors } = await open({ path });
    try {
      const p = await setup(page, name, variant);
      await page.waitForTimeout(600);
      const tOn = await page.evaluate(() => { noteOn('pad', 57); return ctx.currentTime; });
      await page.waitForTimeout(1000);
      const tOff = await page.evaluate(() => { noteOff('pad'); return ctx.currentTime; });
      await page.waitForFunction((t) => window.__mLast >= t, tOff + 0.3, { timeout: 10000 });
      if (await page.evaluate(([a, b]) => window.__bad(a, b), [tOn, tOff + 0.3])) {
        console.log(`  ${name}: el filtro ladder dio NaN con la nota (bug previo, ver F2c), toma ${attempt}: se repite`);
        continue;
      }
      const W = p.time * Math.ceil(1 / p.time), N = Math.ceil(dur / W);
      await page.waitForFunction((t) => window.__mLast >= t, tOff + W * N, { timeout: (W * N + 20) * 1000 });
      const c = await page.evaluate(([t, w, n]) => window.__curve(t, w, n), [tOff, W, N]);
      const sus = (await page.evaluate(([t]) => window.__curve(t - 0.5, 0.5, 1), [tOff]))[0];
      const v = c.map((x) => dB(x.rms));
      let last = -1; v.forEach((x, i) => { if (x >= -60) last = i; });
      let low = Infinity, grow = 0;
      v.forEach((x, i) => { if (i > 0 && x > -120) grow = Math.max(grow, x - low); low = Math.min(low, x); });
      const bad = c.reduce((a, x) => a + x.bad, 0);
      const energy = dB(Math.sqrt(c.filter((_, i) => (i + 1) * W <= 30 + 1e-9).reduce((a, x) => a + x.rms * x.rms, 0)));
      return { name, variant, p, W, v, t60: (last + 1) * W, never: last === v.length - 1, grow, bad, sus: dB(sus.rms), energy, errors, attempt };
    } finally { await ctx.close(); }
  }
  throw new Error(`${name}: NaN del filtro ladder en las ${tries} tomas`);
}
const label = (r) => `${r.name}${r.variant.fbMax ? ' · perilla al máx.' : ''}${r.variant.time ? ` · TIME ${r.variant.time} s` : ''}${r.variant.fb != null ? ` · FEEDBACK ${r.variant.fb}` : ''}`;
const show = (r) => `${label(r).padEnd(40)} TIME ${r.p.time} · FEEDBACK ${r.p.fb} → < −60 dBFS ${r.never ? 'nunca (≥ ' + fmt(r.v.length * r.W, 0) + ' s)' : 'a los ' + fmt(r.t60) + ' s'} · crecimiento ${fmt(r.grow)} dB · ${[5, 10, 20, 30].map((s) => fmt(r.v[Math.min(r.v.length - 1, Math.floor(s / r.W) - 1)], 0)).join(' / ')} dBFS a 5/10/20/30 s`;

// ─────────────── 1 · el eco se calla solo: presets, perilla al máximo, TIME 2 s ───────────────

test('1 · los 7 patches (tal cual, perilla al máximo y perilla al máximo con TIME 2 s): < −60 dBFS antes de 30 s, sin crecer', async () => {
  const jobs = [];
  for (const variant of [{}, { fbMax: true }, { fbMax: true, time: 2 }]) for (const n of PATCHES) jobs.push(() => tail(n, variant));
  const res = await pool(jobs);
  for (const r of res) console.log('  ' + show(r));
  for (const r of res) {
    assert.ok(r.sus > -30, `${label(r)}: control, la nota sonó (${fmt(r.sus)} dBFS)`);
    assert.equal(r.bad, 0, `${label(r)}: muestras no finitas en la cola`);
    assert.ok(!r.never && r.t60 <= 30, `${label(r)}: tiene que bajar de −60 dBFS RMS antes de los 30 s (${r.never ? 'no baja' : fmt(r.t60) + ' s'})`);
    assert.ok(r.grow <= 0.5, `${label(r)}: sin crecimiento intermedio (sube ${fmt(r.grow)} dB)`);
    assert.deepEqual(r.errors, []);
  }
});

// ─────────────────────────────── 2 · el techo, en el grafo ───────────────────────────────

const KNOB = [0, 0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 0.9, 1.0, 1.1];
const EXTREMES = [['SAT 1', { sat: 1 }], ['SAT 6', { sat: 6 }], ['TONE 300 Hz', { tone: 300 }], ['TONE 12 kHz', { tone: 12000 }], ['TIME 0,02 s', { time: 0.02 }], ['TIME 2 s', { time: 2 }]];

test('2 · techo en el grafo: lazo ≤ L(TIME), = L al máximo, creciente y sin cambios bajo la rodilla', async () => {
  const cases = [...PATCHES.map((n) => [n, null]), ...EXTREMES.map(([n, e]) => [n, e])];
  const res = await pool(cases.map(([name, extra]) => async () => {
    const { ctx, page, errors } = await open();
    try {
      const out = await page.evaluate(async ([n, e, knob]) => {
        if (e) applyPatch({ echo: e }); else if (n !== 'fábrica') applyPatch(FACTORY[n]);
        const pts = [];
        for (const v of knob) {
          P.echo.fb = v; applyEcho();
          await new Promise((ok) => setTimeout(ok, 250));
          pts.push({ v, eff: window.__eff() });
        }
        return { pts, sat: P.echo.sat, tone: P.echo.tone, time: P.echo.time, sr: ctx.sampleRate, peak: window.__peak(P.echo.tone, ctx.sampleRate) };
      }, [name, extra, KNOB]);
      return { name, ...out, errors };
    } finally { await ctx.close(); }
  }));
  for (const r of res) {
    const kH = 1.5 * r.sat * r.peak.m, L = ceilOf(r.time);
    const G = r.pts.map((x) => x.eff * kH);
    const below = r.pts.filter((x) => x.v * kH <= KNEE * L);
    console.log(`  ${r.name.padEnd(13)} SAT ${r.sat} · TONE ${r.tone} · TIME ${r.time} · pico ${r.peak.m.toFixed(4)} (nodo ${r.peak.node.toFixed(4)}) · L ${L.toFixed(3)} · lazo ${G.map((g) => g.toFixed(3)).join(' ')}`);
    assert.ok(Math.abs(r.peak.m - r.peak.node) < 2e-3 * r.peak.m, `${r.name}: el pico de la fórmula (${r.peak.m}) coincide con getFrequencyResponse (${r.peak.node})`);
    G.forEach((g, i) => assert.ok(g <= L * (1 + 1e-3), `${r.name}: perilla ${KNOB[i]} → lazo ${g.toFixed(4)} por encima del techo ${L.toFixed(4)}`));
    assert.ok(Math.abs(G[G.length - 1] - L) <= 2e-3 * L, `${r.name}: con la perilla al máximo el lazo es el techo (${G[G.length - 1].toFixed(4)} vs ${L.toFixed(4)})`);
    for (let i = 1; i < G.length; i++) assert.ok(G[i] > G[i - 1], `${r.name}: el lazo tiene que crecer con la perilla (${KNOB[i - 1]} → ${KNOB[i]}: ${G[i - 1].toFixed(4)} → ${G[i].toFixed(4)})`);
    for (const x of below) assert.ok(Math.abs(x.eff - x.v) < 1e-4, `${r.name}: bajo la rodilla la perilla ${x.v} tiene que quedar igual (efectivo ${x.eff})`);
    r.pts.forEach((x) => assert.ok(Math.abs(x.eff - effOf(x.v, kH, r.time)) < 1e-4, `${r.name}: perilla ${x.v} → efectivo ${x.eff}, esperado ${effOf(x.v, kH, r.time)}`));
    assert.deepEqual(r.errors, []);
  }
  const fab = res.find((r) => r.name === 'fábrica');
  assert.ok(Math.abs(fab.pts.find((x) => x.v === 0.25).eff - 0.25) < 1e-4, 'patch de fábrica: FEEDBACK 0,25 queda igual');
});

/** Ganancia del lazo medida como en F2b: semilla de −80 dB en echoIn (con el VCA en 0 no entra nada más). */
async function seed(name, variant, hz) {
  const { ctx, page, errors } = await open();
  try {
    const p = await setup(page, name, variant);
    await page.waitForTimeout(1000);
    const t0 = await page.evaluate((f) => {
      const sr = ctx.sampleRate, n = Math.round(0.02 * sr), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = 1e-4 * Math.sin(2 * Math.PI * f * i / sr) * Math.sin(Math.PI * i / n) ** 2;
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(echoIn);
      const t = ctx.currentTime + 0.05; s.start(t); return t;
    }, hz);
    const W = p.time, N = Math.ceil(16 / W);
    await page.waitForFunction((t) => window.__mLast >= t, t0 + W * N, { timeout: 40000 });
    const c = (await page.evaluate(([a, w, n]) => window.__curve(a, w, n), [t0, W, N])).map((x) => dB(x.rms));
    const pts = c.map((v, i) => [i * W + W / 2, v]).filter(([t, v]) => t > W && v > -160 && v < -45);
    const n = pts.length, sx = pts.reduce((a, q) => a + q[0], 0), sy = pts.reduce((a, q) => a + q[1], 0);
    const sxx = pts.reduce((a, q) => a + q[0] * q[0], 0), sxy = pts.reduce((a, q) => a + q[0] * q[1], 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { hz, p, n, perRep: slope * p.time, gain: 10 ** (slope * p.time / 20), errors };
  } finally { await ctx.close(); }
}

test('2b · techo medido como en F2b (semilla en los picos de los filtros), perilla al máximo', async () => {
  const jobs = [];
  for (const variant of [{ fbMax: true }, { fbMax: true, time: 2 }]) for (const hz of [219, 2600]) jobs.push(() => seed('fábrica', variant, hz));
  const res = await pool(jobs);
  for (const r of res) {
    const L = ceilOf(r.p.time);
    console.log(`  fábrica · perilla al máx. · TIME ${r.p.time} s · ${r.hz} Hz: ${r.perRep >= 0 ? '+' : ''}${r.perRep.toFixed(2)} dB/repetición → lazo ${r.gain.toFixed(3)} (techo ${L.toFixed(3)}, ${r.n} puntos)`);
    assert.ok(r.n >= 4, 'control: la recta se ajustó con al menos 4 repeticiones');
    assert.ok(r.gain <= L + 0.01, `lazo medido ${r.gain.toFixed(3)} por encima del techo ${L.toFixed(3)} (TIME ${r.p.time}, ${r.hz} Hz)`);
    assert.ok(r.gain >= L - 0.06, `lazo medido ${r.gain.toFixed(3)} muy por debajo del techo ${L.toFixed(3)}: la perilla al máximo tiene que llegar al techo`);
    assert.deepEqual(r.errors, []);
  }
});

// ───────────────────────────── 3 · más perilla, cola más larga ─────────────────────────────

test('3 · fábrica con la perilla en 0,25 · 0,5 · 0,8 · 1,1: la cola crece y siempre se apaga', async () => {
  const knob = [0.25, 0.5, 0.8, 1.1];
  const res = await pool(knob.map((fb) => () => tail('fábrica', { fb })));
  for (const r of res) console.log(`  ${show(r)} · energía 0–30 s ${fmt(r.energy, 2)} dB`);
  for (let i = 0; i < res.length; i++) {
    assert.ok(!res[i].never && res[i].t60 <= 30, `${label(res[i])}: < −60 dBFS antes de 30 s`);
    if (i) assert.ok(res[i].energy > res[i - 1].energy, `más perilla, más cola: ${knob[i - 1]} → ${knob[i]} da ${fmt(res[i - 1].energy, 2)} → ${fmt(res[i].energy, 2)} dB`);
    if (i) assert.ok(res[i].t60 >= res[i - 1].t60, `más perilla, no menos tiempo: ${knob[i - 1]} → ${knob[i]} da ${fmt(res[i - 1].t60)} → ${fmt(res[i].t60)} s`);
  }
});

// ───────────────────────────────── 4 · ∞ intacto ─────────────────────────────────

/** Render repetible: ∞ (desde antes de la nota o al soltar), nota de 1 s en frames fijos; graba la salida `rec` s. */
async function takeInf(path, { infBefore, rec, infRelease = null }) {
  const { ctx, page, errors } = await open({ path, init: REPEAT, patch: () => {} });
  try {
    const { t0, sr } = await page.evaluate(() => ({ t0: ctx.__t0, sr: ctx.sampleRate }));
    assert.ok(t0 > 0, 'control: las fuentes arrancaron alineadas');
    const tOn = t0 + 3, tOff = tOn + 1;
    await page.evaluate(() => { window.__cap = window.__capOn(ctx); });
    await page.waitForFunction((t) => ctx.currentTime > t, tOn - 0.8, { timeout: 15000 });
    await page.evaluate(([t, n]) => { window.__got = window.__cap(t, n); }, [tOn - 0.05, Math.round((0.05 + 1 + rec) * sr)]);
    if (infBefore) await page.evaluate((T) => window.__at(T, () => setFbInf(true)), tOn - 0.5);
    await page.evaluate((T) => window.__at(T, () => noteOn('pad', 57)), tOn);
    await page.waitForFunction((t) => ctx.currentTime > t, tOff - 0.3, { timeout: 15000 });
    await page.evaluate(([T, inf]) => window.__at(T, () => { noteOff('pad'); if (inf) setFbInf(true); }), [tOff, !infBefore]);
    if (infRelease != null) {
      await page.waitForFunction((t) => ctx.currentTime > t, tOff + infRelease - 0.3, { timeout: 30000 });
      await page.evaluate((T) => window.__at(T, () => setFbInf(false)), tOff + infRelease);
    }
    await page.waitForFunction((t) => ctx.currentTime > t, tOff + rec + 0.2, { timeout: (rec + 30) * 1000 });
    const inf = await page.evaluate(() => window.__eff());   // todavía con ∞ (salvo infRelease)
    const got = await page.evaluate(async () => { const g = await window.__got; return { sr: g.sr, bufs: g.bufs.map((b) => Array.from(b)) }; });
    return { ...got, inf, pre: 0.05, errors };
  } finally { await ctx.close(); }
}
const rmsAt = (g, a, b) => { let ss = 0, n = 0; for (const d of g.bufs) for (let i = Math.round(a * g.sr); i < Math.min(d.length, Math.round(b * g.sr)); i++) { ss += d[i] * d[i]; n++; } return dB(Math.sqrt(ss / n)); };

test('4 · ∞ intacto: misma salida que el commit base con ∞ puesto; al soltarlo, la cola decae', async (t) => {
  if (!baseHtml) { t.skip(`sin git o sin la base ${BASE}`); return; }
  // ∞ desde antes de la nota: el lazo es el mismo desde el primer sonido
  const [a, b] = await Promise.all([takeInf(URL_PATH, { infBefore: true, rec: 7 }), takeInf(BASE_PATH, { infBefore: true, rec: 7 })]);
  const sec = (g) => [1, 2, 3, 4, 5, 6, 7].map((s) => rmsAt(g, g.pre + s, g.pre + s + 1));
  const sa = sec(a), sb = sec(b);
  console.log(`  ∞ desde antes de la nota · FEEDBACK efectivo con ∞: ahora ${a.inf} · antes ${b.inf} · salida, RMS por segundo: ahora ${sa.map((x) => fmt(x, 2)).join(' · ')} · antes ${sb.map((x) => fmt(x, 2)).join(' · ')}`);
  assert.ok(Math.abs(a.inf - 1.06) < 1e-6 && Math.abs(b.inf - 1.06) < 1e-6, `con ∞ el FEEDBACK efectivo es 1,06 (ahora ${a.inf}, antes ${b.inf})`);
  assert.ok(sa[0] > -12, 'control: con ∞ el eco autooscila fuerte');
  sa.forEach((x, i) => assert.ok(Math.abs(x - sb[i]) <= 0.05, `∞: segundo ${i + 1}, ${fmt(x, 3)} vs ${fmt(sb[i], 3)} dBFS`));
  // ∞ al soltar SIREN (como en F2b), sostenido 6 s; después se suelta
  const [c, e] = await Promise.all([takeInf(URL_PATH, { infBefore: false, rec: 6.5 }), takeInf(BASE_PATH, { infBefore: false, rec: 6.5 })]);
  const lc = rmsAt(c, c.pre + 1 + 2, c.pre + 1 + 6), le = rmsAt(e, e.pre + 1 + 2, e.pre + 1 + 6);
  console.log(`  ∞ al soltar SIREN · segundos 2–6: ahora ${fmt(lc, 2)} · antes ${fmt(le, 2)} dBFS RMS`);
  assert.ok(lc > -12 && Math.abs(lc - le) <= 0.5, `∞ al soltar: mismo nivel que antes (${fmt(lc, 2)} vs ${fmt(le, 2)} dBFS)`);
  // soltar ∞ después de 6 s: la cola decae
  const r = await tailAfterInf();
  console.log(`  al soltar ∞ (6 s): < −60 dBFS a los ${r.never ? 'nunca' : fmt(r.t60) + ' s'} · crecimiento ${fmt(r.grow)} dB`);
  assert.ok(!r.never && r.t60 <= 30 && r.grow <= 0.5, 'al soltar ∞ la cola decae por debajo de −60 dBFS antes de 30 s');
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors, ...e.errors, ...r.errors], []);
});
async function tailAfterInf() {
  const { ctx, page, errors } = await open();
  try {
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(1000);
    await page.evaluate(() => { noteOff('pad'); setFbInf(true); });
    await page.waitForTimeout(6000);
    const tRel = await page.evaluate(() => { setFbInf(false); return ctx.currentTime; });
    const T = await page.evaluate(() => P.echo.time), W = T * Math.ceil(1 / T), N = Math.ceil(34 / W);
    await page.waitForFunction((t) => window.__mLast >= t, tRel + W * N, { timeout: 60000 });
    const v = (await page.evaluate(([a, w, n]) => window.__curve(a, w, n), [tRel, W, N])).map((x) => dB(x.rms));
    let last = -1; v.forEach((x, i) => { if (x >= -60) last = i; });
    let low = Infinity, grow = 0; v.forEach((x, i) => { if (i > 0 && x > -120) grow = Math.max(grow, x - low); low = Math.min(low, x); });
    return { t60: (last + 1) * W, never: last === v.length - 1, grow, errors };
  } finally { await ctx.close(); }
}

// ───────────────────────── 5 · feedback bajo: las repeticiones no cambian ─────────────────────────

async function takeLow(path, name, fb) {
  const { ctx, page, errors } = await open({ path, init: REPEAT, patch: new Function(`${name !== 'fábrica' ? `applyPatch(FACTORY[${JSON.stringify(name)}]);` : ''}${fb != null ? `applyPatch({ echo: { fb: ${fb} } });` : ''}`) });
  try {
    const { t0, sr, time } = await page.evaluate(() => ({ t0: ctx.__t0, sr: ctx.sampleRate, time: P.echo.time }));
    const tOn = t0 + 3, tOff = tOn + 1, rec = 14;
    await page.evaluate(() => { window.__cap = window.__capOn(ctx); });
    await page.waitForFunction((t) => ctx.currentTime > t, tOn - 0.4, { timeout: 15000 });
    await page.evaluate(([t, n]) => { window.__got = window.__cap(t, n); }, [tOff, Math.round(rec * sr)]);
    await page.evaluate((T) => window.__at(T, () => noteOn('pad', 57)), tOn);
    await page.waitForFunction((t) => ctx.currentTime > t, tOff - 0.3, { timeout: 15000 });
    await page.evaluate((T) => window.__at(T, () => noteOff('pad')), tOff);
    await page.waitForFunction((t) => ctx.currentTime > t, tOff + rec + 0.2, { timeout: 40000 });
    const g = await page.evaluate(async () => { const x = await window.__got; return { sr: x.sr, bufs: x.bufs.map((b) => Array.from(b)) }; });
    // una ventana por repetición
    const reps = []; for (let s = 0; s + time <= rec; s += time) reps.push(rmsAt(g, s, s + time));
    return { reps, time, errors };
  } finally { await ctx.close(); }
}

test('5 · feedback bajo (fábrica 0,1 y 0,25; Police Alarm 0,3): cada repetición ±0,5 dB contra el commit base', async (t) => {
  if (!baseHtml) { t.skip(`sin git o sin la base ${BASE}`); return; }
  const cases = [['fábrica', 0.1], ['fábrica', 0.25], ['Police Alarm', null]];
  const res = await pool(cases.flatMap(([n, fb]) => [() => takeLow(URL_PATH, n, fb), () => takeLow(BASE_PATH, n, fb)]));
  cases.forEach(([n, fb], i) => {
    const now = res[2 * i], base = res[2 * i + 1];
    const audible = base.reps.map((x, k) => [k, x]).filter(([, x]) => x > -60);
    const worst = Math.max(...audible.map(([k, x]) => Math.abs(now.reps[k] - x)));
    console.log(`  ${n}${fb != null ? ' · FEEDBACK ' + fb : ' (FEEDBACK 0,3)'} · ${audible.length} repeticiones por encima de −60 dBFS · mayor diferencia ${worst.toFixed(3)} dB · primeras: antes ${base.reps.slice(0, 5).map((x) => fmt(x)).join(' ')} · ahora ${now.reps.slice(0, 5).map((x) => fmt(x)).join(' ')}`);
    assert.ok(audible.length >= 5, 'control: se comparan al menos 5 repeticiones');
    assert.ok(worst <= 0.5, `${n}: las repeticiones tienen que quedar ±0,5 dB (difieren ${worst.toFixed(3)} dB)`);
    assert.deepEqual([...now.errors, ...base.errors], []);
  });
});

// ─────────────────────────────── 6 · valores guardados ───────────────────────────────

test('6 · valores guardados: mismo formato que antes y leídos con la escala nueva', async (t) => {
  // el formato: currentPatch() del mismo patch, idéntico en las dos versiones
  if (baseHtml) {
    const one = async (path) => {
      const { ctx, page } = await open({ path });
      try { return await page.evaluate((names) => names.map((n) => { applyPatch(FACTORY[n]); return JSON.stringify(currentPatch()); }).join('\n'), PRESETS); }
      finally { await ctx.close(); }
    };
    const [now, base] = await Promise.all([one(URL_PATH), one(BASE_PATH)]);
    console.log(`  currentPatch() de los 6 presets: ${now === base ? 'idéntico' : 'DISTINTO'} al de ${BASE} (${now.length} caracteres)`);
    assert.equal(now, base, 'el formato de lo que se guarda no cambia');
  } else t.diagnostic(`sin la base ${BASE}: se saltea la comparación del formato`);

  const { ctx, page, errors } = await open();
  try {
    const exp = async (v) => { const s = await page.evaluate(() => ({ sat: P.echo.sat, tone: P.echo.tone, time: P.echo.time, sr: ctx.sampleRate, peak: window.__peak(P.echo.tone, ctx.sampleRate).m })); return effOf(v, 1.5 * s.sat * s.peak, s.time); };
    const eff = () => page.waitForTimeout(300).then(() => page.evaluate(() => window.__eff()));
    // autoguardado: la perilla en 0,9, se guarda, se recarga y se vuelve a encender
    await page.evaluate(async () => { P.echo.fb = 0.9; applyEcho(); await Session.saveNow(); });
    const stored = await page.evaluate(async () => (await Session.load()).data.patch.echo.fb);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.click('#power');
    await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
    const restored = { fb: await page.evaluate(() => P.echo.fb), eff: await eff() };
    // slot: guardar con 0,9, mover la perilla, cargar el slot
    await page.evaluate(() => { document.getElementById('slotName').value = 'cola 0,9'; saveSlot(); P.echo.fb = 0.1; applyEcho(); });
    const slotFb = await page.evaluate(() => { const s = slots.find((x) => x.name === 'cola 0,9'); applyPatch(s.patch); return s.patch.echo.fb; });
    const slot = await eff();
    // JSON viejo (patch suelto, como dubsiren-patch.json) y sesión con envoltorio
    await page.evaluate(() => importObject(Object.assign({ __hackwave: 'dub-siren', v: 3 }, FACTORY['UFO Random']), 'test'));
    const json = { fb: await page.evaluate(() => P.echo.fb), eff: await eff(), exp: await exp(0.55) };
    // preset
    await page.evaluate(() => applyPatch(FACTORY['Feedback Dub']));
    const preset = { fb: await page.evaluate(() => P.echo.fb), eff: await eff(), exp: await exp(0.72) };
    await page.evaluate(() => applyPatch({ echo: { time: 0.38, fb: 0.9, tone: 3400, sat: 1.8 } }));
    const want09 = await exp(0.9);
    console.log(`  autoguardado: guarda ${stored}, al recargar P.echo.fb ${restored.fb} → efectivo ${restored.eff.toFixed(4)} · slot ${slotFb} → ${slot.toFixed(4)} · JSON viejo (UFO) ${json.fb} → ${json.eff.toFixed(4)} (esperado ${json.exp.toFixed(4)}) · preset Feedback Dub ${preset.fb} → ${preset.eff.toFixed(4)} (esperado ${preset.exp.toFixed(4)}) · 0,9 de fábrica → ${want09.toFixed(4)}`);
    assert.equal(stored, 0.9, 'el autoguardado guarda el valor de la perilla, no el efectivo');
    assert.equal(restored.fb, 0.9, 'al recargar se lee el mismo número');
    assert.ok(Math.abs(restored.eff - want09) < 1e-4 && Math.abs(slot - want09) < 1e-4, 'autoguardado y slot se interpretan con la escala nueva');
    assert.equal(slotFb, 0.9);
    assert.ok(json.fb === 0.55 && Math.abs(json.eff - json.exp) < 1e-4, 'JSON viejo: mismo número, escala nueva');
    assert.ok(preset.fb === 0.72 && Math.abs(preset.eff - preset.exp) < 1e-4, 'preset: mismo número, escala nueva');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
