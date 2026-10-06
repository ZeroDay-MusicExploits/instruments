#!/usr/bin/env node
// tools/tests/j4-reposo.test.mjs
//
// J4-Sirens Station en reposo: encendido y sin tocar nada, tiene que quedar en
// silencio. Antes el VCA quedaba en 0,0001 en reposo: esa fuga del oscilador
// (~−70 dBFS) cebaba el lazo del eco, que con el patch de fábrica tiene
// ganancia de pequeña señal ≈ 1,13 (FEEDBACK 0,42 × TAPE SAT tanh(2,7·x)), y la
// salida subía de −81 a −14 dBFS RMS en ~10 s. Ver reports/j4.md (riesgos) y
// reports/F2b.md.
//
// La salida se mide como en j4-mute: un AudioWorklet medidor (pico y RMS por
// bloque de 128 muestras, con su currentTime) colgado de un tap propio, al que
// se conecta todo nodo que va a un AudioDestinationNode. El mismo medidor se
// puede colgar de cualquier nodo (acá, de la salida del VCA).
//
//   1  Patch de fábrica, encender y 30 s sin tocar nada: RMS < −80 dBFS
//      (en total y en cada segundo).
//   2  La envolvente del release, sin clics. Una sonda repite cada llamada de
//      automatización de vca.gain sobre un GainNode alimentado con 1 y se graba
//      muestra a muestra. El release es la exponencial de τ = rel/3 hasta
//      −80 dB y una recta a 0 en otra τ. Escalón: lo que una muestra se sale
//      del rango que una curva continua puede recorrer en una muestra (quedar
//      igual, o caer una muestra de release). Desde la entrada al release hasta
//      el 0 queda < −120 dB, y la ganancia llega a 0
//      exacto a las ln(g0/1e-4) + 1 τ; el VCA de verdad, en la misma muestra.
//      En la salida de J4 el escalón es el de la envolvente × la portadora que
//      entra al VCA × la ganancia de pequeña señal del VCA a la salida (medida):
//      < −100 dBFS, también con DRIVE 8, volumen 100 % y resonancia alta.
//      Después del 0, la salida es 0 exacto. Control con el commit base: la
//      sonda ve el salto que hacía Chromium, que da por terminado un setTarget
//      a las 10 τ (si el objetivo es 0, ya cuando baja de ~4,5e-5) y salta al
//      objetivo: e^-10, −87 dB de escalón en la envolvente.
//   2b Una nota tocada durante el release no queda cortada por ese 0.
//
//   node tools/tests/j4-reposo.test.mjs
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
const BASE = '224763d';   // main antes de este arreglo (VCA en 0,0001 en reposo)
const BASE_PATH = '/descargables/__base-J4.html';

let baseHtml = null;
try { baseHtml = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
catch (e) { baseHtml = null; }

/* Tap de salida + medidores. Corre antes que la página (addInitScript). */
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
      const ch = inp[0] || []; let pk = 0, ss = 0, n = 0;
      for (const d of ch) { for (let i = 0; i < d.length; i++) { const v = d[i], a = v < 0 ? -v : v; if (a > pk) pk = a; ss += v * v; } n += d.length; }
      this.b.push(currentTime, pk, n ? ss / n : 0);
      if (this.b.length >= 48) { this.port.postMessage(this.b); this.b = []; }
      return true;
    }
  });
  // la última muestra distinta de 0 (en cualquier canal) y cuándo fue
  registerProcessor('zd-edge', class extends AudioWorkletProcessor {
    constructor(){ super(); this.last = null; this.port.onmessage = () => this.port.postMessage(this.last); }
    process(inp){
      const ch = inp[0] || [];
      for (const d of ch) for (let i = d.length - 1; i >= 0; i--) {
        if (d[i] !== 0) { const t = currentTime + i / sampleRate; if (!this.last || t >= this.last.t) this.last = { t, v: Math.abs(d[i]), sr: sampleRate }; break; }
      }
      return true;
    }
  });
  // graba n muestras del canal 0 desde el frame de t0 (o desde que llega el pedido, si ya pasó)
  registerProcessor('zd-cap', class extends AudioWorkletProcessor {
    constructor(){ super(); this.req = null;
      this.port.onmessage = (e) => { this.req = { f0: Math.round(e.data.t0 * sampleRate), first: -1, buf: new Float32Array(e.data.n), k: 0 }; }; }
    process(inp){
      const r = this.req; if (!r) return true;
      const d = inp[0] && inp[0][0];
      for (let i = 0; i < 128 && r.k < r.buf.length; i++) {
        if (currentFrame + i < r.f0) continue;
        if (r.first < 0) r.first = currentFrame + i;
        r.buf[r.k++] = d ? d[i] : 0;
      }
      if (r.k === r.buf.length) { this.port.postMessage({ first: r.first, sr: sampleRate, buf: r.buf }, [r.buf.buffer]); this.req = null; }
      return true;
    }
  });`;
  // nodo de medición: entra src, sale a un gain en 0 hacia el destino (procesa sin sonar)
  const sink = (c, src, name) => {
    const node = new AudioWorkletNode(c, name);
    const mute = c.createGain(); mute.gain.value = 0;
    conn.call(src, node); conn.call(node, mute); conn.call(mute, c.destination);
    return node;
  };
  window.__mm = {}; window.__mFirst = -1;
  window.__meterOn = async (c, src, key = 'out') => {
    if (!c.__mod) {
      const url = URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' }));
      c.__mod = c.audioWorklet.addModule(url);
    }
    await c.__mod;
    if (!c.__tap) c.__tap = c.createGain();
    const m = window.__mm[key] = { d: [], last: -1 };
    sink(c, src || c.__tap, 'zd-meter').port.onmessage = (e) => {
      const a = e.data; if (key === 'out' && window.__mFirst < 0) window.__mFirst = a[0];
      for (let i = 0; i < a.length; i++) m.d.push(a[i]); m.last = a[a.length - 3];
    };
  };
  window.__mLast = (key = 'out') => (window.__mm[key] ? window.__mm[key].last : -1);
  window.__stats = (t0, t1, key = 'out') => {
    let pk = 0, ss = 0, n = 0;
    const m = window.__mm[key].d;
    for (let i = 0; i < m.length; i += 3) { const t = m[i]; if (t >= t0 && t < t1) { if (m[i + 1] > pk) pk = m[i + 1]; ss += m[i + 2]; n++; } }
    return { pk, rms: n ? Math.sqrt(ss / n) : 0, n };
  };
  /** Cuelga un detector de la última muestra ≠ 0 de `src`. -> () => Promise<{t, v, sr}> */
  window.__edgeOn = (c, src) => {
    const node = sink(c, src, 'zd-edge');
    return () => new Promise((ok) => { node.port.onmessage = (e) => ok(e.data); node.port.postMessage('get'); });
  };
  /** Sonda de la envolvente: un GainNode alimentado con 1 que recibe las mismas
   *  llamadas de automatización que `param`. -> (t0, n) => Promise<{first, sr, buf}> */
  window.__probeOn = (c, param) => {
    const p = c.createGain(); p.gain.value = param.value;
    const one = c.createConstantSource(); one.start();
    conn.call(one, p);
    const cap = sink(c, p, 'zd-cap');
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime',
      'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) {
      const f = param[m];
      if (f) param[m] = function (...a) { p.gain[m](...a); return f.apply(this, a); };
    }
    return (t0, n) => new Promise((ok) => { cap.port.onmessage = (e) => ok(e.data); cap.port.postMessage({ t0, n }); });
  };
};

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

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

async function open(viewport = { width: 390, height: 844 }, { path = URL_PATH, init } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 1200 });
  await ctx.addInitScript(INIT_TAP);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}
async function powerOn(page) {
  await page.click('#power');
  await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
  await page.evaluate(() => window.__meterOn(ctx));
  await page.waitForFunction(() => window.__mFirst >= 0, null, { timeout: 5000 });
}
/** Espera a que el medidor haya cubierto hasta t1 y devuelve pico/RMS en dBFS de [t0, t1). */
async function level(page, t0, t1, key = 'out') {
  await page.waitForFunction(([t, k]) => window.__mLast(k) >= t, [t1, key], { timeout: 15000 });
  const s = await page.evaluate(([a, b, k]) => window.__stats(a, b, k), [t0, t1, key]);
  return { pk: dB(s.pk), rms: dB(s.rms), n: s.n };
}
const setPatch = (page, p) => page.evaluate((x) => { applyPatch(x); }, p);

// ───────────────────── 1 · encendido y sin tocar nada: silencio ───────────────

test('1 · patch de fábrica, encender y 30 s sin tocar nada: RMS < −80 dBFS', async () => {
  const { ctx, page, errors } = await open();
  try {
    const fresh = await page.evaluate(() => ({ fb: P.echo.fb, sat: P.echo.sat, on: P.echo.on, rel: P.rel }));
    assert.deepEqual(fresh, { fb: 0.42, sat: 1.8, on: true, rel: 340 }, 'control: arranca con el patch de fábrica (sin sesión guardada)');
    await powerOn(page);
    const t0 = await page.evaluate(() => window.__mFirst);
    await page.waitForTimeout(30500);
    const all = await level(page, t0, t0 + 30);
    const secs = [];
    for (let s = 0; s < 30; s++) secs.push(await level(page, t0 + s, t0 + s + 1));
    const curve = secs.filter((_, i) => i % 3 === 0 || i === 29).map((x, i, a) => `${i === a.length - 1 ? 29 : i * 3} s ${fmt(x.rms)}`).join(' · ');
    const worst = secs.reduce((a, b) => (b.rms > a.rms ? b : a));
    console.log(`  30 s en reposo · RMS ${fmt(all.rms)} dBFS · pico ${fmt(all.pk)} dBFS · peor segundo ${fmt(worst.rms)} dBFS RMS`);
    console.log(`  RMS por segundo: ${curve}`);
    assert.ok(all.n > 30 * 300, `control: el medidor cubrió los 30 s (${all.n} bloques)`);
    assert.ok(all.rms < -80, `30 s en reposo: RMS ${fmt(all.rms)} dBFS (tiene que ser < −80)`);
    assert.ok(worst.rms < -80, `ningún segundo por encima de −80 dBFS RMS (el peor: ${fmt(worst.rms)})`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────── 2 · el release, sin escalones ────────────────────────

/* Patches de prueba (applyPatch mezcla: lo que no está queda como estaba).
   Sin eco ni reverb en la salida: lo único que suena es la voz. */
const PATCH = {
  dry: { wave: 'square', mode: 'wail', shape: 'tri', rate: 6, depth: 0, cutoff: 1400, reso: 0.62, envAmt: 0.35, glide: 40,
    atk: 6, dec: 220, sus: 0.85, rel: 340, vol: 0.8, drive: 1.6,
    lfo: [{ rate: 0.8, depth: 0, dest: 'off', shape: 'sine' }, { rate: 0.15, depth: 0, dest: 'off', shape: 'tri' }],
    echo: { time: 0.38, fb: 0.2, tone: 3400, wow: 0, sat: 1.8, mix: 0.38, on: false },
    rev: { mode: 'spring', decay: 2.6, tone: 4200, mix: 0.26, on: false },
    ph: { rate: 0.35, depth: 0.6, fb: 0.35, mix: 0, on: false } },
};
// el escalón más grande posible: DRIVE 8 (pendiente 16 en el shaper), volumen 100 %, sierra y resonancia alta
PATCH.loud = { ...PATCH.dry, wave: 'saw', reso: 0.95, cutoff: 2400, drive: 8, vol: 1, sus: 1 };

/** Toca una nota, la suelta y mide el release con la sonda, el VCA y la salida. */
async function release(path, patch) {
  const { ctx, page, errors } = await open(undefined, { path });
  try {
    await powerOn(page);
    await setPatch(page, patch);
    await page.waitForTimeout(1200);              // los wet del eco y la reverb terminan de bajar a 0
    await page.evaluate(async () => {
      await window.__meterOn(ctx, vca, 'vca');
      window.__eV = window.__edgeOn(ctx, vca);
      window.__cap = window.__probeOn(ctx, vca.gain);
    });
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(800);
    // la sonda graba desde ~50 ms antes del noteOff hasta 12 τ después
    const tau = await page.evaluate(() => Math.max(.005, P.rel / 1000 / 3));
    await page.evaluate((n) => { window.__capP = window.__cap(ctx.currentTime, Math.ceil((0.05 + n) * ctx.sampleRate)); }, 12 * tau);
    await page.waitForTimeout(50);
    const { tOff, g0 } = await page.evaluate(() => { const g0 = vca.gain.value; noteOff('pad'); return { tOff: ctx.currentTime, g0 }; });
    const knee = Math.log(g0 / 1e-4) + 1;          // en τ: la exponencial hasta 1e-4 y la recta de una τ
    const tZero = tOff + knee * tau;
    await page.waitForFunction((t) => ctx.currentTime > t, tOff + 12 * tau + 1.1, { timeout: 15000 });
    // la envolvente muestra a muestra: de una muestra a la otra una curva continua puede quedar igual
    // (sustain) o caer a lo sumo una muestra de release (×k mientras es exponencial, −lin en la recta);
    // un escalón es lo que se sale de ese rango. Desde 128 muestras antes del noteOff: cubre la entrada.
    const env = await page.evaluate(async ([tOff, tau]) => {
      const { first, sr, buf } = await window.__capP;
      const i0 = Math.round(tOff * sr) - first, k = Math.exp(-1 / (tau * sr)), lin = 1e-4 / (tau * sr);
      let step = 0, at = -1, last = -1;
      for (let i = Math.max(1, i0 - 128); i < buf.length; i++) {
        const hi = buf[i - 1], lo = hi > 1e-4 ? hi * k : Math.max(0, hi - lin), b = buf[i];
        const d = b < lo ? lo - b : b > hi ? b - hi : 0; if (d > step) { step = d; at = i; }
      }
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i] !== 0) { last = i; break; }
      let tail = 0; for (let i = last + 1; i < buf.length; i++) tail = Math.max(tail, Math.abs(buf[i]));
      return { sr, g0: buf[i0], step, atTau: (at - i0) / (tau * sr),
        lastTau: (last + 1 - i0) / (tau * sr), lastV: buf[last], tail, end: buf[buf.length - 1] };
    }, [tOff, tau]);
    const vcaEdge = await page.evaluate(() => window.__eV());
    const gRest = await page.evaluate(() => vca.gain.value);
    // portadora: lo que entra al VCA (salida del VCA / ganancia) mientras sostiene
    const vcaSus = await level(page, tOff - 0.4, tOff, 'vca');
    const carrier = vcaSus.pk - dB(g0);
    // ganancia de pequeña señal del VCA a la salida: entre −54 y −71 dB de envolvente
    const wa = tOff + (knee - 4) * tau, wb = tOff + (knee - 2) * tau;
    const gain = (await level(page, wa, wb)).rms - (await level(page, wa, wb, 'vca')).rms;
    const sustain = await level(page, tOff - 0.4, tOff);
    const after = await level(page, tZero + 0.05, tZero + 1.0);
    return { tau, tOff, g0, knee, tZero, env, vcaEdge, gRest, carrier, gain, stepOut: dB(env.step) + carrier + gain, sustain, after, errors };
  } finally { await ctx.close(); }
}

for (const [name, patch] of [['dry', PATCH.dry], ['loud', PATCH.loud]]) {
  test(`2 · ${name}: el release cae sin escalones hasta 0 exacto (envolvente < −120 dB, salida < −100 dBFS)`, async () => {
    const r = await release(URL_PATH, patch);
    const { env, tau } = r;
    console.log(`  ${name} · sostenido ${fmt(r.sustain.rms)} dBFS RMS · VCA ${env.g0.toFixed(3)} → release τ ${(tau * 1000).toFixed(0)} ms, −80 dB a las ${(r.knee - 1).toFixed(2)} τ y 0 a las ${r.knee.toFixed(2)} τ (${(r.knee * tau * 1000).toFixed(0)} ms)`);
    console.log(`    envolvente: mayor escalón ${fmt(dB(env.step))} dB (a las ${env.atTau.toFixed(2)} τ) · última ≠ 0 a las ${env.lastTau.toFixed(3)} τ (${fmt(dB(env.lastV))} dB) · después ${env.tail}`);
    console.log(`    VCA: última muestra ≠ 0 ${fmt(dB(r.vcaEdge.v))} dBFS a ${((r.vcaEdge.t + 1 / r.vcaEdge.sr - r.tZero) * r.vcaEdge.sr).toFixed(1)} muestras del 0 de la sonda · vca.gain en reposo ${r.gRest}`);
    console.log(`    salida: portadora ${fmt(r.carrier)} dBFS × ganancia VCA→salida ${r.gain >= 0 ? '+' : ''}${r.gain.toFixed(1)} dB → escalón ${fmt(r.stepOut)} dBFS · después del 0: pico ${fmt(r.after.pk)} dBFS`);
    assert.ok(r.sustain.rms > -30, `control: la nota sonó (${fmt(r.sustain.rms)} dBFS)`);
    assert.ok(env.g0 > 0.8, 'control: la sonda ve el sustain al entrar al release');
    assert.ok(dB(env.step) < -120, `envolvente, de la entrada al release al 0: mayor escalón ${fmt(dB(env.step))} dB a las ${env.atTau.toFixed(2)} τ (tiene que ser < −120)`);
    assert.ok(Math.abs(env.lastTau - r.knee) < 0.01 && env.tail === 0, `la envolvente llega a 0 exacto a las ${r.knee.toFixed(2)} τ y se queda (${env.lastTau.toFixed(3)} τ)`);
    assert.ok(Math.abs(r.vcaEdge.t + 1 / r.vcaEdge.sr - r.tZero) < 0.001, 'el VCA de verdad llega a 0 en la misma muestra que la sonda');
    assert.ok(r.stepOut < -100, `escalón en la salida de J4: ${fmt(r.stepOut)} dBFS (tiene que ser < −100)`);
    assert.equal(r.gRest, 0, 'en reposo el VCA queda en 0 exacto');
    assert.equal(r.after.pk, -Infinity, 'después del release la salida es 0 exacto');
    assert.deepEqual(r.errors, []);
    if (!baseHtml) { console.log(`    (sin git o sin la base ${BASE}: se saltea el control con la versión de antes)`); return; }
    // control: la versión de antes. La sonda tiene que ver el salto de Chromium a ~10 τ.
    const b = await release(BASE_PATH, patch);
    console.log(`    antes (${BASE}): mayor escalón ${fmt(dB(b.env.step))} dB a las ${b.env.atTau.toFixed(2)} τ → en la salida ${fmt(b.stepOut)} dBFS · en reposo vca.gain ${b.gRest.toPrecision(2)}, envolvente ${fmt(dB(b.env.end))} dB`);
    assert.ok(dB(b.env.step) > -100, `control: con la versión de antes la sonda ve el salto de Chromium (${fmt(dB(b.env.step))} dB)`);
    assert.deepEqual(b.errors, []);
  });
}

test('2b · una nota tocada durante el release no queda cortada por el 0 programado', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await setPatch(page, PATCH.dry);
    await page.waitForTimeout(1200);
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(600);
    const t1 = await page.evaluate(() => { noteOff('pad'); return ctx.currentTime; });
    const tau = await page.evaluate(() => Math.max(.005, P.rel / 1000 / 3));
    await page.waitForTimeout(150);
    const t2 = await page.evaluate(() => { noteOn('pad', 57); return ctx.currentTime; });
    await page.waitForFunction((t) => ctx.currentTime > t, t1 + 11 * tau + 0.8, { timeout: 15000 });
    const end = await page.evaluate(() => { const g = vca.gain.value; noteOff('pad'); return { t: ctx.currentTime, g }; });
    const ref = await level(page, t1 - 0.3, t1);
    const wins = [];
    for (let t = t2 + 0.3; t + 0.1 <= end.t; t += 0.1) wins.push(await level(page, t, t + 0.1));
    const low = wins.reduce((a, b) => (b.rms < a.rms ? b : a));
    console.log(`  segunda nota a los ${Math.round((t2 - t1) * 1000)} ms del release, sostenida hasta ${(end.t - t1).toFixed(2)} s (el 0 era a los ~${(11 * tau).toFixed(2)} s) · ${wins.length} ventanas de 100 ms: la más baja ${fmt(low.rms)} dBFS RMS (primera nota ${fmt(ref.rms)}) · VCA ${end.g.toFixed(3)}`);
    assert.ok(end.t - t1 > 11 * tau + 0.5, 'control: la segunda nota cruzó el momento del 0 programado');
    assert.ok(Math.abs(low.rms - ref.rms) < 1, `la segunda nota se sostiene al nivel de la primera (${fmt(low.rms)} vs ${fmt(ref.rms)} dBFS)`);
    assert.ok(end.g > 0.8, `el VCA sigue en el sustain (${end.g})`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
