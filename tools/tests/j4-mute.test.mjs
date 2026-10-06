#!/usr/bin/env node
// tools/tests/j4-mute.test.mjs
//
// MUTE (intermitente) y BURNOUT (definitivo) de J4-Sirens Station.
//
//   MUTE     silencia la SALIDA mientras se mantiene (botón o tecla 9) y deja
//            correr el eco y la reverb por dentro: al soltar se oyen las colas.
//   BURNOUT  un toque (o la tecla 0) silencia todo hasta otro toque: corta las
//            voces, FEEDBACK ∞ y ECHO THROW y vacía el eco y la reverb, así que
//            al volver no queda ninguna cola.
//
// La salida se mide con un AudioWorklet medidor (pico y RMS por bloque de 128
// muestras, con su currentTime; un AnalyserNode solo da la última ventana)
// colgado de un tap propio: todo nodo que se conecta a un AudioDestinationNode se
// conecta también al tap. Es lo que llega a los parlantes, sin depender del
// grafo del instrumento (sirve igual para la versión de antes, ver el test 9).
//
//   1  MUTE sostenido: ≈0 (pico < −60 dBFS) a los 30 ms y vuelve al soltar;
//      soltar fuera del botón (mouse y dedo) también lo suelta.
//   1b MUTE deja las colas: al soltar todavía se oye el eco/reverb.
//   2  blur, visibilitychange, pagehide, pointercancel y la tecla 9 + blur sueltan el MUTE.
//   3  BURNOUT: silencio; al volver, < −80 dBFS durante 3 s sin tocar nada
//      (eco largo + FEEDBACK ∞) y la nota siguiente suena.
//   4  BURNOUT apaga FEEDBACK ∞ y ECHO THROW y actualiza su UI.
//   5  Recargar con BURNOUT activo arranca sin mute (no va en la sesión ni en los slots).
//   6  REC graba el silencio del MUTE (el mute va antes del punto de captura).
//   7  Hub C2 falso: el mute actúa sobre el canal del hub y el adaptador no cambió.
//   8  Botones ≥44 px (≥56 de alto fuera del peek), sin solaparse, en 4 viewports.
//   9  Con el mute apagado la salida es idéntica a la de antes (mismo RMS que el
//      commit base en un patch fijo, y muestra a muestra contra el compresor).
//
//   node tools/tests/j4-mute.test.mjs
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
const BASE = '3aceb34';   // main al arrancar la sesión del mute (antes de tocar J4)
const BASE_PATH = '/descargables/__base-J4.html';
const HUB_PATH = '/__test-hub-mute.html';

let baseHtml = null;
try { baseHtml = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
catch (e) { baseHtml = null; }

/* Tap de salida + medidor. Corre antes que la página (addInitScript). */
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
  });`;
  window.__m = []; window.__mLast = -1;
  window.__meterOn = async (c) => {
    if (c.__meter) return;
    if (!c.__tap) c.__tap = c.createGain();
    const url = URL.createObjectURL(new Blob([CODE], { type: 'application/javascript' }));
    await c.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(c, 'zd-meter');
    const mute = c.createGain(); mute.gain.value = 0;
    conn.call(c.__tap, node); conn.call(node, mute); conn.call(mute, c.destination);
    node.port.onmessage = (e) => { const a = e.data; for (let i = 0; i < a.length; i++) window.__m.push(a[i]); window.__mLast = a[a.length - 3]; };
    c.__meter = node;
  };
  window.__stats = (t0, t1) => {
    let pk = 0, ss = 0, n = 0;
    const m = window.__m;
    for (let i = 0; i < m.length; i += 3) { const t = m[i]; if (t >= t0 && t < t1) { if (m[i + 1] > pk) pk = m[i + 1]; ss += m[i + 2]; n++; } }
    return { pk, rms: n ? Math.sqrt(ss / n) : 0, n };
  };
  // ctx.currentTime en el momento exacto de cada evento de puntero sobre MUTE / BURNOUT
  window.__t = {};
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
    window.addEventListener(type, (e) => {
      const b = e.target && e.target.closest && e.target.closest('#muteBtn, #burnBtn');
      if (b && typeof ctx !== 'undefined' && ctx) window.__t[b.id + ':' + type] = ctx.currentTime;
    }, true);
  }
};

const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '−∞');

/* Patches de prueba (applyPatch mezcla: lo que no está queda como estaba). */
const PATCH = {
  // tono fijo y seco: sin barrido, sin LFOs, sin eco, reverb ni phaser
  dry: { wave: 'square', mode: 'wail', shape: 'tri', rate: 6, depth: 0, cutoff: 1400, reso: 0.62, envAmt: 0.35, glide: 40,
    atk: 6, dec: 220, sus: 0.85, rel: 340, vol: 0.8, drive: 1.6,
    lfo: [{ rate: 0.8, depth: 0, dest: 'off', shape: 'sine' }, { rate: 0.15, depth: 0, dest: 'off', shape: 'tri' }],
    echo: { time: 0.38, fb: 0.42, tone: 3400, wow: 0.22, sat: 1.8, mix: 0.38, on: false },
    rev: { mode: 'spring', decay: 2.6, tone: 4200, mix: 0.26, on: false },
    ph: { rate: 0.35, depth: 0.6, fb: 0.35, mix: 0, on: false } },
  // colas largas y estables (lazo del eco 0,5 × 1,5 < 1): decaen, pero tardan
  tails: { wave: 'square', mode: 'wail', depth: 0, rel: 120,
    echo: { time: 0.6, fb: 0.5, tone: 3400, wow: 0.1, sat: 1.0, mix: 0.7, on: true },
    rev: { mode: 'plate', decay: 6, tone: 5000, mix: 0.6, on: true }, ph: { mix: 0, on: false } },
  // el peor caso: eco largo que se autooscila + reverb larga
  worst: { wave: 'square', mode: 'wail', depth: 0.3, rel: 200,
    echo: { time: 1.2, fb: 0.9, tone: 3400, wow: 0.2, sat: 1.8, mix: 0.8, on: true },
    rev: { mode: 'spring', decay: 6, tone: 4200, mix: 0.6, on: true }, ph: { mix: 0, on: false } },
};

let srv, browser;

test.before(async () => {
  const extra = {
    // hub C2 mínimo con un medidor sobre el canal que le devuelve al instrumento
    [HUB_PATH]: {
      body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>hub</title><script>
window.C2 = { apiVersion: 1, ctx: new AudioContext(), registered: [], transport: { bpm: 100, play(){}, stop(){} },
  registerInstrument(api){ this.registered.push(api); const g = this.ctx.createGain(); g.connect(this.ctx.destination);
    const a = this.ctx.createAnalyser(); a.fftSize = 4096; g.connect(a); this.an = a; return g; } };
window.hubRms = () => { const a = new Float32Array(C2.an.fftSize); C2.an.getFloatTimeDomainData(a); let s = 0, p = 0; for (const x of a) { s += x * x; p = Math.max(p, Math.abs(x)); } return { rms: Math.sqrt(s / a.length), pk: p }; };
</script></head><body style="margin:0"><iframe name="c2slot:j4mute" src="${URL_PATH}" style="width:1200px;height:800px;border:0" title="J4"></iframe></body></html>`,
    },
  };
  if (baseHtml) extra[BASE_PATH] = { body: baseHtml };
  srv = await serveRoot(ROOT, extra);
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(viewport = { width: 390, height: 844 }, { path = URL_PATH, init } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 1200, acceptDownloads: true });
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
}
/** Falla rápido (antes de la implementación no existen los botones). */
async function need(page, sel) {
  const ok = await page.waitForSelector(sel, { state: 'attached', timeout: 1500 }).then(() => true, () => false);
  assert.ok(ok, `falta ${sel} en el instrumento`);
}
const now = (page) => page.evaluate(() => ctx.currentTime);
/** Espera a que el medidor haya cubierto hasta t1 y devuelve pico/RMS en dBFS de [t0, t1). */
async function level(page, t0, t1) {
  await page.waitForFunction((t) => window.__mLast >= t, t1, { timeout: 15000 });
  const s = await page.evaluate(([a, b]) => window.__stats(a, b), [t0, t1]);
  return { pk: dB(s.pk), rms: dB(s.rms), n: s.n };
}
async function center(page, sel) {
  const b = await page.locator(sel).boundingBox();
  assert.ok(b, `${sel} no está a la vista`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const state = (page) => page.evaluate(() => ({
  mute: document.getElementById('muteBtn').getAttribute('aria-pressed'),
  burn: document.getElementById('burnBtn').getAttribute('aria-pressed'),
  gain: muteGain.gain.value,
}));
const touch = (x, y, id = 1) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
const setPatch = (page, p) => page.evaluate((x) => { applyPatch(x); }, p);

// ─────────────────────────────── 1 · MUTE sostenido ───────────────────────────

test('1 · MUTE sostenido: silencio en ≤30 ms, vuelve al soltar; soltar fuera del botón también lo suelta', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#muteBtn');
    await setPatch(page, PATCH.dry);
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(700);
    const c = await center(page, '#muteBtn');
    // mouse: apretar, mantener 400 ms, soltar encima
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.waitForTimeout(200);
    const mid = await state(page);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(350);
    const t = await page.evaluate(() => window.__t);
    const down = t['muteBtn:pointerdown'], up = t['muteBtn:pointerup'];
    assert.ok(down && up && up > down, 'el medidor tiene que ver el pointerdown y el pointerup del MUTE');
    const pre = await level(page, down - 0.3, down), during = await level(page, down + 0.03, up), post = await level(page, up + 0.03, up + 0.3);
    console.log(`  mouse · antes ${fmt(pre.rms)} dBFS RMS · apretado (desde +30 ms) pico ${fmt(during.pk)} · al soltar ${fmt(post.rms)} RMS · aria-pressed ${mid.mute}`);
    assert.equal(mid.mute, 'true', 'MUTE apretado: aria-pressed="true"');
    assert.ok(pre.rms > -30, `la sirena tiene que estar sonando antes (${fmt(pre.rms)} dBFS)`);
    assert.ok(during.pk < -60, `con MUTE apretado la salida tiene que quedar en ≈0 a los 30 ms (pico ${fmt(during.pk)} dBFS)`);
    assert.ok(Math.abs(post.rms - pre.rms) < 2, `al soltar vuelve el nivel (${fmt(post.rms)} vs ${fmt(pre.rms)} dBFS)`);
    assert.equal((await state(page)).mute, 'false');

    // mouse: apretar encima, salir del botón con el botón apretado y soltar sobre el pad
    const pad = await center(page, '#xypad');
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(pad.x, pad.y, { steps: 6 });
    const outMouse = await state(page);
    await page.mouse.up();
    await page.waitForTimeout(150);
    const relMouse = await state(page);
    // dedo: lo mismo con eventos táctiles
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(c.x, c.y)] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(c.x + (pad.x - c.x) * i / 6, c.y + (pad.y - c.y) * i / 6)] });
    const outTouch = await state(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    const relTouch = await state(page);
    const t1 = await now(page);
    const back = await level(page, t1 - 0.15, t1);
    console.log(`  fuera del botón · mouse ${outMouse.mute}→${relMouse.mute} · dedo ${outTouch.mute}→${relTouch.mute} · después ${fmt(back.rms)} dBFS RMS`);
    assert.equal(outMouse.mute, 'true', 'con el mouse apretado fuera del botón sigue muteado (captura del puntero)');
    assert.equal(relMouse.mute, 'false', 'soltar el mouse fuera del botón suelta el MUTE');
    assert.equal(outTouch.mute, 'true', 'con el dedo corrido fuera del botón sigue muteado');
    assert.equal(relTouch.mute, 'false', 'levantar el dedo fuera del botón suelta el MUTE');
    assert.ok(Math.abs(back.rms - pre.rms) < 2, `después de soltar fuera vuelve el nivel (${fmt(back.rms)} dBFS)`);
    await page.evaluate(() => noteOff('pad'));
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('1b · MUTE deja las colas: al soltar se oyen el eco y la reverb que siguieron por dentro', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#muteBtn');
    await setPatch(page, PATCH.tails);
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(800);
    await page.evaluate(() => noteOff('pad'));
    await page.waitForTimeout(150);
    const c = await center(page, '#muteBtn');
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => window.__t);
    const down = t['muteBtn:pointerdown'], up = t['muteBtn:pointerup'];
    const during = await level(page, down + 0.03, up), after = await level(page, up + 0.03, up + 0.53);
    console.log(`  MUTE de ${Math.round((up - down) * 1000)} ms sobre la cola · apretado pico ${fmt(during.pk)} dBFS · 500 ms después de soltar ${fmt(after.rms)} dBFS RMS`);
    assert.ok(during.pk < -60, `apretado: silencio (pico ${fmt(during.pk)} dBFS)`);
    assert.ok(after.rms > -50, `al soltar tiene que oírse la cola, claramente por encima de −60 dBFS (${fmt(after.rms)} dBFS RMS)`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────── 2 · nada deja un MUTE colgado ──────────────────────

test('2 · blur, visibilitychange, pagehide, pointercancel y tecla 9 + blur sueltan el MUTE', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#muteBtn');
    await setPatch(page, PATCH.dry);
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(500);
    const c = await center(page, '#muteBtn');
    const cdp = await ctx.newCDPSession(page);
    const triggers = {
      blur: () => page.evaluate(() => window.dispatchEvent(new Event('blur'))),
      visibilitychange: () => page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
      }),
      pagehide: () => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))),
    };
    const out = {};
    for (const [name, fire] of Object.entries(triggers)) {
      await page.mouse.move(c.x, c.y); await page.mouse.down();
      await page.waitForTimeout(80);
      const held = (await state(page)).mute;
      await fire();
      await page.waitForTimeout(80);
      const after = await state(page);
      await page.mouse.up();
      out[name] = { apretado: held, despues: after.mute };
    }
    // pointercancel: el sistema se lleva el toque (gesto del SO, llamada entrante)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(c.x, c.y)] });
    await page.waitForTimeout(80);
    const heldT = (await state(page)).mute;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(80);
    out.pointercancel = { apretado: heldT, despues: (await state(page)).mute };
    // tecla 9 apretada y la ventana pierde el foco (el keyup no llega nunca)
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('9');
    await page.waitForTimeout(80);
    const heldK = (await state(page)).mute;
    await triggers.blur();
    await page.waitForTimeout(80);
    out.tecla9 = { apretado: heldK, despues: (await state(page)).mute };
    await page.keyboard.up('9');
    await page.waitForTimeout(250);
    const t1 = await now(page);
    const back = await level(page, t1 - 0.15, t1);
    console.log(`  ${JSON.stringify(out)} · salida al final ${fmt(back.rms)} dBFS RMS`);
    const ok = { apretado: 'true', despues: 'false' };
    assert.deepEqual(out, { blur: ok, visibilitychange: ok, pagehide: ok, pointercancel: ok, tecla9: ok });
    assert.ok(back.rms > -30, `la salida vuelve (${fmt(back.rms)} dBFS)`);
    assert.equal(await page.evaluate(() => muteGain.gain.value > 0.99), true, 'muteGain vuelve a 1');
    await page.evaluate(() => noteOff('pad'));
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────────── 3 · BURNOUT ──────────────────────────────────

test('3 · BURNOUT: silencio total; al volver, < −80 dBFS durante 3 s y la nota siguiente suena', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#burnBtn');
    await setPatch(page, PATCH.worst);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('4');                       // FEEDBACK ∞ sostenido
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(1000);
    await page.evaluate(() => noteOff('pad'));
    await page.waitForTimeout(1000);
    let t = await now(page);
    const tail = await level(page, t - 0.4, t);
    assert.ok(tail.rms > -30, `antes del BURNOUT las colas tienen que estar sonando fuerte (${fmt(tail.rms)} dBFS)`);
    await page.click('#burnBtn');
    await page.waitForTimeout(200);
    const on = await page.evaluate(() => ({ pressed: document.getElementById('burnBtn').getAttribute('aria-pressed'), note: (document.getElementById('burnNote') || {}).textContent || '', fb: fbInfOn }));
    await page.keyboard.up('4');
    await page.waitForTimeout(500);
    await page.click('#burnBtn');
    await page.waitForTimeout(3200);
    t = await now(page);
    const silentAfter = await level(page, t - 3.1, t - 0.05);
    console.log(`  colas antes ${fmt(tail.rms)} dBFS RMS · BURNOUT aria-pressed ${on.pressed} · aviso «${on.note}» · ∞ ${on.fb} · al volver 3 s pico ${fmt(silentAfter.pk)} dBFS`);
    assert.equal(on.pressed, 'true', 'BURNOUT encendido: aria-pressed="true"');
    assert.ok(/BURNOUT/.test(on.note), 'aviso visible mientras BURNOUT está activo');
    assert.equal(on.fb, false, 'BURNOUT apaga FEEDBACK ∞');
    assert.ok(silentAfter.pk < -80, `al des-mutear sin tocar nada: < −80 dBFS durante 3 s (pico ${fmt(silentAfter.pk)} dBFS)`);
    assert.equal(await page.evaluate(() => document.getElementById('burnBtn').getAttribute('aria-pressed')), 'false');
    // la siguiente nota vuelve a sonar
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(600);
    t = await now(page);
    const next = await level(page, t - 0.3, t);
    await page.evaluate(() => noteOff('pad'));
    console.log(`  la nota siguiente ${fmt(next.rms)} dBFS RMS`);
    assert.ok(next.rms > -30, `después del BURNOUT la nota siguiente suena (${fmt(next.rms)} dBFS)`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('3b · BURNOUT: silencio desde los 30 ms del toque y mientras dure', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#burnBtn');
    await setPatch(page, PATCH.worst);
    await page.evaluate(() => { setFbInf(true); noteOn('pad', 57); });
    await page.waitForTimeout(1200);
    await page.click('#burnBtn');
    await page.waitForTimeout(1500);
    const tOn = (await page.evaluate(() => window.__t))['burnBtn:pointerdown'];
    const during = await level(page, tOn + 0.03, tOn + 1.4);
    console.log(`  BURNOUT con la sirena y ∞ sonando · pico desde +30 ms hasta +1,4 s ${fmt(during.pk)} dBFS`);
    assert.ok(during.pk < -80, `BURNOUT: silencio total (pico ${fmt(during.pk)} dBFS)`);
    assert.equal(await page.evaluate(() => held.length), 0, 'BURNOUT corta las voces de sirena');
    await page.click('#burnBtn');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('3c · BURNOUT ida y vuelta en 10 ms (antes de que termine de vaciar): tampoco vuelven las colas', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#burnBtn');
    await setPatch(page, PATCH.worst);
    await page.evaluate(() => { setFbInf(true); noteOn('pad', 57); });
    await page.waitForTimeout(1200);
    const t0 = await page.evaluate(() => new Promise((ok) => { setBurnout(true); const t = ctx.currentTime; setTimeout(() => { setBurnout(false); ok(t); }, 10); }));
    await page.waitForTimeout(2300);
    const after = await level(page, t0 + 0.12, t0 + 2.1);
    const st = await page.evaluate(() => ({ burn: burnOn, fb: fbInfOn, voces: held.length, gain: +muteGain.gain.value.toFixed(3) }));
    console.log(`  ida y vuelta · desde +120 ms hasta +2,1 s pico ${fmt(after.pk)} dBFS · ${JSON.stringify(st)}`);
    assert.ok(after.pk < -80, `sin colas después de una ida y vuelta rápida (pico ${fmt(after.pk)} dBFS)`);
    assert.deepEqual(st, { burn: false, fb: false, voces: 0, gain: 1 }, 'queda sin BURNOUT, sin ∞, sin voces y con la salida abierta');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────── 4 · BURNOUT apaga ∞ y THROW ──────────────────────────

test('4 · BURNOUT apaga FEEDBACK ∞ y ECHO THROW y actualiza su UI', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#burnBtn');
    const throws = await page.evaluate(() => [...document.querySelectorAll('#throwRow .throwbtn')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const cdp = await ctx.newCDPSession(page);
    // dos dedos: ECHO THROW y FEEDBACK ∞ apretados a la vez
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(throws[0].x, throws[0].y, 1), touch(throws[1].x, throws[1].y, 2)] });
    await page.waitForTimeout(120);
    const ui = () => page.evaluate(() => ({ throwOn, fbInfOn,
      btn: [...document.querySelectorAll('#throwRow .throwbtn')].slice(0, 2).map((b) => [b.classList.contains('on'), b.getAttribute('aria-pressed')]) }));
    const before = await ui();
    await page.keyboard.press('0');                     // BURNOUT por teclado, con los dos dedos apretados
    await page.waitForTimeout(200);
    const during = await ui();
    const graph = await page.evaluate(() => ({ send: echoIn.gain.value, fb: +echoFB.gain.value.toFixed(3), want: +P.echo.fb.toFixed(3),
      burn: document.getElementById('burnBtn').getAttribute('aria-pressed'), muteDis: document.getElementById('muteBtn').getAttribute('aria-disabled') }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const released = await ui();
    await page.keyboard.press('0');
    await page.waitForTimeout(250);
    const back = await page.evaluate(() => ({ send: +echoIn.gain.value.toFixed(3), burn: document.getElementById('burnBtn').getAttribute('aria-pressed') }));
    console.log(`  antes ${JSON.stringify(before)} · BURNOUT ${JSON.stringify(during)} ${JSON.stringify(graph)} · al soltar ${JSON.stringify(released)} · al volver ${JSON.stringify(back)}`);
    assert.deepEqual(before, { throwOn: true, fbInfOn: true, btn: [[true, 'true'], [true, 'true']] }, 'los dos throws apretados');
    assert.deepEqual(during, { throwOn: false, fbInfOn: false, btn: [[false, 'false'], [false, 'false']] }, 'BURNOUT apaga ECHO THROW y FEEDBACK ∞, también en la UI');
    assert.equal(graph.burn, 'true');
    assert.equal(graph.muteDis, 'true', 'con BURNOUT, MUTE queda aria-disabled');
    assert.ok(graph.send < 0.01, `envío al eco cerrado durante BURNOUT (${graph.send})`);
    assert.equal(graph.fb, graph.want, 'el feedback del eco vuelve al de la perilla (sin ∞)');
    assert.deepEqual(released, { throwOn: false, fbInfOn: false, btn: [[false, 'false'], [false, 'false']] }, 'soltar los dedos no los vuelve a prender');
    assert.deepEqual(back, { send: 1, burn: 'false' }, 'al salir del BURNOUT el envío vuelve a 1');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────── 5 · BURNOUT no se guarda ───────────────────────────

test('5 · recargar con BURNOUT activo arranca sin mute (ni en la sesión ni en los slots)', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#burnBtn');
    await page.click('#burnBtn');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => burnOn), true);
    await page.evaluate(async () => {
      KREG.cutoff.setNorm(0.3);
      document.getElementById('slotName').value = 'Durante el corte'; saveSlot();
      await Session.saveNow();
    });
    const stored = await page.evaluate(async () => JSON.stringify({ s: await Session.load(), slots: localStorage.getItem('zd:j4-sirens:slots') }));
    const cutoff = await page.evaluate(() => P.cutoff);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const pre = await page.evaluate(() => ({ burn: burnOn, mute: muteOn, pressed: document.getElementById('burnBtn').getAttribute('aria-pressed'), cutoff: P.cutoff }));
    await powerOn(page);
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(600);
    const t = await now(page);
    const lv = await level(page, t - 0.3, t);
    const g = await page.evaluate(() => muteGain.gain.value);
    await page.evaluate(() => noteOff('pad'));
    const keys = [...stored.matchAll(/\\?"([A-Za-z_]+)\\?"\s*:/g)].map((m) => m[1]);
    console.log(`  claves guardadas: ${[...new Set(keys)].length} distintas, ninguna burn*/mute* · al recargar ${JSON.stringify(pre)} · muteGain ${g} · nota ${fmt(lv.rms)} dBFS RMS`);
    assert.ok(keys.length > 20, 'control: se leyeron la sesión y los slots guardados');
    assert.deepEqual(keys.filter((k) => /burn|mute/i.test(k)), [], 'BURNOUT y MUTE no van en el autoguardado ni en los slots');
    assert.equal(Math.round(pre.cutoff), Math.round(cutoff), 'la sesión sí se restauró (control)');
    assert.deepEqual([pre.burn, pre.mute, pre.pressed], [false, false, 'false'], 'al abrir, sin BURNOUT ni MUTE');
    assert.equal(g, 1, 'muteGain arranca en 1');
    assert.ok(lv.rms > -30, `suena (${fmt(lv.rms)} dBFS)`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────── 6 · REC graba el mute ──────────────────────────

test('6 · REC: la toma graba el silencio del MUTE (mute antes del punto de captura)', async () => {
  const { ctx, page, errors } = await open();
  try {
    await powerOn(page);
    await need(page, '#muteBtn');
    await setPatch(page, PATCH.dry);
    await page.click('#recBtn');
    await page.waitForFunction(() => recState === 'rec');
    await page.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(600);
    const c = await center(page, '#muteBtn');
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.evaluate(() => noteOff('pad'));
    await page.click('#recBtn');
    await page.waitForFunction(() => recState === 'idle' && take, null, { timeout: 15000 });
    // ventanas de 10 ms del WAV: pico en dBFS
    const win = await page.evaluate(async () => {
      const buf = new DataView(await take.res.blob.arrayBuffer());
      let p = 12, data = -1, len = 0;
      while (p < buf.byteLength - 8) { const id = String.fromCharCode(buf.getUint8(p), buf.getUint8(p + 1), buf.getUint8(p + 2), buf.getUint8(p + 3)); const sz = buf.getUint32(p + 4, true); if (id === 'data') { data = p + 8; len = sz; break; } p += 8 + sz; }
      const ch = buf.getUint16(22, true), sr = buf.getUint32(24, true), frames = len / 2 / ch, step = Math.round(sr / 100), out = [];
      for (let f = 0; f < frames; f += step) { let pk = 0; for (let i = f; i < Math.min(frames, f + step); i++) for (let k = 0; k < ch; k++) pk = Math.max(pk, Math.abs(buf.getInt16(data + (i * ch + k) * 2, true)) / 32768); out.push(pk); }
      return out;
    });
    const db = win.map(dB);
    const loud = db.map((v) => v > -30);
    const first = loud.indexOf(true), last = loud.lastIndexOf(true);
    let best = 0, run = 0, runEnd = -1;
    for (let i = first; i <= last; i++) { if (db[i] < -60) { run++; if (run > best) { best = run; runEnd = i; } } else run = 0; }
    const beforeRun = db.slice(Math.max(first, runEnd - best - 20), runEnd - best).filter((v) => v > -30).length;
    const afterRun = db.slice(runEnd + 1, runEnd + 21).filter((v) => v > -30).length;
    console.log(`  toma ${win.length * 10} ms · tramo en silencio (< −60 dBFS) dentro de la nota: ${best * 10} ms · sonido antes ${beforeRun}/20 ventanas, después ${afterRun}/20`);
    assert.ok(best * 10 >= 300 && best * 10 <= 480, `la toma tiene que tener el silencio del MUTE de 400 ms (tiene ${best * 10} ms)`);
    assert.ok(beforeRun >= 15 && afterRun >= 15, 'y la sirena antes y después');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── 7 · hub C2 ─────────────────────────────────

test('7 · hub C2 falso: MUTE y BURNOUT actúan sobre el canal del hub; el adaptador no cambió', async () => {
  const bctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await bctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(srv.origin + HUB_PATH, { waitUntil: 'load' });
    await page.waitForFunction(() => window.C2.registered.length === 1, null, { timeout: 8000 });
    const frame = page.frames().find((f) => f.url().includes('J4-Sirens_Station.html'));
    await frame.waitForFunction(() => ctx && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
    const has = await frame.evaluate(() => !!document.getElementById('muteBtn') && !!document.getElementById('burnBtn'));
    assert.ok(has, 'faltan MUTE y BURNOUT en el instrumento');
    await frame.evaluate((p) => { applyPatch(p); noteOn('pad', 57); }, PATCH.dry);
    await page.waitForTimeout(600);
    const hub = async () => dB((await page.evaluate(() => hubRms())).rms);
    const on = await hub();
    await frame.locator('#muteBtn').scrollIntoViewIfNeeded();
    const b2 = await frame.locator('#muteBtn').boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down();
    await page.waitForTimeout(300);
    const muted = await hub();
    await page.mouse.up();
    await page.waitForTimeout(300);
    const back = await hub();
    await frame.click('#burnBtn');
    await page.waitForTimeout(300);
    const burned = await hub();
    const held = await frame.evaluate(() => held.length);
    await frame.click('#burnBtn');
    await page.waitForTimeout(300);
    const quiet = await hub();
    await frame.evaluate(() => noteOn('pad', 57));
    await page.waitForTimeout(400);
    const next = await hub();
    await frame.evaluate(() => noteOff('pad'));
    const s = await frame.evaluate(() => ({ session: Session === null, slot: SLOT_ID, same: ctx === window.parent.C2.ctx }));
    console.log(`  canal del hub · sonando ${fmt(on)} · MUTE ${fmt(muted)} · suelto ${fmt(back)} · BURNOUT ${fmt(burned)} (voces ${held}) · vuelta sin tocar ${fmt(quiet)} · nota ${fmt(next)} dBFS RMS`);
    assert.ok(on > -30 && back > -30 && next > -30, 'el canal del hub recibe la sirena');
    assert.ok(muted < -60, `MUTE silencia el canal del hub (${fmt(muted)} dBFS)`);
    assert.ok(burned < -80 && quiet < -80, `BURNOUT silencia el canal y no vuelve ninguna cola (${fmt(burned)} / ${fmt(quiet)} dBFS)`);
    assert.equal(held, 0);
    assert.deepEqual(s, { session: true, slot: 'j4mute', same: true }, 'el adaptador sigue igual: slot, AudioContext del hub, sin autoguardado');
    assert.deepEqual(errors, []);
  } finally { await bctx.close(); }

  // el adaptador C2 contra el commit base
  if (!baseHtml) { console.log(`  (sin git o sin la base ${BASE}: se saltea la comparación del adaptador)`); return; }
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const nowHtml = readFileSync(join(ROOT, FILE), 'utf8');
  const slice = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, `no encuentro «${from}»`); return src.slice(a, src.indexOf(to, a)); };
  assert.equal(slice(nowHtml, 'ADAPTADOR C2 v1 — J4 Sirens Station', '</script>'), slice(baseHtml, 'ADAPTADOR C2 v1 — J4 Sirens Station', '</script>'),
    'el <script> del adaptador C2 (api, registerInstrument, allNotesOff, onTransport, zeroday_sync) tiene que ser idéntico');
  assert.equal(slice(nowHtml, 'ADAPTADOR C2 v1 — detección del hub', 'let osc=null'), slice(baseHtml, 'ADAPTADOR C2 v1 — detección del hub', 'let osc=null'),
    'la detección de HOST / SLOT_ID tiene que ser idéntica');
  // sentencias del contrato C2 (por sentencia, no por línea): ninguna se quita ni cambia
  const RE = /\bHOST\b|C2_OUT|C2_CHANNEL|registerInstrument|zeroday_sync|SLOT_ID/;
  const stmts = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;\n]/).map((x) => x.trim()).filter((x) => x && RE.test(x));
  const before = stmts(baseHtml), after = new Set(stmts(nowHtml));
  const gone = before.filter((x) => !after.has(x));
  const added = [...after].filter((x) => !before.includes(x));
  console.log(`  adaptador idéntico a ${BASE} · ${before.length} sentencias del contrato C2, 0 quitadas · ${added.length} nuevas: ${JSON.stringify(added)}`);
  assert.deepEqual(gone, [], 'ninguna sentencia con HOST / C2_OUT / registerInstrument / zeroday_sync puede quitarse ni cambiar');
  assert.ok(added.every((x) => /^(\}?\s*(else\s+)?if\s*\(\s*!?\s*HOST\b|.*\bHOST\s*\?)/.test(x)), `las sentencias nuevas solo pueden leer HOST: ${JSON.stringify(added)}`);
});

// ─────────────────────────────── 8 · layout ───────────────────────────────────

const VIEWPORTS = [
  { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 },
];
for (const v of VIEWPORTS) {
  test(`8 · ${v.width}×${v.height}: MUTE y BURNOUT ≥44 px, al alcance y sin tapar nada`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      await powerOn(page);
      await need(page, '#muteBtn');
      const measure = () => page.evaluate(() => {
        const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
        const hit = (e) => { const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!t && e.contains(t); };
        const mine = ['muteBtn', 'burnBtn'].map((id) => { const e = document.getElementById(id); return { id, ...r(e), hit: hit(e) }; });
        const others = [['SIREN', '#bigTrig'], ['LATCH', '#latchBtn'], ['pad', '#xypad'], ['barra', '#zd-top'], ['tabs', '#zd-tabs'], ['sheet', 'html.zd-sheet-open #zd-sheet']]
          .map(([n, s]) => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width ? { id: n, ...r(e) } : null; })
          .filter(Boolean)
          .concat([...document.querySelectorAll('#throwRow .throwbtn')].map((e, i) => ({ id: ['ECHO THROW', 'FEEDBACK ∞', 'KILL'][i], ...r(e) })));
        return { mine, others, vw: innerWidth, vh: innerHeight };
      });
      const check = (m, minH, label) => {
        const ov = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
        for (const b of m.mine) {
          assert.ok(Math.min(b.w, b.h) >= 44, `${label}: ${b.id} mide ${Math.round(b.w)}×${Math.round(b.h)} (mínimo 44 px)`);
          assert.ok(b.h >= minH, `${label}: ${b.id} mide ${Math.round(b.h)} px de alto (pedido ≥${minH})`);
          assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= m.vw + 0.5 && b.y + b.h <= m.vh + 0.5, `${label}: ${b.id} tiene que entrar en la pantalla`);
          assert.ok(b.hit, `${label}: ${b.id} tapado por otro elemento`);
          const hits = m.others.filter((o) => ov(b, o)).map((o) => o.id);
          assert.deepEqual(hits, [], `${label}: ${b.id} se solapa con ${hits.join(', ')}`);
        }
        assert.ok(!ov(m.mine[0], m.mine[1]), `${label}: MUTE y BURNOUT se solapan`);
      };
      const a = await measure();
      check(a, 56, 'deck');
      const s = a.mine.map((b) => `${b.id.replace('Btn', '')} ${Math.round(b.w)}×${Math.round(b.h)}`).join(' · ');
      await page.evaluate(() => ZD.mobile.open('fx'));
      await page.waitForTimeout(300);
      const p = await measure();
      check(p, 44, 'sheet en peek');
      const sp = p.mine.map((b) => `${Math.round(b.w)}×${Math.round(b.h)}`).join(' · ');
      console.log(`  ${v.width}×${v.height} · ${s} · con el sheet en peek ${sp}`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

// ─────────────────────── 9 · con el mute apagado, igual que antes ─────────────

/* la IR de la reverb y el ruido salen de Math.random: con semilla, las dos versiones arman los mismos */
const SEED = () => { let x = 0x2545f491; Math.random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; };
// eco estable (lazo 0,25 × 2,7 < 1) sin wow, reverb corta: lo que pasa por echoLoop() y el convolver
const FX = { ...PATCH.dry, echo: { time: 0.31, fb: 0.25, tone: 3400, wow: 0, sat: 1.8, mix: 0.5, on: true },
  rev: { mode: 'plate', decay: 1.2, tone: 4200, mix: 0.3, on: true } };

test('9 · con el mute apagado la salida es la misma que antes (RMS del commit base y muestra a muestra)', async () => {
  // settle: hasta que el eco y la reverb llegan a régimen (medir mientras crecen da ±0,2 dB de una corrida a otra)
  const rmsOf = async (path, patch = PATCH.dry, settle = 900) => {
    const { ctx, page, errors } = await open({ width: 1280, height: 860 }, { path, init: SEED });
    try {
      await powerOn(page);
      await setPatch(page, patch);
      await page.evaluate(() => noteOn('pad', 57));
      await page.waitForTimeout(settle);
      const t = await now(page);
      await page.waitForTimeout(1000);
      const lv = await level(page, t, t + 0.9);
      await page.evaluate(() => noteOff('pad'));
      return { lv, errors, page, ctx };
    } catch (e) { await ctx.close(); throw e; }
  };
  const cur = await rmsOf(URL_PATH);
  try {
    // muestra a muestra: lo que sale del compresor contra lo que sale de muteGain
    const exact = await cur.page.evaluate(() => {
      if (typeof muteGain === 'undefined' || !muteGain) return { ok: false, why: 'no hay muteGain' };
      const A = ctx.createAnalyser(), B = ctx.createAnalyser(); A.fftSize = B.fftSize = 4096;
      window.__conn.call(comp, A); window.__conn.call(muteGain, B);
      return new Promise((done) => setTimeout(() => {
        noteOn('pad', 57);
        setTimeout(() => {
          const a = new Float32Array(4096), b = new Float32Array(4096);
          A.getFloatTimeDomainData(a); B.getFloatTimeDomainData(b);
          noteOff('pad');
          let best = Infinity, off = null, peak = 0;
          for (const k of [-256, -128, 0, 128, 256]) {
            let d = 0;
            for (let i = 512; i < 4096 - 512; i++) d = Math.max(d, Math.abs(a[i] - b[i + k]));
            if (d < best) { best = d; off = k; }
          }
          for (const x of a) peak = Math.max(peak, Math.abs(x));
          done({ ok: true, gain: muteGain.gain.value, maxDiff: best, offset: off, peak });
        }, 500);
      }, 100));
    });
    console.log(`  muteGain ${exact.gain} · |compresor − salida| máx ${exact.maxDiff} (desfase ${exact.offset} muestras, pico ${exact.peak && exact.peak.toFixed(3)})`);
    assert.ok(exact.ok, exact.why);
    assert.equal(exact.gain, 1, 'con el mute apagado muteGain vale 1');
    assert.equal(exact.maxDiff, 0, 'con el mute apagado la salida es idéntica, muestra a muestra, a la del compresor');
    assert.ok(exact.peak > 0.05, 'control: la medición muestra a muestra tiene señal');
    assert.deepEqual(cur.errors, []);
  } finally { await cur.ctx.close(); }
  if (!baseHtml) { console.log(`  (sin git o sin la base ${BASE}: se saltea la comparación contra la versión de antes)`); return; }
  const base = await rmsOf(BASE_PATH);
  await base.ctx.close();
  const d = cur.lv.rms - base.lv.rms;
  console.log(`  patch fijo (tono seco) · antes ${base.lv.rms.toFixed(2)} dBFS RMS · ahora ${cur.lv.rms.toFixed(2)} · diferencia ${d.toFixed(3)} dB`);
  assert.ok(Math.abs(d) < 0.1, `mismo RMS que la versión de antes (${d.toFixed(3)} dB)`);
  assert.deepEqual(base.errors, []);
  // con eco y reverb: el lazo del eco ahora lo arma echoLoop() (BURNOUT lo rearma)
  const fxNow = await rmsOf(URL_PATH, FX, 2500); await fxNow.ctx.close();
  const fxBase = await rmsOf(BASE_PATH, FX, 2500); await fxBase.ctx.close();
  const d2 = fxNow.lv.rms - fxBase.lv.rms;
  console.log(`  patch fijo (eco + reverb) · antes ${fxBase.lv.rms.toFixed(2)} dBFS RMS · ahora ${fxNow.lv.rms.toFixed(2)} · diferencia ${d2.toFixed(3)} dB`);
  assert.ok(Math.abs(d2) < 0.1, `mismo RMS que la versión de antes con eco y reverb (${d2.toFixed(3)} dB)`);
  assert.deepEqual([...fxNow.errors, ...fxBase.errors], []);
});
