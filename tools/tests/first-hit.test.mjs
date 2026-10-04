#!/usr/bin/env node
// tools/tests/first-hit.test.mjs
//
// Primer golpe con el audio sin destrabar o suspendido (reports/D1-barrido.md,
// c; reports/E1.md, tarea 2). En iOS el destrabe real ocurre recién en
// pointerup/touchend: lo que un instrumento programe en el pointerdown cae en un
// contexto suspendido, con el reloj congelado, y sale tarde, en ráfaga o
// mudo (note-on y note-off sobre el mismo instante). Contrato:
//
//   - con el contexto que no está en 'running', el pointerdown no programa nada:
//     el golpe se dispara apenas el contexto pasa a 'running' (al levantar el
//     dedo, por ZD.audio.bindGesture);
//   - con el contexto corriendo (o con el hub C2) nada cambia: el golpe sale en
//     el mismo pointerdown.
//
// Chromium headless arranca todo AudioContext en 'running', así que la regla
// de iOS se EMULA: el contexto nace suspendido si no hay activación transitoria
// (≤1 s desde el último pointerup táctil, touchend, click, keydown o mousedown;
// un pointerdown táctil no cuenta), resume() sin activación queda pendiente y
// suspend() vuelve a pedir activación. Es una emulación: iOS se verifica en un
// iPhone (docs/QA-dispositivos.md).
//
// "Golpe" por instrumento: CronBeat trigger() · Nebularp start() de una voz
// (oscilador agendado a futuro; las fuentes continuas arrancan en 0) ·
// MonoMoon engine.noteOn() · J4 noteOn(). Cada golpe se anota con el estado
// del contexto y si llegó antes o después del pointerup.
//
//   node tools/tests/first-hit.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const EMULATE = () => {
  window.__acs = []; window.__hits = []; window.__phase = 'idle';
  let act = -1e9;
  const grant = () => { act = performance.now(); };
  for (const ev of ['touchend', 'click', 'keydown', 'mousedown']) window.addEventListener(ev, grant, true);
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') grant(); window.__phase = 'up'; }, true);
  window.addEventListener('pointerdown', () => { window.__phase = 'down'; }, true);
  const active = () => performance.now() - act < 1000;
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); window.__acs.push(this); this.__pend = []; if (!active()) this.__block(); }
    __block() { this.__blocked = true; AC.prototype.suspend.call(this); }
    get state() { return this.__blocked ? 'suspended' : super.state; }
    suspend() { this.__blocked = true; return AC.prototype.suspend.call(this); }
    resume() {
      if (!this.__blocked) return AC.prototype.resume.call(this);
      if (!active()) return new Promise((ok) => this.__pend.push(ok));
      this.__blocked = false;
      return AC.prototype.resume.call(this).then((x) => { this.__pend.splice(0).forEach((f) => f()); return x; });
    }
  };
  window.webkitAudioContext = window.AudioContext;
  window.__ctxState = () => { const c = window.__acs[window.__acs.length - 1]; return c ? c.state : 'null'; };
  window.__hit = (what) => window.__hits.push({ what, st: window.__ctxState(), phase: window.__phase });
  // Nebularp vive en un IIFE: su golpe se ve como start() de una voz agendada a futuro
  const st = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (when) {
    if (window.__startIsHit && when > 0) window.__hit('voz');
    return st.apply(this, arguments);
  };
};

const INST = {
  CronBeat: { file: 'CronBeat-808.html', surface: '.bigpad[data-track="0"]',
    hook: () => { const f = window.trigger; window.trigger = function (...a) { window.__hit('trigger'); return f.apply(this, a); }; },
    held: () => 0 },
  Nebularp: { file: 'Nebularp_2035.html', surface: '.piano',
    hook: () => { window.__startIsHit = true; },
    held: () => document.querySelectorAll('.pkey.active').length },
  MonoMoon: { file: 'MonoMoon70.html', surface: '#keys .key', power: '#powerOvl',
    hook: () => { const f = engine.noteOn.bind(engine); engine.noteOn = (...a) => { window.__hit('noteOn'); return f(...a); }; },
    held: () => kbd.sources.size + noteCount.size },
  J4: { file: 'J4-Sirens_Station.html', surface: '#bigTrig', power: '#power',
    hook: () => { const f = window.noteOn; window.noteOn = function (...a) { window.__hit('noteOn'); return f.apply(this, a); }; },
    held: () => held.length },
};

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT);
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(name) {
  const I = INST[name];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(EMULATE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${srv.origin}/descargables/${I.file}`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(I.hook);
  return { I, ctx, page, errors };
}
const hits = (page) => page.evaluate(() => window.__hits.splice(0));
const fmt = (h) => h.map((x) => `${x.what}@${x.st}/${x.phase}`).join(' ') || '(ninguno)';
async function powerOn(page, I) {
  if (I.power && await page.isVisible(I.power)) { await page.tap(I.power); await page.waitForTimeout(800); }
  else { await page.tap(I.surface); await page.waitForTimeout(800); }
  await hits(page);
  assert.equal(await page.evaluate(() => window.__ctxState()), 'running', 'tras el primer gesto el contexto tiene que quedar en running');
}

/* sin golpes programados con el contexto suspendido, y el golpe no se pierde */
function assertDeferred(h, label) {
  assert.deepEqual(h.filter((x) => x.st !== 'running').map((x) => `${x.what}@${x.st}/${x.phase}`), [],
    `${label}: no puede programar golpes con el contexto suspendido`);
  assert.ok(h.length >= 1, `${label}: el golpe se perdió (no sonó al destrabar)`);
  assert.ok(h.every((x) => x.phase === 'up'), `${label}: el golpe tiene que salir al levantar el dedo: ${fmt(h)}`);
}

for (const name of ['CronBeat', 'Nebularp']) {
  test(`${name} · primer toque sin audio destrabado: el golpe espera al destrabe (iOS emulado)`, async () => {
    const { I, ctx, page, errors } = await open(name);
    try {
      assert.equal(await page.evaluate(() => window.__acs.length), 0, 'al cargar no hay contexto');
      await page.tap(I.surface);
      await page.waitForTimeout(700);
      const h = await hits(page);
      console.log(`  ${name} · primer tap: ${fmt(h)} · contexto ${await page.evaluate(() => window.__ctxState())}`);
      assertDeferred(h, name);
      assert.equal(await page.evaluate(I.held), 0, 'después de soltar no queda nada sostenido');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

for (const name of ['CronBeat', 'Nebularp', 'MonoMoon', 'J4']) {
  test(`${name} · contexto suspendido después de andar: el golpe espera al destrabe (iOS emulado)`, async () => {
    const { I, ctx, page, errors } = await open(name);
    try {
      await powerOn(page, I);
      await page.evaluate(() => window.__acs[window.__acs.length - 1].suspend());
      await page.waitForTimeout(300);
      await page.tap(I.surface);
      await page.waitForTimeout(800);
      const h = await hits(page);
      console.log(`  ${name} · suspendido → tap: ${fmt(h)} · contexto ${await page.evaluate(() => window.__ctxState())}`);
      assertDeferred(h, name);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(I.held), 0, 'después de soltar no queda nada sostenido');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`${name} · con el contexto corriendo no cambia nada: el golpe sale en el pointerdown`, async () => {
    const { I, ctx, page, errors } = await open(name);
    try {
      await powerOn(page, I);
      await page.tap(I.surface);
      await page.waitForTimeout(600);
      const h = await hits(page);
      console.log(`  ${name} · corriendo → tap: ${fmt(h)}`);
      assert.ok(h.length >= 1, 'el golpe tiene que sonar');
      assert.equal(h[0].phase, 'down', `el primer golpe sale en el pointerdown, antes de soltar: ${fmt(h)}`);
      assert.ok(h.every((x) => x.st === 'running'));
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(I.held), 0, 'después de soltar no queda nada sostenido');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

for (const name of ['MonoMoon', 'J4']) {
  test(`${name} · la pantalla de encendido toma el primer toque (puerta)`, async () => {
    const { I, ctx, page, errors } = await open(name);
    try {
      const top = await page.evaluate(({ surface, power }) => {
        const r = document.querySelector(surface).getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!(el && el.closest(power));
      }, { surface: I.surface, power: I.power });
      assert.equal(top, true, `al cargar, ${I.power} tapa ${I.surface}`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}
