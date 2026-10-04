#!/usr/bin/env node
// tools/tests/zd-rec-instruments.test.mjs
//
// El tope de REC en los tres instrumentos que graban en vivo (Nebularp, J4 y
// MonoMoon), con `maxSec` forzado a 1 s: la toma no se pierde y el flujo de la
// UI termina bien. Acompaña a zd-rec-limit.test.mjs (que prueba el bloque
// solo): acá se prueba el instrumento publicado tal cual, con el bloque que
// tenga pegado y el cableado propio de cada uno (los tres llaman a su stop()
// desde onLimit; MonoMoon además mira `rec.state === 'rec'`).
//
// Por instrumento y por rama (AudioWorklet y MediaRecorder):
//   1. encender, tocar REC en la barra del shell (390×844);
//   2. el tope corta solo a 1 s: el botón vuelve a "REC", aparece la tarjeta
//      con ~1 s, sale el aviso del tope y el recorder queda en 'idle';
//   3. una segunda toma normal (REC → ■) anda: la UI no quedó trabada.
//
// `maxSec` se fuerza con un addInitScript que envuelve ZD.rec.create antes de
// que cargue el bloque (Nebularp crea su recorder al cargar). La rama
// MediaRecorder se fuerza haciendo fallar `new AudioWorkletNode(…, 'zd-rec-tap')`.
//
//   node tools/tests/zd-rec-instruments.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT, extractBlock } from './lib/load-block.mjs';

const INSTRUMENTS = [
  { name: 'Nebularp', file: 'descargables/Nebularp_2035.html', power: null, rec: '#recBtn' },
  { name: 'J4', file: 'descargables/J4-Sirens_Station.html', power: '#power', rec: '#recBtn' },
  { name: 'MonoMoon', file: 'descargables/MonoMoon70.html', power: '#powerOvl', rec: '#btnRec' },
];

const INIT = ({ maxSec, forceMR }) => {
  window.__recs = [];
  if (forceMR && window.AudioWorkletNode) {
    const AWN = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends AWN {
      constructor(c, name, o) { if (name === 'zd-rec-tap') throw new Error('test: sin worklet de captura'); super(c, name, o); }
    };
  }
  const ZD = window.ZD || (window.ZD = {});
  let rec;
  Object.defineProperty(ZD, 'rec', {
    configurable: true, enumerable: true,
    get: () => rec,
    set(v) {
      const create = v.create;
      v.create = (cfg) => { const r = create(Object.assign({}, cfg, { maxSec })); window.__recs.push(r); return r; };
      rec = v;
    },
  });
};

const snap = (page, rec) => page.evaluate((sel) => {
  const b = document.querySelector(sel);
  const r = window.__recs[window.__recs.length - 1];
  const meta = document.querySelector('.zd-reccard .zd-rcmeta');
  return {
    pressed: b && b.getAttribute('aria-pressed'),
    disabled: !!(b && b.disabled),
    label: b && b.textContent.replace(/\s+/g, ' ').trim(),
    state: r ? r.state : null, mode: r ? r.mode : null,
    cards: document.querySelectorAll('.zd-reccard').length,
    dur: meta ? meta.querySelector('b').textContent : null,
    meta: meta ? meta.textContent : null,
    toasts: Array.from(document.querySelectorAll('.zd-toast .zd-tmsg')).map((t) => t.textContent),
  };
}, rec);
const secs = (t) => { const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : NaN; };

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

for (const inst of INSTRUMENTS) {
  const v = extractBlock(readFileSync(join(ROOT, inst.file), 'utf8'), 'zd-rec').version;
  for (const mode of ['worklet', 'mediarecorder']) {
    test(`${inst.name} (zd-rec v${v}) · ${mode} · tope forzado a 1 s: la toma no se pierde y la UI vuelve a REC`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await ctx.addInitScript(INIT, { maxSec: 1, forceMR: mode === 'mediarecorder' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e));
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      try {
        await page.goto(srv.origin + '/' + inst.file, { waitUntil: 'load' });
        await page.waitForTimeout(300);
        if (inst.power && await page.isVisible(inst.power)) { await page.tap(inst.power); await page.waitForTimeout(600); }
        assert.equal(await page.evaluate(() => !!(window.ZD && ZD.mobile && ZD.mobile.active)), true, 'el shell tiene que estar activo');

        // 1 · REC desde la barra superior
        await page.tap(inst.rec);
        await page.waitForFunction((s) => document.querySelector(s).getAttribute('aria-pressed') === 'true', inst.rec, { timeout: 5000 });
        // 2 · el tope corta solo
        await page.waitForFunction((s) => document.querySelector(s).getAttribute('aria-pressed') === 'false' && document.querySelector('.zd-reccard'), inst.rec, { timeout: 8000 })
          .catch(() => {});
        const a = await snap(page, inst.rec);
        console.log(`  ${inst.name} · ${mode}: tope → botón "${a.label}" (aria-pressed=${a.pressed}) · recorder ${a.state}/${a.mode} · tarjeta "${a.meta}" · avisos ${JSON.stringify(a.toasts)}`);
        assert.equal(a.mode, mode, `la rama tiene que ser ${mode}`);
        assert.deepEqual(
          { pressed: a.pressed, disabled: a.disabled, state: a.state, cards: a.cards, aviso: a.toasts.some((t) => /tope de 10 minutos/.test(t)) },
          { pressed: 'false', disabled: false, state: 'idle', cards: 1, aviso: true },
          'al llegar al tope: botón en REC, recorder en idle, una tarjeta con la toma y el aviso');
        const d = secs(a.dur);
        assert.ok(mode === 'worklet' ? d >= 1 && d < 1.1 : d > 0.8 && d < 1.3, `la tarjeta tiene que mostrar ~1 s, muestra ${a.dur}`);

        // 3 · otra toma, cortada a mano: la UI no quedó trabada
        await page.evaluate(() => { if (window.ZD && ZD.mobile) ZD.mobile.close(); });
        await page.waitForTimeout(250);
        await page.tap(inst.rec);
        await page.waitForFunction((s) => document.querySelector(s).getAttribute('aria-pressed') === 'true', inst.rec, { timeout: 5000 });
        await page.waitForTimeout(400);
        await page.tap(inst.rec);
        await page.waitForFunction((s) => document.querySelector(s).getAttribute('aria-pressed') === 'false' && !document.querySelector(s).disabled, inst.rec, { timeout: 5000 });
        await page.waitForTimeout(300);
        const b = await snap(page, inst.rec);
        const d2 = secs(b.dur);
        console.log(`  ${inst.name} · ${mode}: 2ª toma a mano → "${b.meta}" · recorder ${b.state}`);
        assert.equal(b.state, 'idle');
        assert.equal(b.cards, 1, 'la tarjeta nueva reemplaza a la anterior');
        assert.ok(d2 > 0.2 && d2 < 0.9, `la 2ª toma (~0,4 s), no la del tope: ${b.dur}`);
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    });
  }
}
