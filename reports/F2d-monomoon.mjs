#!/usr/bin/env node
// reports/F2d-monomoon.mjs — diagnóstico de "colapsa y se resetea o reinicia" en
// MonoMoon'70 (F2d). No es un test: instrumenta el instrumento real, lo toca con
// un fuzz determinista y registra todo lo que puede verse como un colapso o un
// reinicio. Los resultados están en reports/F2d-monomoon.md.
//
// Sondas (antes de que cargue la página):
//   · muestras no finitas, pico y RMS en la salida (todo lo que va al destino) y
//     en la salida del filtro (engine.filter.output), por bloque de 128;
//   · processorerror de todo AudioWorkletNode ('moog-ladder', 'zd-rec-tap');
//   · cambios de estado del AudioContext (suspended, interrupted, running, closed);
//   · errores de consola, excepciones no capturadas y promesas rechazadas;
//   · cargas de la página (contador en sessionStorage y framenavigated), toasts
//     («Sesión restaurada», «Nueva versión»…), el overlay «Tocá para reanudar» y
//     el de encendido; escrituras y errores de IndexedDB y localStorage (cuota);
//   · llamadas a loadPatch, resetAll, restoreSession, clearAllKeys,
//     engine.panic, engine.loadState y Knob.reset (con quién llamó);
//   · cambios de engine.state que la acción del fuzz no explica;
//   · memoria (CDP Performance.getMetrics) cada minuto.
//
// Casos:
//   fuzz       el fuzz en escritorio (1280×860), teléfono (360×640 táctil) y
//              teléfono con la CPU limitada 4× (CDP), en paralelo, --minutes cada uno
//   filtmod    el mismo fuzz con Mod → Filtro y el Osc3 a frecuencia de audio
//   nofiltmod  el fuzz de escritorio sin Mod → Filtro (control)
//   worklet    qué hace MonoMoon si el worklet no carga (addModule falla) o si
//              'moog-ladder' tira una excepción en process() a mitad de la sesión
//   paths      caminos que se ven como "reinicio": doble toque en una macro,
//              Espacio, blur, «Tocá para reanudar», «Empezar de cero»
//   mapa       en Node, con el worklet de antes de la guarda (22fb1d2): dónde
//              diverge según la frecuencia del Osc3, la rueda Mod, RESO y el corte
//              (solo con --only mapa)
//
//   node reports/F2d-monomoon.mjs                         # todo (~11 min)
//   node reports/F2d-monomoon.mjs --only fuzz --minutes 2
//   node reports/F2d-monomoon.mjs --only worklet,paths
//   node reports/F2d-monomoon.mjs --json salida.json      # además, todo el registro
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';
import { drag, tap, doubleTap, touchPath, line } from '../tools/tests/lib/touch.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MINUTES = +arg('minutes', 10);
const ONLY = (arg('only', 'fuzz,filtmod,nofiltmod,worklet,paths')).split(',');
const JSON_OUT = arg('json', null);
const URL_PATH = '/descargables/MonoMoon70.html';

/* ─────────────── sondas (corren antes que la página) ─────────────── */
const INIT = ({ fail, failAt, diag }) => {
  const L = window.__log = [];
  const log = window.__f2dLog = (type, data) => { L.push(Object.assign({ type, t: +(performance.now() / 1000).toFixed(3) }, data || {})); };
  try { const n = +(sessionStorage.getItem('__f2d_loads') || 0) + 1; sessionStorage.setItem('__f2d_loads', String(n)); log('carga', { n, nav: (performance.getEntriesByType('navigation')[0] || {}).type }); } catch (e) {}
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(o) { super(o); log('ctx-nuevo', { sr: this.sampleRate, state: this.state }); this.addEventListener('statechange', () => log('ctx-estado', { state: this.state })); }
  };
  const AWN = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends AWN {
    constructor(c, name, o) {
      super(c, name, o);
      // Chromium lo despacha como 'error' (ErrorEvent); onprocessorerror es un alias
      const h = (e) => log('processorerror', { name, ev: e.type, msg: String(e && (e.message || (e.error && e.error.message)) || '') });
      this.addEventListener('processorerror', h); this.addEventListener('error', h);
    }
  };
  const add = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = async function (url, ...rest) {
    let txt = ''; try { txt = await (await fetch(url)).text(); } catch (e) {}
    if (txt.includes("registerProcessor('moog-ladder'")) {
      if (diag) {   // solo lee: dónde aparece el primer no finito y cuándo empieza a crecer el estado
        const probe = `out[i] = Math.tanh(this.out4);
      { const D = this.__d || (this.__d = { max: 0, t: {} }), a = Math.abs(this.out4), now = currentTime + i / sampleRate;
        if (a > D.max) D.max = a;
        for (const th of [1.5, 10, 1e3, 1e10]) if (!(th in D.t) && a > th) { D.t[th] = now; this.port.postMessage({ k: 'crece', th, t: now, base, mod, cutoff, fc, f, fb, res }); }
        // con la guarda: cuánto estuvo el estado por encima de 10 (salida clavada en ±1) antes de cada reinicio
        if (a > 10 && D.above == null) D.above = now;
        if ((this.__g || 0) !== (D.g || 0)) { D.g = this.__g; this.port.postMessage({ k: 'reinicio', t: now, sat: D.above == null ? 0 : now - D.above, base, mod, res }); D.above = null; }
        else if (a <= 1 && D.above != null) D.above = null;
        if (!D.bad) { const v = { x, out1: this.out1, out2: this.out2, out3: this.out3, out4: this.out4 };
          for (const kk in v) if (!Number.isFinite(v[kk])) { D.bad = 1; this.port.postMessage({ k: 'no-finito', var: kk, t: now, base, mod, cutoff, fc, f, fb, res, sr: sampleRate, crece: D.t }); break; } } }`;
        if (!txt.includes('out[i] = Math.tanh(this.out4);')) log('diag-sin-anclaje');
        // con la guarda (F2d), cada activación suma 1 en this.__g
        txt = txt.replace('if(!Number.isFinite(this.out4)){', 'if(!Number.isFinite(this.out4)){ this.__g=(this.__g||0)+1;');
        txt = txt.replace('out[i] = Math.tanh(this.out4);', probe);
        url = URL.createObjectURL(new Blob([txt], { type: 'application/javascript' }));
      }
      if (fail === 'addModule') { log('addModule-falla-forzada'); throw new DOMException('F2d: addModule forzado a fallar', 'AbortError'); }
      if (fail === 'throw') {
        txt = txt.replace('process(inputs, outputs, params){', `process(inputs, outputs, params){ if (currentTime > ${failAt}) throw new Error('F2d: excepción forzada en process()');`);
        url = URL.createObjectURL(new Blob([txt], { type: 'application/javascript' }));
      }
    }
    return add.call(this, url, ...rest);
  };
  window.addEventListener('error', (e) => log('error', { msg: String(e.message) }));
  window.addEventListener('unhandledrejection', (e) => log('promesa-rechazada', { msg: String(e.reason && (e.reason.message || e.reason)) }));
  for (const ev of ['blur', 'focus', 'pagehide', 'pageshow']) window.addEventListener(ev, () => log('ventana', { ev }));
  document.addEventListener('visibilitychange', () => log('ventana', { ev: 'visibility-' + document.visibilityState }));
  // almacenamiento
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    try { const r = put.apply(this, a); r.addEventListener('error', () => log('idb-error', { store: this.name, err: String(r.error && r.error.name) })); window.__idbPuts = (window.__idbPuts || 0) + 1; return r; }
    catch (e) { log('idb-error', { store: this.name, err: e.name }); throw e; }
  };
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    try { return setItem.call(this, k, v); } catch (e) { log('storage-error', { k, err: e.name }); throw e; }
  };
  // toasts y overlays
  const seen = new WeakSet();
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.addedNodes) if (n.nodeType === 1) {
        const ts = n.matches && n.matches('.zd-toast') ? [n] : Array.from(n.querySelectorAll ? n.querySelectorAll('.zd-toast') : []);
        for (const t of ts) if (!seen.has(t)) { seen.add(t); log('toast', { text: t.textContent.trim().slice(0, 120) }); }
      }
      if (m.type === 'attributes' && m.target.classList) {
        const el = m.target;
        if (el.classList.contains('zd-resume')) log('overlay-reanudar', { on: el.classList.contains('on') });
        if (el.id === 'powerOvl') log('overlay-encendido', { visible: !el.classList.contains('hidden') });
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  // medidores
  const conn = AudioNode.prototype.connect;
  window.__conn = conn;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = conn.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) { const c = dest.context; if (!c.__tap) c.__tap = c.createGain(); conn.call(this, c.__tap); }
    return r;
  };
  const CODE = `registerProcessor('f2d-meter', class extends AudioWorkletProcessor {
    constructor(){ super(); this.a = { bad: 0, firstBad: -1, pk: 0, ss: 0, n: 0, maxAbs: 0 }; this.w = { pk: 0, ss: 0, n: 0, bad: 0 }; this.wins = []; this.t0 = currentTime;
      this.port.onmessage = () => { this.port.postMessage({ a: this.a, wins: this.wins }); this.wins = []; }; }
    process(inp){ const ch = inp[0] || []; const a = this.a, w = this.w;
      for (const d of ch) for (let i = 0; i < d.length; i++) { const v = d[i];
        if (!(v - v === 0)) { a.bad++; w.bad++; if (a.firstBad < 0) a.firstBad = currentTime + i / sampleRate; continue; }
        const x = v < 0 ? -v : v; if (x > a.pk) a.pk = x; if (x > w.pk) w.pk = x; a.ss += v * v; w.ss += v * v; a.n++; w.n++; }
      if (currentTime - this.t0 >= 0.5) { this.wins.push([+this.t0.toFixed(2), w.pk, w.n ? Math.sqrt(w.ss / w.n) : 0, w.bad]); if (this.wins.length > 4000) this.wins.shift(); this.w = { pk: 0, ss: 0, n: 0, bad: 0 }; this.t0 = currentTime; }
      return true; } });`;
  window.__meters = {};
  window.__meter = async (c, node, id) => {
    if (!c.__f2dMod) { c.__f2dMod = c.audioWorklet.addModule(URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' }))); }
    await c.__f2dMod;
    const m = new AWN(c, 'f2d-meter'); const mute = c.createGain(); mute.gain.value = 0;
    conn.call(node, m); conn.call(m, mute); conn.call(mute, c.destination);
    window.__meters[id] = m;
  };
  window.__meterRead = () => Promise.all(Object.entries(window.__meters).map(([id, m]) => new Promise((ok) => { m.port.onmessage = (e) => ok([id, e.data]); m.port.postMessage(0); }))).then(Object.fromEntries);
};

/* Después de encender: envolver las funciones que reinician algo, y los helpers del fuzz. */
const AFTER = () => {
  const log = window.__f2dLog;
  const who = () => (new Error().stack || '').split('\n').slice(3, 6).map((s) => s.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^)]*\/descargables\//, '(').slice(0, 80)).join(' ← ');
  window.__expect = null;
  const wrapG = (name) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function (...a) { log('llamada', { fn: name, esperada: !!window.__expect, quien: who() }); return f.apply(this, a); }; };
  ['loadPatch', 'resetAll', 'restoreSession', 'clearAllKeys'].forEach(wrapG);
  for (const m of ['panic', 'loadState']) { const f = engine[m].bind(engine); engine[m] = (...a) => { log('llamada', { fn: 'engine.' + m, esperada: !!window.__expect, quien: who() }); return f(...a); }; }
  if (engine.filter.node) engine.filter.node.port.onmessage = (e) => log('ladder', e.data);
  const kr = Knob.prototype.reset; Knob.prototype.reset = function () { log('llamada', { fn: 'Knob.reset', knob: this.label, quien: who() }); return kr.call(this); };
  // helpers del fuzz (los mismos caminos que la UI: Knob.set, Wheel.set, xySet, kbd)
  const K = { cutoff: () => MAC.cutoff, res: () => MAC.res, env: () => MAC.env, ar: () => MAC.ar, glide: () => MAC.glide, vol: () => MAC.vol,
    modmix: () => REG.knob.k_modmix, f2: () => REG.knob.f2, d2: () => REG.knob.d2, unidet: () => REG.knob.k_unidet, track: () => REG.knob.k_track };
  window.__fz = {
    knob(k, n) { const kn = K[k](); kn.set(kn._denorm(n)); },
    wheel(w, v) { REG.wheels[w].set(v); },
    snap() { REG.wheels.pitch._snap(); },
    xy(x, y) { xySet(x, y); },
    preset(n) { const s = document.getElementById('presetSel'); s.value = n; s.onchange(); },
    voice(m) { document.querySelector('#voiceSeg button[data-m="' + m + '"]').click(); },
    tog(id) { document.getElementById(id).click(); },
    wave(i, w) { document.querySelectorAll('#oscRows .osc-row')[i].querySelector('.wave-btn[data-t="' + w + '"]').click(); },
    octave(d) { shiftOctave(d); },
    press(id, m, ms) { kbd.press(id, m, null, 100); if (ms) setTimeout(() => kbd.release(id), ms); },
    release(id) { kbd.release(id); },
    state: () => JSON.stringify(engine.state),
  };
};

/** Rutas de engine.state que cambiaron entre dos snapshots. */
function diffPaths(a, b, p = '', out = []) {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { if (a !== b) out.push(p); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p ? p + '.' + k : k, out);
  return out;
}
const PRESETS = ['Bajo gordo', 'Sub redondo', 'Lead filoso', 'Pad cálido', 'Órgano hueco', 'Auto-wah (osc3 LFO)', 'Resonante zumbón'];
/** Qué rutas puede cambiar cada acción. */
const ALLOWED = {
  cutoff: [/^filter\.cutoff$/], res: [/^filter\.res$/], env: [/^contour$/], vol: [/^master\.vol$/], glide: [/^glide\./],
  ar: [/^env\.[ar]$/, /^filtEnv\.[ar]$/], modmix: [/^mod\.mix$/], f2: [/^osc\.2\.foot$/], d2: [/^osc\.2\.detune$/], unidet: [/^unison\.detune$/], track: [/^filter\.track$/],
  wheelmod: [/^mod\.wheel$/], moddrag: [/^mod\.wheel$/], xy: [/^filter\.(cutoff|res)$/], xydrag: [/^filter\.(cutoff|res)$/], voice: [/^voiceMode$/], preset: [/.*/], extremos: [/^filter\.res$/, /^master\.vol$/],
  filtModTog: [/^mod\.filt$/], oscModTog: [/^mod\.osc$/], osc3KbdTog: [/^osc\.2\.kbd$/], noiseTog: [/^noise\.on$/], wave: [/^osc\.\d\.wave$/],
};

let srv, browser;
async function open(cond, { fail = null, failAt = 3, diag = true } = {}) {
  const ctx = await browser.newContext({ viewport: cond.viewport, hasTouch: !!cond.touch, isMobile: !!cond.touch, deviceScaleFactor: cond.touch ? 2 : 1 });
  await ctx.addInitScript(INIT, { fail, failAt, diag });
  const page = await ctx.newPage();
  const ext = { console: [], pageerror: [], navs: 0, crash: 0 };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') ext.console.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => ext.pageerror.push(String(e).slice(0, 200)));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) ext.navs++; });
  page.on('crash', () => ext.crash++);
  page.on('dialog', (d) => { ext.console.push('diálogo nativo: ' + d.message()); d.dismiss(); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (cond.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cond.cpu });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  if (cond.touch) { const r = await box(page, '#powerOvl'); await tap(page, { x: r.x + r.w / 2, y: r.y + r.h / 2 }); }
  else await page.click('#powerOvl');
  await page.waitForFunction(() => typeof engine !== 'undefined' && engine.ready && engine.ctx.state === 'running', null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(async () => { await window.__meter(engine.ctx, engine.ctx.__tap, 'salida'); await window.__meter(engine.ctx, engine.filter.output, 'filtro'); });
  await page.evaluate(AFTER);
  return { ctx, page, ext, cdp };
}
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');
async function metrics(cdp) { const { metrics: m } = await cdp.send('Performance.getMetrics'); const o = {}; for (const x of m) o[x.name] = x.value; return o; }

/* ─────────────── el fuzz ─────────────── */
async function fuzz(cond, minutes, { filtmod = false, nofiltmod = false } = {}) {
  const { ctx, page, ext, cdp } = await open(cond);
  let s = cond.seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const t0 = Date.now(), end = t0 + minutes * 60000;
  const counts = {}, unexpected = [], mem = [], ring = [];
  let firstBad = null;
  let minute = 0, noteId = 0;
  if (filtmod) await page.evaluate(() => {   // Mod → Filtro con el Osc3 a frecuencia de audio
    window.__expect = 'setup';
    if (!engine.state.mod.filt) __fz.tog('filtModTog');
    if (!engine.state.osc[2].kbd) __fz.tog('osc3KbdTog');
    __fz.knob('modmix', 0); __fz.knob('f2', 1); __fz.wheel('mod', 1);
    window.__expect = null;
  });
  const keys = await box(page, '#keys'), xy = await box(page, '#xypad'), pw = await box(page, '#pitchWheel'), mw = await box(page, '#modWheel');
  const real = async (kind) => {   // gesto real (táctil por CDP o mouse)
    const r = { gliss: keys, xydrag: xy, pitchdrag: pw, moddrag: mw }[kind];
    if (!r) return false;
    const a = { x: r.x + r.w * (0.05 + rnd() * 0.9), y: r.y + r.h * (0.1 + rnd() * 0.8) };
    const b = kind === 'gliss' ? { x: r.x + r.w * (0.05 + rnd() * 0.9), y: a.y } : { x: r.x + r.w * (0.05 + rnd() * 0.9), y: r.y + r.h * (0.05 + rnd() * 0.9) };
    if (cond.touch) await drag(page, a, b, { steps: 10, stepMs: 25, holdMs: 40 + Math.floor(rnd() * 300) });
    else { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (const p of line(a, b, 10)) { await page.mouse.move(p.x, p.y); await page.waitForTimeout(25); } await page.waitForTimeout(40 + Math.floor(rnd() * 300)); await page.mouse.up(); }
    return true;
  };
  const offFilt = () => page.evaluate(() => { if (engine.state.mod.filt) { window.__expect = 'sin Mod → Filtro'; __fz.tog('filtModTog'); window.__expect = null; } });
  if (nofiltmod) await offFilt();
  const W = filtmod
    ? [['note', 30], ['chord', 6], ['gliss', 6], ['cutoff', 8], ['res', 8], ['env', 8], ['f2', 6], ['d2', 4], ['modmix', 3], ['wheelmod', 6], ['pitch', 4], ['voice', 4], ['octave', 3], ['extremos', 4]]
    : [['note', 24], ['chord', 5], ['gliss', 6], ['pitch', 6], ['pitchdrag', 2], ['wheelmod', 6], ['moddrag', 2], ['cutoff', 6], ['res', 6], ['env', 5], ['ar', 3], ['glide', 4], ['vol', 3],
      ['xy', 5], ['xydrag', 4], ['preset', 4], ['voice', 4], ['extremos', 3], ['filtModTog', 2], ['oscModTog', 2], ['osc3KbdTog', 1], ['noiseTog', 1], ['modmix', 2], ['f2', 2], ['wave', 2], ['octave', 2], ['unidet', 1], ['track', 1]];
  if (nofiltmod) W.splice(W.findIndex(([k]) => k === 'filtModTog'), 1);
  const total = W.reduce((a, [, w]) => a + w, 0);
  const choose = () => { let x = rnd() * total; for (const [k, w] of W) { x -= w; if (x < 0) return k; } return W[0][0]; };
  while (Date.now() < end) {
    const act = choose(); counts[act] = (counts[act] || 0) + 1;
    const before = JSON.parse(await page.evaluate(() => __fz.state()));
    await page.evaluate((a) => { window.__expect = a; }, act);
    const n = () => (rnd() < 0.3 ? (rnd() < 0.5 ? 0 : 1) : rnd());
    try {
      switch (act) {
        case 'note': await page.evaluate(([id, m, ms]) => __fz.press(id, m, ms), ['f' + (noteId++), 36 + Math.floor(rnd() * 48), 40 + Math.floor(rnd() * 900)]); break;
        case 'chord': { const m = 40 + Math.floor(rnd() * 36), ms = 200 + Math.floor(rnd() * 900); for (const d of [0, 3 + Math.floor(rnd() * 5), 7 + Math.floor(rnd() * 6)]) await page.evaluate(([id, mm, t]) => __fz.press(id, mm, t), ['f' + (noteId++), m + d, ms]); break; }
        case 'gliss': case 'xydrag': case 'pitchdrag': case 'moddrag': await real(act); break;
        case 'pitch': await page.evaluate((v) => { __fz.wheel('pitch', v); }, rnd() * 2 - 1); await page.waitForTimeout(50 + Math.floor(rnd() * 400)); await page.evaluate(() => __fz.snap()); break;
        case 'wheelmod': await page.evaluate((v) => __fz.wheel('mod', v), n()); break;
        case 'cutoff': case 'res': case 'env': case 'ar': case 'glide': case 'vol': case 'modmix': case 'f2': case 'd2': case 'unidet': case 'track':
          await page.evaluate(([k, v]) => __fz.knob(k, v), [act, n()]); break;
        case 'xy': await page.evaluate(([x, y]) => __fz.xy(x, y), [n(), n()]); break;
        case 'preset': await page.evaluate((p) => __fz.preset(p), pick(PRESETS)); break;
        case 'voice': await page.evaluate((m) => __fz.voice(m), pick(['mono', 'unison', 'duo'])); break;
        case 'extremos': await page.evaluate(() => { __fz.knob('res', 1); __fz.knob('vol', 1); }); break;
        case 'filtModTog': case 'oscModTog': case 'osc3KbdTog': case 'noiseTog': await page.evaluate((id) => __fz.tog(id), act); break;
        case 'wave': await page.evaluate(([i, w]) => __fz.wave(i, w), [Math.floor(rnd() * 3), pick(['triangle', 'trisaw', 'sawtooth', 'square', 'pulseWide', 'pulseNarrow'])]); break;
        case 'octave': await page.evaluate((d) => __fz.octave(d), rnd() < 0.5 ? -1 : 1); break;
      }
      if (nofiltmod && act === 'preset') await offFilt();   // 'Auto-wah (osc3 LFO)' trae Mod → Filtro
    } catch (e) { ext.pageerror.push('fuzz ' + act + ': ' + String(e).slice(0, 160)); }
    await page.waitForTimeout(20);
    const after = JSON.parse(await page.evaluate(() => { window.__expect = null; return __fz.state(); }));
    const ct = await page.evaluate(() => ({ t: engine.ctx.currentTime, held: engine.held.slice(), oct: baseOctave }));
    ring.push({ ct: ct.t, act, held: ct.held, oct: ct.oct, state: after }); if (ring.length > 80) ring.shift();
    if (!firstBad) { const fb = (await page.evaluate(() => window.__log.find((x) => x.type === 'ladder' && x.k === 'no-finito'))); if (fb) firstBad = { fb, ring: ring.slice() }; }
    const ch = diffPaths(before, after).filter((p) => !(ALLOWED[act] || []).some((re) => re.test(p)));
    if (ch.length && unexpected.length < 200) unexpected.push({ t: (Date.now() - t0) / 1000, act, paths: ch.slice(0, 8) });
    // pausa entre acciones (el estado no debería cambiar solo)
    await page.waitForTimeout(30 + Math.floor(rnd() * 350));
    const idle = JSON.parse(await page.evaluate(() => __fz.state()));
    const ch2 = diffPaths(after, idle);
    if (ch2.length && unexpected.length < 200) unexpected.push({ t: (Date.now() - t0) / 1000, act: '(en reposo, después de ' + act + ')', paths: ch2.slice(0, 8) });
    if (Date.now() - t0 >= (minute + 1) * 60000) {
      minute++;
      const m = await metrics(cdp);
      const st = await page.evaluate(() => ({ ctx: engine.ctx.state, mode: engine.filterMode, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, toasts: document.querySelectorAll('.zd-toast').length, log: window.__log.length, idb: window.__idbPuts || 0 }));
      mem.push({ minute, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, ...st });
    }
  }
  // soltar todo y un control: Bajo gordo, mono, una nota de 1 s
  await page.evaluate(() => { window.__expect = 'control'; clearAllKeys(); __fz.wheel('mod', 0); __fz.preset('Bajo gordo'); __fz.voice('mono'); window.__expect = null; });
  await page.waitForTimeout(400);
  await page.evaluate(() => __fz.press('ctl', 48, 1000));
  await page.waitForTimeout(1400);
  const meters = await page.evaluate(() => window.__meterRead());
  const lastWins = meters.salida.wins.slice(-4);
  const log = await page.evaluate(() => window.__log);
  const loads = await page.evaluate(() => +(sessionStorage.getItem('__f2d_loads') || 0));
  const playout = await page.evaluate(() => { const p = engine.ctx.playoutStats; return p ? { fallbackDuration: p.fallbackDuration, fallbackEvents: p.fallbackEvents, totalDuration: p.totalDuration } : null; });
  await ctx.close();
  return { cond: cond.name + (filtmod ? ' · Mod → Filtro con el Osc3 a frecuencia de audio' : nofiltmod ? ' · sin Mod → Filtro' : ''), minutes, counts, unexpected, mem, meters, control: lastWins, log, loads, ext, playout, firstBad };
}

function summarize(r) {
  const o = r.meters.salida.a, f = r.meters.filtro.a;
  const L = r.log, by = (t) => L.filter((x) => x.type === t);
  const calls = by('llamada'), unexp = calls.filter((c) => !c.esperada && c.fn !== 'Knob.reset');
  const ctl = r.control.map((w) => fmt(dB(w[2]), 1)).join(' / ');
  const lines = [
    `── ${r.cond}: ${r.minutes} min · ${Object.values(r.counts).reduce((a, b) => a + b, 0)} acciones (${Object.entries(r.counts).map(([k, v]) => k + ' ' + v).join(', ')})`,
    `   salida: no finitas ${o.bad}${o.firstBad >= 0 ? ' (primera a los ' + o.firstBad.toFixed(2) + ' s del contexto)' : ''} · pico ${fmt(dB(o.pk))} dBFS · filtro: no finitas ${f.bad}${f.firstBad >= 0 ? ' (primera a los ' + f.firstBad.toFixed(2) + ' s)' : ''} · pico ${fmt(f.pk, 3)}`,
    `   control al final (Bajo gordo, una nota): RMS por medio segundo ${ctl} dBFS`,
    `   processorerror ${by('processorerror').length} · estados del contexto ${by('ctx-estado').map((x) => x.state).join(' → ') || '(sin cambios)'} · overlay «Tocá para reanudar» ${by('overlay-reanudar').filter((x) => x.on).length} · cargas de la página ${r.loads} · navegaciones ${r.ext.navs} · crash ${r.ext.crash}`,
    `   toasts: ${by('toast').map((x) => '«' + x.text + '»').join(' ') || '(ninguno)'}`,
    `   errores: consola ${r.ext.console.length} · excepciones ${r.ext.pageerror.length + by('error').length} · promesas ${by('promesa-rechazada').length} · idb/storage ${by('idb-error').length + by('storage-error').length}${[...r.ext.console, ...r.ext.pageerror].slice(0, 3).map((x) => '\n     ' + x).join('')}`,
    `   llamadas: ${Object.entries(calls.reduce((a, c) => { const k = c.fn + (c.esperada ? '' : ' (no pedida)'); a[k] = (a[k] || 0) + 1; return a; }, {})).map(([k, v]) => k + ' ' + v).join(', ') || '(ninguna)'}${unexp.slice(0, 3).map((c) => '\n     no pedida: ' + c.fn + ' ← ' + c.quien).join('')}`,
    `   cambios de estado que la acción no explica: ${r.unexpected.length}${r.unexpected.slice(0, 5).map((u) => '\n     ' + u.t.toFixed(1) + ' s · ' + u.act + ' → ' + u.paths.join(', ')).join('')}`,
    `   memoria por minuto (heap MB · nodos DOM · listeners): ${r.mem.map((m) => m.heapMB + '·' + m.nodes + '·' + m.listeners).join('  ')}`,
    r.playout ? `   playoutStats: ${JSON.stringify(r.playout)}` : '   playoutStats: no disponible en este Chromium',
  ];
  const resets = L.filter((x) => x.type === 'ladder' && x.k === 'reinicio');
  if (resets.length) { const sat = resets.map((x) => x.sat).sort((a, b) => a - b), q = (p) => sat[Math.min(sat.length - 1, Math.floor(p * sat.length))];
    lines.push(`   reinicios del filtro (la guarda): ${resets.length} · salida saturada (|out4| > 10) antes de cada uno: mediana ${(q(0.5) * 1000).toFixed(0)} ms, p90 ${(q(0.9) * 1000).toFixed(0)} ms, máx. ${(sat[sat.length - 1] * 1000).toFixed(0)} ms`); }
  const lad = L.filter((x) => x.type === 'ladder' && x.k !== 'reinicio');
  if (lad.length) lines.push(`   moog-ladder: ${lad.slice(0, 6).map((x) => x.k === 'crece' ? `|out4| > ${x.th} a los ${x.t.toFixed(3)} s (corte ${x.cutoff.toFixed(0)} Hz = base ${x.base.toFixed(0)} × 2^(${x.mod.toFixed(0)}/1200), fc ${x.fc.toFixed(3)}, f ${x.f.toFixed(3)}, fb ${x.fb.toFixed(3)}, res ${x.res.toFixed(3)})` : `primer no finito: ${x.var} a los ${x.t.toFixed(3)} s (corte ${x.cutoff}, mod ${x.mod}, fc ${x.fc}, f ${x.f}, fb ${x.fb}, res ${x.res}, sr ${x.sr})`).join('\n     ')}`);
  if (r.firstBad) {
    const t = r.firstBad.fb.t, before = r.firstBad.ring.filter((e) => e.ct <= t + 0.05), last = before[before.length - 1] || r.firstBad.ring[0];
    const st = last.state;
    lines.push(`   estado al primer no finito (última acción a los ${last.ct.toFixed(2)} s: ${last.act}): notas ${JSON.stringify(last.held)} · octava ${last.oct} · voz ${st.voiceMode} · filtro ${JSON.stringify(st.filter)} · contorno ${st.contour} · env filtro ${JSON.stringify(st.filtEnv)} · mod ${JSON.stringify(st.mod)} · osc3 ${JSON.stringify(st.osc[2])} · glide ${JSON.stringify(st.glide)} · trigger ${st.trigger}`);
    lines.push(`   acciones previas: ${before.slice(-8).map((e) => e.ct.toFixed(2) + ' ' + e.act).join(' · ')}`);
  }
  return lines.join('\n');
}

/* ─────────────── qué pasa si el worklet falla ─────────────── */
async function workletCases() {
  const out = [];
  const D = { name: 'escritorio', viewport: { width: 1280, height: 860 } };
  for (const fail of ['addModule', 'throw']) {
    const { ctx, page, ext } = await open(D, { fail, failAt: 2 });
    try {
      const play = async () => { await page.evaluate(() => __fz.press('w', 48, 900)); await page.waitForTimeout(1200); };
      await play();                       // antes del fallo forzado (con 'throw', currentTime < 2 s al principio… o no)
      await page.waitForFunction(() => engine.ctx.currentTime > 2.5, null, { timeout: 10000 });
      await play(); await page.waitForTimeout(300); await play();
      const meters = await page.evaluate(() => window.__meterRead());
      const st = await page.evaluate(() => ({ mode: engine.filterMode, label: document.getElementById('filtMode').textContent, toasts: Array.from(document.querySelectorAll('.zd-toast')).map((t) => t.textContent.trim()), ctx: engine.ctx.state }));
      const log = await page.evaluate(() => window.__log);
      const wins = meters.salida.wins;
      out.push({ fail, st, log: log.filter((x) => /processorerror|addModule|error|toast/.test(x.type)), wins: wins.map((w) => [w[0], fmt(dB(w[2]), 1)]), console: ext.console, pageerror: ext.pageerror });
    } finally { await ctx.close(); }
  }
  return out;
}

/* ─────────────── caminos que se ven como "reinicio" ─────────────── */
async function pathCases() {
  const P = { name: 'teléfono', viewport: { width: 360, height: 640 }, touch: true };
  const res = {};
  {
    // doble toque en la macro Cutoff (SPEC R1: doble tap = valor de fábrica)
    const { ctx, page } = await open(P);
    try {
      await page.evaluate(() => { __fz.knob('cutoff', 0.85); __fz.knob('res', 0.9); });
      const r = await box(page, '#m_cutoff');
      const before = await page.evaluate(() => ({ cutoff: engine.state.filter.cutoff, res: engine.state.filter.res }));
      await doubleTap(page, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, { gapMs: 180 });
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({ cutoff: engine.state.filter.cutoff, res: engine.state.filter.res }));
      // y dos toques "de ajuste" separados por 300 ms (todavía dentro de los 320 ms)
      await page.evaluate(() => __fz.knob('cutoff', 0.85));
      await tap(page, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, { holdMs: 30 }); await page.waitForTimeout(240); await tap(page, { x: r.x + r.w / 2, y: r.y + r.h / 2 + 2 }, { holdMs: 30 });
      await page.waitForTimeout(200);
      const after2 = await page.evaluate(() => engine.state.filter.cutoff);
      res.doubleTap = { before, after, after2, log: (await page.evaluate(() => window.__log)).filter((x) => x.type === 'llamada') };
    } finally { await ctx.close(); }
  }
  {
    // blur con una nota sostenida, suspend del contexto con notas, y «Empezar de cero» (modal)
    const { ctx, page } = await open({ name: 'escritorio', viewport: { width: 1280, height: 860 } });
    try {
      await page.evaluate(() => __fz.press('held', 48, 0));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(100);
      const afterBlur = await page.evaluate(() => ({ held: engine.held.slice(), noteCount: kbd.sources.size }));
      await page.evaluate(() => __fz.press('held2', 52, 0));
      await page.waitForTimeout(200);
      await page.evaluate(() => engine.ctx.suspend());
      await page.waitForTimeout(300);
      const overlay = await page.evaluate(() => { const o = document.querySelector('.zd-resume'); return o ? o.classList.contains('on') : false; });
      await page.mouse.click(200, 200);
      await page.waitForTimeout(400);
      const resumed = await page.evaluate(() => ({ ctx: engine.ctx.state, overlay: !!document.querySelector('.zd-resume.on'), state: engine.state.filter }));
      await page.evaluate(() => { __fz.release('held2'); });
      await page.evaluate(() => { document.getElementById('btnReset').click(); });
      await page.waitForTimeout(300);
      const modal = await page.evaluate(() => Array.from(document.querySelectorAll('.zd-scrim, .zd-modal, [role=dialog]')).map((e) => e.textContent.trim().slice(0, 80)));
      res.lifecycle = { afterBlur, overlay, resumed, modal, log: (await page.evaluate(() => window.__log)).filter((x) => /llamada|overlay|ctx-estado|ventana/.test(x.type)) };
    } finally { await ctx.close(); }
  }
  {
    // recarga: qué se restaura
    const { ctx, page } = await open({ name: 'escritorio', viewport: { width: 1280, height: 860 } });
    try {
      await page.evaluate(() => { __fz.knob('cutoff', 0.7); __fz.knob('res', 0.8); __fz.wheel('mod', 0.6); __fz.voice('duo'); __fz.octave(1); });
      await page.waitForTimeout(1800);   // debounce de 1,5 s
      const before = await page.evaluate(() => __fz.state());
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => JSON.stringify(engine.state));
      const ui = await page.evaluate(() => ({ power: !document.getElementById('powerOvl').classList.contains('hidden'), toasts: Array.from(document.querySelectorAll('.zd-toast')).map((t) => t.textContent.trim()), oct: document.getElementById('octVal').textContent, loads: +sessionStorage.getItem('__f2d_loads') }));
      res.reload = { same: before === after, diff: diffPaths(JSON.parse(before), JSON.parse(after)), ui };
    } finally { await ctx.close(); }
  }
  return res;
}

/* ─────────────── mapa en Node ─────────────── */
function mapa() {
  const html = execFileSync('git', ['-C', ROOT, 'show', '22fb1d2:descargables/MonoMoon70.html'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const code = html.match(/const MOOG_WORKLET = `([\s\S]*?)`;/)[1];
  const mk = (sr) => { let C; new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C = c; }, sr); return new C(); };
  // entrada: las 3 sierras del patch de fábrica a C4; modulación: Osc3 × 4 200 ¢ × rueda (como el grafo)
  const run = ({ sr = 44100, secs = 3, base = 340, res = 0.32, wheel = 1, modHz = 1046, src = 'saw', inAmp = 1 }) => {
    const L = mk(sr), B = 128, N = Math.round(secs * sr), inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]];
    const pr = { cutoff: new Float32Array([base]), cutoffMod: new Float32Array(B), resonance: new Float32Array([res * 0.965]) };
    let ph = 0, mph = 0, big = false;
    for (let b = 0; b * B < N; b++) {
      for (let n = 0; n < B; n++) { ph = (ph + 261.6 / sr) % 1; mph = (mph + modHz / sr) % 1;
        inp[0][0][n] = inAmp * (2 * ph - 1) * 2.07;
        pr.cutoffMod[n] = 4200 * wheel * (src === 'saw' ? 2 * mph - 1 : src === 'tri' ? 1 - 4 * Math.abs(mph - 0.5) : Math.sin(2 * Math.PI * mph)); }
      L.process(inp, out, pr); if (Math.abs(L.out4) > 10) big = true;
      for (let n = 0; n < B; n++) if (!Number.isFinite(out[0][0][n])) return '✕ ' + ((b * B + n) / sr).toFixed(2) + ' s';
    }
    return big ? '>10, vuelve' : 'ok';
  };
  const hz = [2, 8, 30, 65, 131, 262, 523, 1046, 2093, 4186], cell = (x) => x.padEnd(12);
  console.log('── mapa (Node, worklet de 22fb1d2): Osc3 (sierra) → filtro, rueda 1, corte base 340 Hz, 3 sierras a C4; ✕ t = NaN a los t s, ">10, vuelve" = el estado pasa de 10 sin NaN en 3 s');
  console.log('   RESO \\ Osc3 ' + hz.map((h) => cell(h + ' Hz')).join(''));
  for (const res of [0, 0.32, 0.6, 0.9, 1]) console.log('   ' + String(res).padEnd(11) + hz.map((h) => cell(run({ res, modHz: h }))).join(''));
  console.log('   RESO 0,32, Osc3 a 1046 Hz: rueda × corte base');
  for (const w of [0.1, 0.2, 0.3, 0.5, 0.7, 1]) console.log('   rueda ' + String(w).padEnd(5) + [100, 340, 1000, 3000, 8000].map((b) => cell(b + ': ' + run({ wheel: w, base: b }))).join(''));
  console.log('   Osc3 seno / triangular (RESO 0,32, rueda 1, corte 340): ' + ['sin', 'tri'].map((src) => src + ' ' + hz.map((h) => h + ':' + run({ modHz: h, src })).join(' ')).join(' · '));
  console.log('   sin entrada (osciladores apagados): ' + hz.map((h) => h + ':' + run({ modHz: h, inAmp: 0 })).join(' '));
  console.log('   sin modulación (rueda 0), corte base × RESO: ' + [100, 340, 1000, 5000, 15000, 18000].map((b) => b + ' Hz ' + [0, 0.5, 1].map((r) => run({ wheel: 0, base: b, res: r })).join('/')).join(' · '));
}

/* ─────────────── main ─────────────── */
if (ONLY.length === 1 && ONLY[0] === 'mapa') { mapa(); process.exit(0); }
srv = await serveRoot(ROOT);
const { chromium } = await loadPlaywright();
browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const report = {};
try {
  const jobs = [];
  if (ONLY.includes('fuzz')) {
    jobs.push(fuzz({ name: 'escritorio 1280×860', viewport: { width: 1280, height: 860 }, seed: 0x1f2d01 }, MINUTES));
    jobs.push(fuzz({ name: 'teléfono 360×640 táctil', viewport: { width: 360, height: 640 }, touch: true, seed: 0x1f2d02 }, MINUTES));
    jobs.push(fuzz({ name: 'teléfono 360×640 táctil · CPU 4×', viewport: { width: 360, height: 640 }, touch: true, cpu: 4, seed: 0x1f2d03 }, MINUTES));
  }
  if (ONLY.includes('filtmod')) jobs.push(fuzz({ name: 'escritorio 1280×860', viewport: { width: 1280, height: 860 }, seed: 0x1f2d04 }, MINUTES, { filtmod: true }));
  if (ONLY.includes('nofiltmod')) jobs.push(fuzz({ name: 'escritorio 1280×860', viewport: { width: 1280, height: 860 }, seed: 0x1f2d05 }, MINUTES, { nofiltmod: true }));
  const fz = await Promise.all(jobs);
  report.fuzz = fz;
  for (const r of fz) console.log(summarize(r) + '\n');
  if (ONLY.includes('worklet')) {
    report.worklet = await workletCases();
    for (const w of report.worklet) {
      console.log(`── worklet: ${w.fail === 'addModule' ? 'addModule falla' : "'moog-ladder' tira una excepción en process() a los 2 s"}`);
      console.log(`   filterMode ${w.st.mode} · «${w.st.label}» · contexto ${w.st.ctx} · toasts ${JSON.stringify(w.st.toasts)}`);
      console.log(`   registro: ${w.log.map((x) => x.type + (x.name ? ' ' + x.name : '') + (x.msg ? ' «' + x.msg + '»' : '')).join(' · ') || '(nada)'}`);
      console.log(`   salida, RMS por medio segundo: ${w.wins.map((x) => x[1]).join(' ')}`);
      console.log(`   consola: ${w.console.length ? w.console.join(' | ') : '(nada)'}${w.pageerror.length ? ' · excepciones: ' + w.pageerror.join(' | ') : ''}\n`);
    }
  }
  if (ONLY.includes('paths')) {
    const p = report.paths = await pathCases();
    console.log('── doble toque en la macro Cutoff (teléfono)');
    console.log(`   antes ${JSON.stringify(p.doubleTap.before)} → doble toque (180 ms) ${JSON.stringify(p.doubleTap.after)} · dos toques a 240 ms: cutoff ${p.doubleTap.after2}`);
    console.log(`   llamadas: ${p.doubleTap.log.map((x) => x.fn + (x.knob ? ' «' + x.knob + '»' : '')).join(', ')}`);
    console.log('── blur, suspend y «Empezar de cero» (escritorio)');
    console.log(`   después de blur con una nota apretada: held ${JSON.stringify(p.lifecycle.afterBlur.held)} · fuentes ${p.lifecycle.afterBlur.noteCount}`);
    console.log(`   ctx.suspend() con notas: overlay «Tocá para reanudar» ${p.lifecycle.overlay ? 'visible' : 'no'} → un clic: ${JSON.stringify(p.lifecycle.resumed)}`);
    console.log(`   «Empezar de cero»: ${p.lifecycle.modal.length ? 'abre un modal: ' + JSON.stringify(p.lifecycle.modal[0]) : 'sin modal'}`);
    console.log(`   registro: ${p.lifecycle.log.map((x) => x.type + ':' + (x.fn || x.state || x.ev || x.on)).join(' ')}`);
    console.log('── recarga');
    console.log(`   estado igual después de recargar: ${p.reload.same} ${p.reload.diff.length ? JSON.stringify(p.reload.diff) : ''} · overlay de encendido ${p.reload.ui.power ? 'visible' : 'no'} · toasts ${JSON.stringify(p.reload.ui.toasts)} · octava ${p.reload.ui.oct} · cargas ${p.reload.ui.loads}`);
  }
} finally {
  await browser.close(); await srv.close();
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
}
void touchPath;
