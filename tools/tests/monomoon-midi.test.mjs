#!/usr/bin/env node
// tools/tests/monomoon-midi.test.mjs
//
// MonoMoon'70 · Web MIDI se pide con un gesto, no al cargar (reports/D2-lighthouse.md:
// `initMIDI()` llamaba a `navigator.requestMIDIAccess()` apenas abría la página,
// Chrome lo marca como API deprecada —Best Practices 77— y puede mostrar el
// pedido de permiso de entrada; reports/E1.md, tarea 9).
//
//   1. al cargar no se llama a requestMIDIAccess(); hay un botón "Conectar MIDI"
//      donde se muestra el estado de MIDI;
//   2. tocar el botón la llama una vez y engancha las entradas ("MIDI 1");
//   3. si el navegador niega el permiso: "MIDI bloqueado" y el botón sigue;
//   4. sin Web MIDI (Safari, iOS): "MIDI no disponible en este navegador", sin botón;
//   5. con el hub C2: "MIDI ← C2", sin botón y sin llamar a requestMIDIAccess().
//
// requestMIDIAccess() se reemplaza por uno falso que cuenta las llamadas.
//
//   node tools/tests/monomoon-midi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';

const URL_PATH = '/descargables/MonoMoon70.html';
const HUB_PATH = '/__test-c2hub-midi.html';
const FAKE_MIDI = (mode) => {
  window.__midiCalls = 0;
  if (mode === 'none') { try { delete Navigator.prototype.requestMIDIAccess; } catch (e) {} return; }
  const inputs = new Map([['in-1', { name: 'Teclado falso', onmidimessage: null }]]);
  Navigator.prototype.requestMIDIAccess = function () {
    window.__midiCalls++;
    return mode === 'deny' ? Promise.reject(new DOMException('denegado', 'NotAllowedError')) : Promise.resolve({ inputs, outputs: new Map(), onstatechange: null });
  };
};
const STATE = () => ({ calls: window.__midiCalls, txt: document.getElementById('midiTxt').textContent,
  dot: document.getElementById('midiDot').classList.contains('on'),
  btn: (() => { const b = document.getElementById('midiBtn'); return b ? { text: b.textContent, disabled: b.disabled } : null; })() });

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, {
    [HUB_PATH]: { body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>hub</title>
<script>window.C2={ apiVersion:1, ctx:new AudioContext({latencyHint:'interactive'}), transport:{bpm:120}, regs:[],
  registerInstrument(api){ this.regs.push(api); const g=this.ctx.createGain(); g.connect(this.ctx.destination); return g; } };</script></head>
<body style="margin:0"><iframe name="c2slot:slotA" src="${URL_PATH}" style="width:400px;height:700px;border:0" title="slot"></iframe></body></html>` },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(mode, path = URL_PATH) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(FAKE_MIDI, mode);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  await page.goto(srv.origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

test('MonoMoon · al cargar no se pide MIDI; el botón "Conectar MIDI" lo pide con el gesto', async () => {
  const { ctx, page, errors } = await open('ok');
  try {
    const a = await page.evaluate(STATE);
    console.log(`  al cargar: ${JSON.stringify(a)}`);
    assert.deepEqual({ calls: a.calls, btn: a.btn && a.btn.text }, { calls: 0, btn: 'Conectar MIDI' }, 'al cargar: cero llamadas y el botón visible');
    await page.click('#powerOvl'); await page.waitForTimeout(500);       // encender el audio no pide MIDI
    assert.equal(await page.evaluate(() => window.__midiCalls), 0, 'encender el audio no pide MIDI');
    await page.click('#midiBtn'); await page.waitForTimeout(300);
    const b = await page.evaluate(STATE);
    console.log(`  tras el botón: ${JSON.stringify(b)}`);
    assert.deepEqual(b, { calls: 1, txt: 'MIDI 1', dot: true, btn: null }, 'una llamada, la entrada enganchada y el botón se va');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · permiso negado: "MIDI bloqueado" y el botón queda para reintentar', async () => {
  const { ctx, page, errors } = await open('deny');
  try {
    await page.click('#powerOvl'); await page.waitForTimeout(500);       // la pantalla de encendido tapa la barra
    await page.click('#midiBtn'); await page.waitForTimeout(300);
    const s = await page.evaluate(STATE);
    console.log(`  negado: ${JSON.stringify(s)}`);
    assert.deepEqual(s, { calls: 1, txt: 'MIDI bloqueado', dot: false, btn: { text: 'Conectar MIDI', disabled: false } });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · sin Web MIDI: "MIDI no disponible en este navegador", sin botón', async () => {
  const { ctx, page, errors } = await open('none');
  try {
    const s = await page.evaluate(STATE);
    console.log(`  sin Web MIDI: ${JSON.stringify(s)}`);
    assert.deepEqual(s, { calls: 0, txt: 'MIDI no disponible en este navegador', dot: false, btn: null });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('MonoMoon · con el hub C2: "MIDI ← C2", sin botón y sin pedir MIDI', async () => {
  const { ctx, page, errors } = await open('ok', HUB_PATH);
  try {
    await page.waitForTimeout(900);
    const f = page.frame({ url: /MonoMoon70/ });
    const s = await f.evaluate(STATE);
    console.log(`  hub C2: ${JSON.stringify(s)}`);
    assert.deepEqual(s, { calls: 0, txt: 'MIDI ← C2', dot: true, btn: null });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
