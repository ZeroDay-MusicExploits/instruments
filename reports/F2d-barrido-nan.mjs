#!/usr/bin/env node
// reports/F2d-barrido-nan.mjs — barrido de NaN en Acid Bass-303, Nebularp 2035 y
// CronBeat-8:08 (F2d, parte 3). No arregla nada y no es un test: mide.
// Resultados en reports/F2d-barrido-nan.md.
//
// El mismo fuzz determinista (semilla fija) que en MonoMoon, por la UI y sin
// conocer el motor: cada perilla (role=slider, por teclado: Inicio, Fin, RePág,
// AvPág, flechas, como ZD.ui.a11ySlider) y cada slider (input type=range, valor
// + 'input'), con peso a los extremos; los botones de modo de filtro, onda y
// patrón; el transporte; y en Nebularp, las teclas del acorde. Con el
// instrumento sonando todo el tiempo.
//
// Sondas: muestras no finitas, pico y RMS en la salida (todo lo que va al
// destino) por bloque; el primer no finito con las últimas acciones y el valor
// de todas las perillas en ese momento; errores y warnings de consola.
// Silencio permanente: al final, sin recargar, parar y volver a arrancar el
// transporte (Nebularp: con el acorde latcheado) y medir 2 s.
//
// Además, una grilla determinista de los controles de filtro (corte × resonancia
// en 0, 25, 50, 75 y 100 %) y del drive/fuzz donde lo hay, sonando.
//
//   node reports/F2d-barrido-nan.mjs                        # los 3, --minutes 10 cada uno, en paralelo
//   node reports/F2d-barrido-nan.mjs --only acid --minutes 2
//   node reports/F2d-barrido-nan.mjs --sr 48000
//   node reports/F2d-barrido-nan.mjs --only nodo              # los worklets de Acid en Node (segundos)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MINUTES = +arg('minutes', 10);
const SR = +arg('sr', 0);
const ONLY = arg('only', 'acid,nebularp,cronbeat').split(',');

const INST = {
  acid: {
    file: 'descargables/Acid_Bass-303.html', name: 'Acid Bass-303', seed: 0xac1d,
    async start(page) { await page.click('#playBtn'); },
    async stop(page) { await page.click('#playBtn'); },
    audible: async (page) => page.evaluate(() => { const b = document.querySelector('#modeSeg button[data-mode="0"]'); if (b) b.click(); }),
    buttons: ['#modeSeg button', '#waveSeg button', '#subOctSeg button', '#randBtn', '#mutBtn'],
    filter: [/corte|cutoff/i, /reso/i], drive: [/drive/i, /fuzz/i],
  },
  nebularp: {
    file: 'descargables/Nebularp_2035.html', name: 'Nebularp 2035', seed: 0x2035,
    async start(page) {
      if ((await page.getAttribute('#latch', 'aria-pressed')) !== 'true') await page.click('#latch');
      const keys = await page.$$('.pkey.white');
      for (const i of [0, 2, 4]) { const b = await keys[i].boundingBox(); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.8); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); } }
      if ((await page.getAttribute('#play', 'aria-pressed')) !== 'true') await page.click('#play');
    },
    async stop(page) { if ((await page.getAttribute('#play', 'aria-pressed')) === 'true') await page.click('#play'); },
    buttons: ['#patternSeg button', '#subdivSeg button', '#octSeg button', '#scaleSeg button', '#euclidTgl'],
    keys: '.pkey', filter: [/corte|cutoff|brillo/i, /reso|q\b/i], drive: [],
  },
  cronbeat: {
    file: 'descargables/CronBeat-808.html', name: 'CronBeat-8:08', seed: 0x808,
    async start(page) { if ((await page.getAttribute('#run', 'aria-pressed')) !== 'true') await page.click('#run'); },
    async stop(page) { if ((await page.getAttribute('#run', 'aria-pressed')) === 'true') await page.click('#run'); },
    // los sliders de FX están en su pestaña: se arranca ahí y el fuzz rota entre Secuenciador, Pads y FX
    prep: async (page) => { await page.click('#tabFx'); },
    buttons: ['#tabSeq', '#tabPads', '#tabFx', '#fxView button[data-c]'], filter: [/^#dlyFb$/, /^#phFb$/], drive: [/^#drvTone$/],
  },
};

const INIT = ({ sr }) => {
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(o) { super(sr ? Object.assign({}, o, { sampleRate: sr }) : o); window.__ctx = this; } };
  const conn = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = conn.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) { const c = dest.context; if (!c.__tap) c.__tap = c.createGain(); conn.call(this, c.__tap); }
    return r;
  };
  const CODE = `registerProcessor('nan-meter', class extends AudioWorkletProcessor {
    constructor(){ super(); this.bad = 0; this.first = -1; this.w = []; this.ss = 0; this.n = 0; this.pk = 0; this.t0 = currentTime;
      this.port.onmessage = () => this.port.postMessage({ bad: this.bad, first: this.first, w: this.w }); }
    process(inp){ const ch = inp[0] || [];
      for (const d of ch) for (let i = 0; i < d.length; i++) { const v = d[i];
        if (!(v - v === 0)) { this.bad++; if (this.first < 0) this.first = currentTime + i / sampleRate; continue; }
        const a = v < 0 ? -v : v; if (a > this.pk) this.pk = a; this.ss += v * v; this.n++; }
      if (currentTime - this.t0 >= 0.25) { this.w.push([+currentTime.toFixed(2), this.n ? Math.sqrt(this.ss / this.n) : 0, this.pk]); if (this.w.length > 6000) this.w.shift(); this.ss = 0; this.n = 0; this.pk = 0; this.t0 = currentTime; }
      return true; } });`;
  window.__meterOn = async () => {
    const c = window.__ctx; if (!c || c.__nm) return !!c;
    if (!c.__tap) c.__tap = c.createGain();
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' })));
    const m = new AudioWorkletNode(c, 'nan-meter'); const mute = c.createGain(); mute.gain.value = 0;
    conn.call(c.__tap, m); conn.call(m, mute); conn.call(mute, c.destination); c.__nm = m; return true;
  };
  window.__read = () => new Promise((ok) => { const m = window.__ctx.__nm; m.port.onmessage = (e) => ok(e.data); m.port.postMessage(0); });
  /** Todos los controles continuos visibles del instrumento (no los del shell ni de los bloques). */
  window.__controls = () => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('.zd-scrim,#zd-sheet,.zd-pwa-banner,#zd-top'); };
    const dials = Array.from(document.querySelectorAll('[role=slider]')).filter((e) => vis(e) && !/^zd-/.test(e.id || '') && e.tagName !== 'INPUT');
    const ranges = Array.from(document.querySelectorAll('input[type=range]')).filter((e) => vis(e) && !e.classList.contains('kslider'));
    return { dials, ranges };
  };
  window.__label = (e) => e.getAttribute('aria-label') || (e.id ? '#' + e.id : '') || (e.closest('[aria-label]') || {}).ariaLabel || '?';
  window.__snapshot = () => { const { dials, ranges } = window.__controls(); const o = {};
    for (const d of dials) o[window.__label(d)] = d.getAttribute('aria-valuetext') || d.getAttribute('aria-valuenow');
    for (const r of ranges) o[window.__label(r)] = r.value;
    return o; };
};

let srv, browser;
async function run(key, minutes) {
  const I = INST[key];
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await bctx.addInitScript(INIT, { sr: SR });
  const page = await bctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss());
  await page.goto(srv.origin + '/' + I.file, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await I.start(page);
  await page.waitForFunction(() => window.__ctx && window.__ctx.state === 'running', null, { timeout: 15000 });
  await page.evaluate(() => window.__meterOn());
  if (I.prep) await I.prep(page);
  await page.waitForTimeout(800);
  let s = I.seed;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const actions = [];
  const ctxT = () => page.evaluate(() => window.__ctx.currentTime);
  /** Mueve un control: dial por teclado o range por valor. `n` en 0..1 (o null = paso al azar). */
  const move = async (kind, idx, n) => page.evaluate(([kind, idx, n, r]) => {
    const { dials, ranges } = window.__controls();
    if (kind === 'dial') {
      const d = dials[idx % dials.length]; if (!d) return null; d.focus();
      const key = (k, times = 1) => { for (let i = 0; i < times; i++) d.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
      if (n === 0) key('Home'); else if (n === 1) key('End');
      else if (n != null) { key('Home'); key('PageUp', Math.round(n * 10)); }
      else key(r < 0.5 ? 'PageUp' : 'PageDown', 1 + Math.floor(r * 3));
      return { label: window.__label(d), value: d.getAttribute('aria-valuetext') || d.getAttribute('aria-valuenow') };
    }
    const e = ranges[idx % ranges.length]; if (!e) return null;
    const min = +e.min || 0, max = e.max === '' ? 100 : +e.max, v = n == null ? min + r * (max - min) : min + n * (max - min);
    e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    return { label: window.__label(e), value: e.value };
  }, [kind, idx, n, rnd()]);
  const counts = await page.evaluate(() => { const c = window.__controls(); return { dials: c.dials.length, ranges: c.ranges.length, labels: [...c.dials, ...c.ranges].map(window.__label) }; });

  // 1) grilla determinista de los controles de filtro y drive
  const find = (re) => counts.labels.findIndex((l) => re.test(l));
  const grid = [];
  const fIdx = I.filter.map(find), dIdx = I.drive.map(find);
  const kindOf = (i) => (i < counts.dials ? ['dial', i] : ['range', i - counts.dials]);
  if (fIdx[0] >= 0) {
    for (const a of [0, 0.25, 0.5, 0.75, 1]) for (const b of (fIdx[1] >= 0 ? [0, 0.25, 0.5, 0.75, 1] : [null])) {
      const ra = await move(...kindOf(fIdx[0]), a); const rb = fIdx[1] >= 0 ? await move(...kindOf(fIdx[1]), b) : null;
      for (const di of dIdx) if (di >= 0) await move(...kindOf(di), (a + (b || 0)) % 1 > 0.5 ? 1 : 0);
      const t = await ctxT(); actions.push({ t, act: 'grilla', what: [ra, rb] });
      await page.waitForTimeout(300);
    }
    grid.push(`${counts.labels[fIdx[0]]}${fIdx[1] >= 0 ? ' × ' + counts.labels[fIdx[1]] : ''}${dIdx.filter((i) => i >= 0).map((i) => ' + ' + counts.labels[i]).join('')}`);
  }
  // 2) el fuzz
  const t0 = Date.now(), end = t0 + minutes * 60000;
  const buttons = [];
  for (const sel of I.buttons) buttons.push(...(await page.$$(sel)));
  const pkeys = I.keys ? await page.$$(I.keys) : [];
  let n = 0;
  while (Date.now() < end) {
    const a = rnd(); let what = null, act;
    if (a < 0.72) { const now = await page.evaluate(() => { const c = window.__controls(); return [c.dials.length, c.ranges.length]; }); const i = Math.floor(rnd() * (now[0] + now[1])); const r = rnd(); act = 'control'; what = await move(...(i < now[0] ? ['dial', i] : ['range', i - now[0]]), r < 0.2 ? 0 : r < 0.4 ? 1 : r < 0.7 ? null : rnd()); }
    else if (a < 0.86 && buttons.length) { const b = buttons[Math.floor(rnd() * buttons.length)]; act = 'botón'; what = await b.evaluate((e) => { e.click(); return { label: (e.closest('[aria-label]') ? e.closest('[aria-label]').getAttribute('aria-label') + ': ' : '') + e.textContent.trim().slice(0, 20) }; }).catch(() => null); }
    else if (a < 0.93 && pkeys.length) { const k = pkeys[Math.floor(rnd() * pkeys.length)]; const b = await k.boundingBox(); if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.8); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); } act = 'tecla'; }
    else if (a < 0.95) { await I.stop(page); await page.waitForTimeout(150); await I.start(page); act = 'transporte'; }
    else { act = 'espera'; await page.waitForTimeout(400); }
    actions.push({ t: await ctxT(), act, what });
    n++;
    await page.waitForTimeout(40 + Math.floor(rnd() * 220));
  }
  const meter = await page.evaluate(() => window.__read());
  // 3) silencio permanente: volumen y corte en valores audibles, parar, arrancar
  //    de nuevo y medir 2 s (sin recargar)
  const loud = counts.labels.map((l, i) => [l, i]).filter(([l]) => /vol|nivel|level|master|cutoff|corte/i.test(l) && !/env|lfo|send|env[ií]o|reverb|delay|eco/i.test(l));
  for (const [, i] of loud) await move(...kindOf(i), 0.75);
  if (I.audible) await I.audible(page);
  await I.stop(page); await page.waitForTimeout(500); await I.start(page);
  const tc = await ctxT(); await page.waitForTimeout(2300);
  const m2 = await page.evaluate(() => window.__read());
  const after = m2.w.filter(([t]) => t > tc + 0.25 && t <= tc + 2.25);
  const afterBad = m2.bad - meter.bad;
  const rms = Math.sqrt(after.reduce((x, [, r]) => x + r * r, 0) / Math.max(1, after.length));
  const firstActs = meter.first >= 0 ? actions.filter((x) => x.t <= meter.first + 0.05).slice(-6) : [];
  const snap = await page.evaluate(() => window.__snapshot());
  await bctx.close();
  const live = meter.w.slice(-240), silent = live.filter(([, r]) => r < 1e-5).length;
  return { key, name: I.name, minutes, n, counts: { dials: counts.dials, ranges: counts.ranges }, grid, bad: meter.bad, first: meter.first, firstActs, afterBad, rms, errs, snap, sr: SR || 'del sistema', loud: loud.map(([l]) => l), live: [live.length, silent] };
}

/* Los worklets de Acid (acid-svf y acid-osc) en Node, con el código real. */
function nodo() {
  const code = readFileSync(join(ROOT, INST.acid.file), 'utf8').match(/const WORKLET_CODE *= *`([\s\S]*?)`;/)[1];
  const mk = (name, sr) => { const C = {}; new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C[n] = c; }, sr); return new C[name](); };
  const svf = (sr, fcFn, res, mode) => {
    const L = mk('acid-svf', sr), B = 128, N = sr, inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]];
    const pr = { cutoff: new Float32Array(B), resonance: new Float32Array([res]), mode: new Float32Array([mode]) };
    let ph = 0, mx = 0;
    for (let b = 0; b * B < N; b++) {
      for (let n = 0; n < B; n++) { const t = (b * B + n) / sr; ph = (ph + 55 / sr) % 1; inp[0][0][n] = 2 * ph - 1; pr.cutoff[n] = Math.max(30, Math.min(16000, fcFn(t))); }
      L.process(inp, out, pr);
      for (const v of out[0][0]) { if (!Number.isFinite(v)) return 'NaN'; mx = Math.max(mx, Math.abs(v)); }
    }
    return mx.toFixed(1);
  };
  console.log('── acid-svf en Node (sierra de 55 Hz, 1 s): barrido 16 kHz → 30 Hz en LP/BP/HP con RESO 0 · 0,62 · 1, y corte fijo con RESO 1 en LP');
  for (const sr of [22050, 32000, 44100, 48000, 96000]) {
    const sweep = []; for (const res of [0, 0.62, 1]) for (const mode of [0, 1, 2]) sweep.push(svf(sr, (t) => 16000 * Math.exp(-t * 3) + 30, res, mode));
    const fixed = [8000, 11025, 12000, 15000, 16000].map((fc) => fc + ': ' + svf(sr, () => fc, 1, 0));
    console.log(`   ${sr} Hz · barrido: ${sweep.filter((x) => x === 'NaN').length} de 9 con NaN (${sweep.join(' ')}) · corte fijo: ${fixed.join(' · ')}`);
  }
  for (const sr of [22050, 44100, 48000]) {
    const L = mk('acid-osc', sr), B = 128, out = [[new Float32Array(B)]]; let bad = 0, mx = 0;
    for (const wf of [0, 1, 2, 3]) for (const f of [20, 110, 1000, 8000]) for (const uni of [1, 7]) {
      const pr = { frequency: new Float32Array([f]), detune: new Float32Array([4800]), waveform: new Float32Array([wf]), pwm: new Float32Array([0.02]), unison: new Float32Array([uni]), spread: new Float32Array([60]), subLevel: new Float32Array([1]), subOct: new Float32Array([-2]) };
      for (let b = 0; b < 200; b++) { L.process([], out, pr); for (const v of out[0][0]) { if (!Number.isFinite(v)) bad++; else mx = Math.max(mx, Math.abs(v)); } }
    }
    console.log(`── acid-osc en Node, ${sr} Hz, extremos (4 ondas, 20–8000 Hz, detune +4800 ¢, PWM 0,02, unison 7, spread 60 ¢, sub −2 oct al máximo): no finitas ${bad} · pico ${mx.toFixed(2)}`);
  }
}
if (ONLY.length === 1 && ONLY[0] === 'nodo') { nodo(); process.exit(0); }

srv = await serveRoot(ROOT);
const { chromium } = await loadPlaywright();
browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const res = await Promise.all(ONLY.map((k) => run(k, MINUTES)));
  for (const r of res) {
    const dB = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '−∞');
    console.log(`── ${r.name} (${r.minutes} min, ${r.n} acciones, ${r.counts.dials} perillas + ${r.counts.ranges} sliders, sampleRate ${r.sr})`);
    console.log(`   grilla: ${r.grid.join(' · ') || '(no encontré los controles de filtro)'}`);
    console.log(`   salida: muestras no finitas ${r.bad}${r.first >= 0 ? ' (la primera a los ' + r.first.toFixed(2) + ' s del contexto)' : ''}`);
    if (r.firstActs.length) console.log(`   acciones antes del primer no finito: ${r.firstActs.map((x) => x.t.toFixed(2) + ' ' + x.act + (x.what ? ' ' + JSON.stringify(x.what) : '')).join(' · ')}`);
    console.log(`   último minuto del fuzz: ${r.live[1]} de ${r.live[0]} ventanas de 0,25 s en silencio digital`);
    console.log(`   después, sin recargar (${r.loud.join(', ')} al 75 %, parar y volver a tocar): no finitas ${r.afterBad} · RMS ${dB(r.rms)} dBFS → ${r.afterBad ? 'sigue en NaN' : r.rms < 1e-5 ? 'silencio' : 'suena'}`);
    console.log(`   consola: ${r.errs.length ? Array.from(new Set(r.errs)).slice(0, 4).join(' | ') : '(nada)'}`);
  }
} finally { await browser.close(); await srv.close(); }
