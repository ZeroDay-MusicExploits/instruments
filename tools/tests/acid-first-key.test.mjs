#!/usr/bin/env node
// tools/tests/acid-first-key.test.mjs
//
// Acid Bass-303 · el primer toque de una tecla no puede dejar una nota colgada
// (reports/D1-barrido.md, c). `keyDownSemi()` espera a `ZD.audio.unlock()`, que
// arranca el motor (carga del AudioWorklet). Si la tecla se suelta antes de que
// termine, `keyUpSemi()` no encuentra nada que soltar y la nota arranca después,
// sin que nadie la cierre: queda sonando y la tecla queda marcada.
//
// Detrás hay un segundo problema: `Engine.ensure()` no tenía guard de
// concurrencia. El primer gesto llama a ensure() varias veces (el pointerdown de
// la tecla, y el pointerup/click/keydown de `ZD.audio.bindGesture`) mientras
// carga el worklet, y cada llamada armaba OTRO AudioContext con su grafo: 4 con
// un tap en una tecla, 3 con el primer clic en PLAY, 2 con una tecla de PC. La
// nota colgada quedaba en uno de los huérfanos, fuera del alcance de
// `Engine.vca`.
//
// La carga del worklet se demora 150 ms (`addModule` envuelto) para que la
// carrera sea la de un teléfono lento y no dependa de la máquina. Se cuentan los
// AudioContext que crea la página y se miden la ganancia del VCA y el nivel de
// la salida (Engine.analyser) un rato después de soltar.
//
//   1. tap táctil en una tecla, primer gesto de la página (390×844);
//   2. lo mismo con el teclado de PC (tecla A, 1280×860);
//   3. primer clic en PLAY: un solo AudioContext;
//   4. con el motor ya andando nada cambia: mantener una tecla sostiene la nota
//      y soltarla la apaga.
//
//   node tools/tests/acid-first-key.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const URL_PATH = '/descargables/Acid_Bass-303.html';
const SLOW_WORKLET = () => {
  window.__acs = [];
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__acs.push(this); } };
  window.webkitAudioContext = window.AudioContext;
  const add = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function (...a) {
    return new Promise((ok) => setTimeout(ok, 150)).then(() => add.apply(this, a));
  };
};
/* Estado del motor: ganancia del VCA, RMS de la salida, tecla marcada, nota activa */
const STATE = () => {
  const out = { contexts: window.__acs.length, started: Engine.started, activeSemi, down: document.querySelectorAll('#keyboard .key.down').length };
  if (Engine.started) {
    out.vca = +Engine.vca.gain.value.toFixed(4);
    const b = new Float32Array(Engine.analyser.fftSize); Engine.analyser.getFloatTimeDomainData(b);
    out.rms = +Math.sqrt(b.reduce((a, x) => a + x * x, 0) / b.length).toFixed(4);
  }
  return out;
};

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

async function open(viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(SLOW_WORKLET);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__amp = []; const on = Engine.triggerAmp.bind(Engine), off = Engine.releaseAmp.bind(Engine);
    Engine.triggerAmp = (...a) => { window.__amp.push('on'); return on(...a); };
    Engine.releaseAmp = (...a) => { window.__amp.push('off'); return off(...a); }; });
  return { ctx, page, errors };
}

test('Acid · primer toque táctil en una tecla: al soltar no queda ninguna voz sonando', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, true);
  try {
    await page.evaluate(() => ZD.mobile.open('seq'));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Engine.started), false, 'antes del toque el motor no arrancó');
    await page.tap('#keyboard .key.white');
    await page.waitForTimeout(1200);
    const s = await page.evaluate(STATE);
    const amp = await page.evaluate(() => window.__amp);
    console.log(`  tap → AudioContext creados ${s.contexts} · VCA ${s.vca} · RMS salida ${s.rms} · activeSemi=${s.activeSemi} · teclas .down=${s.down} · envolvente ${amp.join(' ')}`);
    assert.deepEqual({ contexts: s.contexts, activeSemi: s.activeSemi, down: s.down, colgada: s.vca > 0.01 || s.rms > 0.01 },
      { contexts: 1, activeSemi: null, down: 0, colgada: false }, 'después de soltar: un solo contexto, sin nota activa, sin tecla marcada y el VCA cerrado');
    assert.ok(amp.includes('on'), 'el toque igual suena (nota corta)');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Acid · primera tecla del teclado de PC (A): al soltar no queda ninguna voz sonando', async () => {
  const { ctx, page, errors } = await open({ width: 1280, height: 860 }, false);
  try {
    await page.keyboard.press('a');
    await page.waitForTimeout(1200);
    const s = await page.evaluate(STATE);
    const amp = await page.evaluate(() => window.__amp);
    console.log(`  A → AudioContext creados ${s.contexts} · VCA ${s.vca} · RMS salida ${s.rms} · activeSemi=${s.activeSemi} · teclas .down=${s.down} · envolvente ${amp.join(' ')}`);
    assert.deepEqual({ contexts: s.contexts, activeSemi: s.activeSemi, down: s.down, colgada: s.vca > 0.01 || s.rms > 0.01 },
      { contexts: 1, activeSemi: null, down: 0, colgada: false });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Acid · el primer clic en PLAY arma un solo AudioContext', async () => {
  const { ctx, page, errors } = await open({ width: 1280, height: 860 }, false);
  try {
    await page.click('#playBtn');
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ contexts: window.__acs.length, playing: Seq.playing, same: Engine.ctx === window.__acs[0] }));
    console.log(`  PLAY → AudioContext creados ${s.contexts} · sonando ${s.playing}`);
    assert.deepEqual(s, { contexts: 1, playing: true, same: true });
    await page.click('#playBtn');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Acid · con el motor andando no cambia nada: mantener sostiene, soltar apaga', async () => {
  const { ctx, page, errors } = await open({ width: 1280, height: 860 }, false);
  try {
    await page.evaluate(() => Engine.ensure());
    await page.waitForTimeout(300);
    const key = page.locator('#keyboard .key.white').nth(2);
    await key.scrollIntoViewIfNeeded();
    const box = await key.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.waitForTimeout(500);
    const held = await page.evaluate(STATE);
    await page.mouse.up();
    await page.waitForTimeout(1000);
    const after = await page.evaluate(STATE);
    console.log(`  sostenida 500 ms: VCA ${held.vca}, RMS ${held.rms}, .down=${held.down} · soltada: VCA ${after.vca}, RMS ${after.rms}`);
    assert.ok(held.vca > 0.3 && held.down === 1 && held.activeSemi !== null, `mientras se mantiene, la nota sostiene: ${JSON.stringify(held)}`);
    assert.ok(after.vca < 0.01 && after.down === 0 && after.activeSemi === null, `al soltar se apaga: ${JSON.stringify(after)}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
