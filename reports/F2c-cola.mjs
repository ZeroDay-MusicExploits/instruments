#!/usr/bin/env node
// reports/F2c-cola.mjs
//
// Mediciones de reports/F2c.md. No es un test de aceptación (ese es
// tools/tests/j4-cola.test.mjs): mide y no falla.
//
// "Cola" = la salida (RMS, ventanas de un número entero de repeticiones del eco:
// TIME × ⌈1 s / TIME⌉) desde que se suelta SIREN después de 1 s, durante 34 s.
// De cada toma: cuándo baja de −40 y de −60 dBFS (y se queda abajo) y el nivel a
// los 5, 10, 20 y 30 s.
//
//   presets   el patch de fábrica y los 6 presets, antes (commit base, sin
//             techo) y ahora; ahora también con la perilla al máximo y con la
//             perilla al máximo y TIME 2 s.
//   perilla   el patch de fábrica con FEEDBACK 0,1 · 0,25 · 0,4 · 0,6 · 0,8 · 1,1.
//   calibrar  (solo con --calibrar R1,R2,…) los 7 patches con la perilla al
//             máximo y TIME 2 s, con el techo calculado con cada R (dB/s):
//             la medición con la que se eligió R.
//
// Si el filtro ladder da NaN al tocar (bug previo, sobre todo en Acid Scream,
// ver F2c), la toma se descarta y se repite; se cuenta.
//
//   node reports/F2c-cola.mjs                      # presets y perilla (~7 min)
//   node reports/F2c-cola.mjs --only perilla
//   node reports/F2c-cola.mjs --only calibrar --calibrar 1.6,1.7,1.8
//   node reports/F2c-cola.mjs --json <archivo>
//
// Necesita Playwright + Chromium (no es dependencia del runtime).
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const CAL = arg('--calibrar') ? arg('--calibrar').split(',').map(Number) : null;
const ONLY = (arg('--only') || (CAL ? 'calibrar' : 'presets,perilla')).split(',');
const JSON_OUT = arg('--json');

const FILE = 'descargables/J4-Sirens_Station.html';
const URL_PATH = '/' + FILE;
const BASE = '27707d5';   // main antes del techo
const BASE_PATH = '/descargables/__base-J4.html';
const baseHtml = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
const PRESETS = ['Classic Wail', 'Police Alarm', 'Acid Scream', 'UFO Random', 'Cosmic Drone', 'Feedback Dub'];
const PATCHES = ['fábrica', ...PRESETS];

/* Tap de salida + medidor (RMS y muestras no finitas por bloque de 128). */
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
      const ch = inp[0] || []; let ss = 0, n = 0, bad = 0;
      for (const d of ch) { for (let i = 0; i < d.length; i++) { const v = d[i]; if (!(v - v === 0)) { bad++; continue; } ss += v * v; } n += d.length; }
      this.b.push(currentTime, n ? ss / n : 0, bad);
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
  window.__curve = (t0, w, n) => {
    const out = Array.from({ length: n }, () => ({ ss: 0, n: 0, bad: 0 }));
    const m = window.__m;
    for (let i = 0; i < m.length; i += 3) { const k = Math.floor((m[i] - t0) / w + 1e-9); if (k >= 0 && k < n) { out[k].ss += m[i + 1]; out[k].n++; out[k].bad += m[i + 2]; } }
    return out.map((o) => ({ rms: o.n ? Math.sqrt(o.ss / o.n) : 0, bad: o.bad }));
  };
  window.__bad = (t0, t1) => { let b = 0; const m = window.__m; for (let i = 0; i < m.length; i += 3) if (m[i] >= t0 && m[i] < t1) b += m[i + 2]; return b; };
};

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

let srv, browser, nanTakes = 0;

async function pool(jobs, n = 4) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

/** SIREN 1 s y la cola. variant: { fbMax, fb, time, R } (R: techo calculado con esos dB/s). */
async function tail(name, variant = {}, { path = URL_PATH, dur = 34 } = {}) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(INIT_TAP);
    const page = await ctx.newPage();
    try {
      await page.goto(srv.origin + path, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      await page.click('#power');
      await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
      await page.evaluate(() => window.__meterOn(ctx));
      const p = await page.evaluate(([n, v]) => {
        if (v.R) window.echoCeil = (time) => Math.min(0.97, Math.pow(10, -v.R * time / 20));
        if (n !== 'fábrica') applyPatch(FACTORY[n]);
        const echo = {};
        if (v.fbMax) echo.fb = 1.1; if (v.fb != null) echo.fb = v.fb; if (v.time != null) echo.time = v.time;
        if (Object.keys(echo).length) applyPatch({ echo }); else applyEcho();
        return { fb: P.echo.fb, time: P.echo.time };
      }, [name, variant]);
      await page.waitForTimeout(600);
      const tOn = await page.evaluate(() => { noteOn('pad', 57); return ctx.currentTime; });
      await page.waitForTimeout(1000);
      const tOff = await page.evaluate(() => { noteOff('pad'); return ctx.currentTime; });
      await page.waitForFunction((t) => window.__mLast >= t, tOff + 0.3, { timeout: 10000 });
      if (await page.evaluate(([a, b]) => window.__bad(a, b), [tOn, tOff + 0.3])) { nanTakes++; continue; }
      const W = p.time * Math.ceil(1 / p.time), N = Math.ceil(dur / W);
      await page.waitForFunction((t) => window.__mLast >= t, tOff + W * N, { timeout: (W * N + 20) * 1000 });
      const c = await page.evaluate(([t, w, n]) => window.__curve(t, w, n), [tOff, W, N]);
      const v = c.map((x) => dB(x.rms));
      const cross = (lim) => { let last = -1; v.forEach((x, i) => { if (x >= lim) last = i; }); return last === v.length - 1 ? null : (last + 1) * W; };
      const at = (s) => v[Math.min(v.length - 1, Math.max(0, Math.floor(s / W) - 1))];
      let low = Infinity, grow = 0; v.forEach((x, i) => { if (i > 0 && x > -120) grow = Math.max(grow, x - low); low = Math.min(low, x); });
      return { name, variant, p, W, t40: cross(-40), t60: cross(-60), lv: [5, 10, 20, 30].map(at), grow, attempt, bad: c.reduce((a, x) => a + x.bad, 0) };
    } finally { await ctx.close(); }
  }
  return { name, variant, failed: true };
}
const tt = (x) => (x == null ? 'no baja' : `${f1(x)} s`);

const out = {};
try {
  srv = await serveRoot(ROOT, { [BASE_PATH]: { body: baseHtml } });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  if (ONLY.includes('presets')) {
    console.log('\n── presets · SIREN 1 s y soltar: cuándo baja de −40 y de −60 dBFS RMS (y se queda abajo), y el nivel a 5/10/20/30 s ──');
    const jobs = [];
    for (const n of PATCHES) {
      jobs.push(() => tail(n, {}, { path: BASE_PATH }), () => tail(n), () => tail(n, { fbMax: true }), () => tail(n, { fbMax: true, time: 2 }));
    }
    const res = await pool(jobs);
    out.presets = res;
    for (let i = 0; i < PATCHES.length; i++) {
      const [antes, ahora, max, max2] = res.slice(4 * i, 4 * i + 4);
      console.log(`\n${PATCHES[i]} (TIME ${ahora.p.time} s · FEEDBACK ${ahora.p.fb})`);
      for (const [lbl, r] of [['antes', antes], ['ahora', ahora], ['ahora, perilla al máximo', max], ['ahora, perilla al máximo, TIME 2 s', max2]]) {
        if (r.failed) { console.log(`  ${lbl.padEnd(34)} (NaN del filtro en todas las tomas)`); continue; }
        console.log(`  ${lbl.padEnd(34)} −40: ${tt(r.t40).padStart(8)} · −60: ${tt(r.t60).padStart(8)} · ${r.lv.map(f1).join(' / ')} dBFS · crecimiento ${f1(r.grow)} dB${r.attempt > 1 ? ` · ${r.attempt - 1} toma(s) con NaN` : ''}`);
      }
    }
  }

  if (ONLY.includes('perilla')) {
    console.log('\n── perilla · patch de fábrica, FEEDBACK de 0,1 a 1,1 (antes y ahora) ──');
    const knob = [0.1, 0.25, 0.4, 0.6, 0.8, 1.1];
    const res = await pool(knob.flatMap((fb) => [() => tail('fábrica', { fb }, { path: BASE_PATH }), () => tail('fábrica', { fb })]));
    out.perilla = res;
    knob.forEach((fb, i) => {
      const [a, b] = [res[2 * i], res[2 * i + 1]];
      console.log(`  FEEDBACK ${String(fb).padEnd(4)} antes −60: ${tt(a.t60).padStart(8)} (${a.lv.map(f1).join(' / ')}) · ahora −40: ${tt(b.t40).padStart(7)} · −60: ${tt(b.t60).padStart(7)} (${b.lv.map(f1).join(' / ')} dBFS a 5/10/20/30 s)`);
    });
  }

  if (ONLY.includes('calibrar')) {
    const Rs = CAL || [1.6, 1.7, 1.8];
    console.log(`\n── calibrar · los 7 patches, perilla al máximo, TIME 2 s, techo con R = ${Rs.join(' / ')} dB/s ──`);
    const jobs = []; for (const n of PATCHES) for (const R of Rs) jobs.push(() => tail(n, { fbMax: true, time: 2, R }));
    const res = await pool(jobs);
    out.calibrar = res;
    for (const n of PATCHES) {
      console.log(`  ${n.padEnd(13)} ${Rs.map((R) => { const r = res.find((x) => x.name === n && x.variant.R === R); return `R ${R}: −60 ${r.failed ? 'NaN' : tt(r.t60)} (crec. ${r.failed ? '—' : f1(r.grow)})`; }).join(' · ')}`);
    }
  }
  console.log(`\ntomas descartadas por NaN del filtro ladder: ${nanTakes}`);
} finally {
  if (browser) await browser.close();
  if (srv) await srv.close();
}
if (JSON_OUT) { out.nanTakes = nanTakes; writeFileSync(JSON_OUT, JSON.stringify(out, null, 1)); console.log(`JSON: ${JSON_OUT}`); }
