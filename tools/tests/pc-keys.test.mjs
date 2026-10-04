#!/usr/bin/env node
// tools/tests/pc-keys.test.mjs
//
// Los atajos globales del teclado de PC no le roban teclas a los controles
// (reports/D1-barrido.md, b; reports/E1.md, tarea 3). El contrato es el de
// MonoMoon (`pcKeysOff`):
//
//   - ningún atajo si el evento ya lo usó otro handler (`defaultPrevented`: un
//     knob con Espacio abre su entrada numérica), si el foco está en un campo
//     editable (input, select, textarea, contenteditable) o si hay un modal
//     abierto (`.zd-scrim`), tenga o no el foco;
//   - Espacio, Enter y flechas sobre un control (button, a, [role=button|slider|
//     switch|tab], input) son de ese control;
//   - lo demás no cambia: con el foco en la página, las letras tocan y Espacio
//     hace lo de siempre (play/stop o SIREN; en MonoMoon, panic, que no se mide).
//
// Por instrumento, 1280×860 con teclado. Se cuentan las notas que dispara el
// teclado de PC (Acid Engine.triggerAmp · CronBeat trigger() · Nebularp start()
// de una voz · MonoMoon engine.noteOn · J4 noteOn) y se mira el transporte.
//
//   node tools/tests/pc-keys.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const INIT = () => {
  window.__notes = 0;
  const st = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (when) { if (window.__startIsNote && when > 0) window.__notes++; return st.apply(this, arguments); };
};
/* Por instrumento: cómo arrancar el audio, contar notas y leer el transporte.
   `keys` son teclas que el instrumento usa como notas u octava. */
const INST = {
  Acid: { file: 'Acid_Bass-303.html', knob: '[role=slider]', button: '#kbOctUp', keys: 'asdfzx',
    start: async () => { await Engine.ensure(); const f = Engine.triggerAmp.bind(Engine); Engine.triggerAmp = (...a) => { window.__notes++; return f(...a); }; },
    transport: () => Seq.playing, other: () => document.getElementById('kbOctVal').textContent },
  CronBeat: { file: 'CronBeat-808.html', knob: 'input[type=range]', button: '#patbtns .patbtn', keys: 'asdfqwer',
    start: () => { ensureAudio(); const f = window.trigger; window.trigger = function (...a) { window.__notes++; return f.apply(this, a); }; },
    transport: () => isPlaying, other: () => tempo },
  Nebularp: { file: 'Nebularp_2035.html', knob: '[role=slider]', button: '#latch', keys: 'asdfzx', tab: true,
    start: () => { window.__startIsNote = true; },
    transport: () => document.getElementById('play').getAttribute('aria-pressed') === 'true', other: () => null },
  MonoMoon: { file: 'MonoMoon70.html', knob: '[role=slider]', button: '.octave-ctl button', keys: 'asdfzx', power: '#powerOvl',
    start: () => { const f = engine.noteOn.bind(engine); engine.noteOn = (...a) => { window.__notes++; return f(...a); }; },
    transport: () => null, other: () => null },
  J4: { file: 'J4-Sirens_Station.html', knob: '[role=slider]', button: '#latchBtn', keys: 'zsxd148', power: '#power', tab: true,
    start: () => { const f = window.noteOn; window.noteOn = function (...a) { window.__notes++; return f.apply(this, a); }; },
    transport: () => held.length > 0, other: () => null },
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

const snap = (page, I) => page.evaluate(({ t, o }) => ({ notes: window.__notes, transport: eval(t)(), other: eval(o)() }),
  { t: `(${I.transport})`, o: `(${I.other})` });
const gone = (page) => page.waitForFunction(() => !document.querySelector('.zd-scrim'), null, { timeout: 3000 });

async function open(name) {
  const I = INST[name];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  await page.goto(`${srv.origin}/descargables/${I.file}`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  if (I.power && await page.isVisible(I.power)) { await page.click(I.power); await page.waitForTimeout(700); }
  await page.evaluate(`(${I.start})()`);
  await page.waitForTimeout(300);
  return { I, ctx, page, errors };
}
/* foco "de teclado" en un control: un Tab antes (Nebularp y J4 distinguen el foco
   puesto con el teclado del puesto con el mouse) */
async function focusCtl(page, sel) {
  await page.keyboard.press('Tab');
  await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); el.focus(); }, sel);
}

for (const name of Object.keys(INST)) {
  test(`${name} · los atajos no le roban teclas a los controles ni a un modal`, async () => {
    const { I, ctx, page, errors } = await open(name);
    try {
      const out = {};
      // 1 · Espacio sobre un knob / slider
      let a = await snap(page, I);
      await focusCtl(page, I.knob);
      await page.keyboard.press('Space'); await page.waitForTimeout(250);
      let b = await snap(page, I);
      out.espacioEnKnob = { transporte: b.transport !== a.transport, notas: b.notes - a.notes };
      await page.keyboard.press('Escape'); await page.waitForTimeout(250); await gone(page);
      if (b.transport !== a.transport) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Space'); await page.waitForTimeout(250); }
      // 2 · Espacio y flechas sobre un botón
      a = await snap(page, I);
      await focusCtl(page, I.button);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space'); await page.waitForTimeout(250);
      b = await snap(page, I);
      out.espacioYFlechasEnBoton = { transporte: b.transport !== a.transport, otro: b.other !== a.other && name === 'CronBeat', notas: b.notes - a.notes };
      if (b.transport !== a.transport) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Space'); await page.waitForTimeout(250); }
      // 3 · tipear en un prompt
      a = await snap(page, I);
      const p = page.evaluate(() => ZD.modal.prompt('Nombre', { value: '' }));
      await page.waitForFunction(() => document.activeElement && document.activeElement.matches('.zd-dlg input'));
      await page.keyboard.type(I.keys + ' '); await page.waitForTimeout(250);
      const typed = await page.evaluate(() => document.activeElement.value);
      // 4 · con el modal abierto pero el foco afuera
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.type(I.keys); await page.keyboard.press('Space'); await page.waitForTimeout(250);
      b = await snap(page, I);
      out.tipearConModal = { recibe: typed === I.keys + ' ', transporte: b.transport !== a.transport, otro: b.other !== a.other, notas: b.notes - a.notes };
      await page.evaluate(() => document.querySelector('.zd-dlg .zd-dact button').click()); await p; await gone(page);
      if (b.transport !== a.transport) { await page.keyboard.press('Space'); await page.waitForTimeout(250); }
      // 5 · control: con el foco en la página, las letras tocan
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      a = await snap(page, I);
      await page.keyboard.down(I.keys[0]); await page.waitForTimeout(200); await page.keyboard.up(I.keys[0]); await page.waitForTimeout(250);
      b = await snap(page, I);
      out.letraEnLaPagina = { notas: b.notes - a.notes > 0 };
      // ...y Espacio hace lo de siempre (play/stop; en J4, SIREN mientras se mantiene)
      if (a.transport !== null) {
        await page.keyboard.down('Space'); await page.waitForTimeout(250);
        const c = await snap(page, I);
        await page.keyboard.up('Space'); await page.waitForTimeout(150);
        if (name !== 'J4') { await page.keyboard.press('Space'); await page.waitForTimeout(250); }
        out.espacioEnLaPagina = { transporte: c.transport !== a.transport };
      }
      console.log(`  ${name}: ${JSON.stringify(out)}`);
      assert.deepEqual(out, {
        espacioEnKnob: { transporte: false, notas: 0 },
        espacioYFlechasEnBoton: { transporte: false, otro: false, notas: 0 },
        tipearConModal: { recibe: true, transporte: false, otro: false, notas: 0 },
        letraEnLaPagina: { notas: true },
        ...(name === 'MonoMoon' ? {} : { espacioEnLaPagina: { transporte: true } }),
      }, 'ningún atajo con un control enfocado o un modal abierto; con el foco en la página, las letras tocan');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}
