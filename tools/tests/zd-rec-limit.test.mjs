#!/usr/bin/env node
// tools/tests/zd-rec-limit.test.mjs
//
// Pedido de J4 y MonoMoon (reports/j4-block-request.md punto 1,
// reports/monomoon-block-request.md punto 1): en zd-rec v1, al llegar a
// `maxSec` el bloque llama a `onLimit(max)` y a su propio `stop()`, y tira el
// resultado. Un `stop()` posterior devuelve `null`: si `onLimit` solo avisa,
// la toma de 10 minutos se pierde.
//
// Contrato de v2:
//   - `onLimit(max, result)`: `result` es lo mismo que resuelve `stop()`.
//   - `stop()` con el estado en 'idle' devuelve la última toma que cerró el
//     tope, una sola vez.
//   - Sigue andando el patrón de J4 y MonoMoon: llamar a `rec.stop()` de forma
//     sincrónica dentro de `onLimit` (MonoMoon además mira `rec.state === 'rec'`).
//
// Corre sobre la copia canónica de tools/blocks/ en una página mínima, en las
// dos ramas: AudioWorklet y MediaRecorder (forzada sacándole `audioWorklet` al
// contexto). Con `maxSec: 1`.
//
//   node tools/tests/zd-rec-limit.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';
import { blockPage, blockVersion } from './lib/block-page.mjs';

const V = blockVersion('zd-rec');
const PAGE = '/__zd-rec-test.html';

/* Helpers de la página: un oscilador que suena, el resumen de un resultado
   y esperas. `mode` 'mediarecorder' le saca audioWorklet al contexto, así
   loadTap() da false y el bloque cae a MediaStreamDestination + MediaRecorder. */
const HELPERS = `<script>
window.setup = async function (mode) {
  const c = new AudioContext(); await c.resume();
  if (mode === 'mediarecorder') Object.defineProperty(c, 'audioWorklet', { value: undefined });
  const o = c.createOscillator(); o.frequency.value = 330;
  const g = c.createGain(); g.gain.value = 0.25; o.connect(g); o.start();
  window.__c = c; window.__src = g;
};
window.S = (r) => r ? { keys: Object.keys(r).sort().join(','), dur: +r.duration.toFixed(2), bytes: r.bytes,
  blob: r.blob instanceof Blob && r.blob.size === r.bytes, sampleRate: r.sampleRate, channels: r.channels, mode: r.mode } : r;
window.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
window.until = async (fn, ms) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) return false; await sleep(20); } return true; };
window.make = (onLimit) => ZD.rec.create({ getContext: () => __c, getSource: () => __src, channels: 2, maxSec: 1, onLimit });
</script>`;

const KEYS = 'blob,bytes,channels,duration,mode,sampleRate';
/* duración aceptada: en worklet el corte cae en el primer bloque de 128
   frames que pasa 1 s; MediaRecorder + decode agrega/saca unos ms de codec */
const durOk = (mode, d) => (mode === 'worklet' ? d >= 1 && d < 1.05 : d > 0.8 && d < 1.3);

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, {
    [PAGE]: { body: blockPage({ blocks: ['zd-audio', 'zd-dl', 'zd-rec'], head: HELPERS, title: 'zd-rec test' }) },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(mode) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + PAGE, { waitUntil: 'load' });
  await page.evaluate((m) => window.setup(m), mode);
  return { ctx, page, errors };
}

for (const mode of ['worklet', 'mediarecorder']) {
  test(`zd-rec v${V} · ${mode} · onLimit solo avisa y después el usuario toca ■: obtiene la toma`, async () => {
    const { ctx, page, errors } = await open(mode);
    try {
      const out = await page.evaluate(async () => {
        const calls = [];
        const rec = make((max, res) => { calls.push({ max, state: rec.state, res: S(res) }); window.__fromLimit = res; });
        const mode = await rec.start();
        await until(() => calls.length, 5000);
        await sleep(250);                         // el usuario toca ■ un rato después
        const stateBefore = rec.state;
        const r1 = await rec.stop();
        const r2 = await rec.stop();              // una sola vez
        return { mode, calls, stateBefore, r1: S(r1), same: !!r1 && r1 === window.__fromLimit, r2: S(r2) };
      });
      console.log(`  ${mode}: onLimit ×${out.calls.length} ${JSON.stringify(out.calls[0] || null)} · stop() después del tope → ${JSON.stringify(out.r1)} · 2º stop() → ${out.r2}`);
      assert.equal(out.mode, mode, `la rama tiene que ser ${mode}`);
      const got = {
        onLimitCalls: out.calls.length,
        onLimitMax: out.calls[0] && out.calls[0].max,
        onLimitResult: !!(out.calls[0] && out.calls[0].res),
        stateBeforeStop: out.stateBefore,
        stopAfterLimit: out.r1 ? 'toma' : out.r1,
        sameObject: out.same,
        secondStop: out.r2,
      };
      assert.deepEqual(got, {
        onLimitCalls: 1, onLimitMax: 1, onLimitResult: true, stateBeforeStop: 'idle',
        stopAfterLimit: 'toma', sameObject: true, secondStop: null,
      }, 'al llegar al tope la toma tiene que llegar a onLimit y al próximo stop()');
      assert.equal(out.calls[0].res.keys, KEYS, 'onLimit recibe la misma forma que resuelve stop()');
      assert.ok(out.r1.blob && out.r1.channels === 2 && out.r1.mode === mode, JSON.stringify(out.r1));
      assert.ok(durOk(mode, out.r1.dur), `duración ${out.r1.dur} s con maxSec 1`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`zd-rec v${V} · ${mode} · onLimit llama a stop() (patrón J4/MonoMoon): obtiene la toma`, async () => {
    const { ctx, page, errors } = await open(mode);
    try {
      const out = await page.evaluate(async () => {
        const calls = [];
        let pending = null;
        const rec = make((max, res) => {
          calls.push({ max, state: rec.state, res: S(res) });
          window.__fromLimit = res;
          if (rec.state !== 'rec') return;        // guard de MonoMoon (stopTake)
          pending = rec.stop();                   // sincrónico, antes de cualquier await
        });
        await rec.start();
        await until(() => calls.length, 5000);
        const r = pending ? await pending : 'stop() no se llamó';
        await sleep(100);
        const after = await rec.stop();
        return { calls, r: typeof r === 'string' ? r : S(r), same: !!r && r === window.__fromLimit, state: rec.state, after: S(after) };
      });
      console.log(`  ${mode}: onLimit con state="${out.calls[0] && out.calls[0].state}" · stop() adentro de onLimit → ${JSON.stringify(out.r)} · stop() después → ${out.after}`);
      const got = {
        onLimitCalls: out.calls.length,
        stateInOnLimit: out.calls[0] && out.calls[0].state,
        stopInOnLimit: out.r && typeof out.r === 'object' ? 'toma' : out.r,
        onLimitResult: !!(out.calls[0] && out.calls[0].res),
        sameObject: out.same,
        stateAfter: out.state,
        stopAfter: out.after,
      };
      assert.deepEqual(got, {
        onLimitCalls: 1, stateInOnLimit: 'rec', stopInOnLimit: 'toma', onLimitResult: true,
        sameObject: true, stateAfter: 'idle', stopAfter: null,
      }, 'el stop() de adentro de onLimit se queda con la toma, y es la misma que recibe onLimit');
      assert.ok(durOk(mode, out.r.dur), `duración ${out.r.dur} s con maxSec 1`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

test(`zd-rec v${V} · worklet · sin tope: stop() normal, y start() después del tope descarta la toma vieja`, async () => {
  const { ctx, page, errors } = await open('worklet');
  try {
    const out = await page.evaluate(async () => {
      const rec = make(() => {});
      await rec.start(); await sleep(400);
      const a = S(await rec.stop()), a2 = await rec.stop();
      // el tope cierra una toma que nadie pide; start() la tiene que soltar
      await rec.start(); await until(() => rec.state === 'idle', 5000);
      await rec.start(); await sleep(300);
      const b = S(await rec.stop()), b2 = await rec.stop();
      // cancel() también suelta la toma que dejó el tope
      await rec.start(); await until(() => rec.state === 'idle', 5000);
      rec.cancel();
      const c = await rec.stop();
      return { a, a2, b, b2, c };
    });
    assert.ok(out.a && out.a.dur > 0.3 && out.a.dur < 0.6, `toma normal de ~0,4 s: ${JSON.stringify(out.a)}`);
    assert.equal(out.a2, null, 'un segundo stop() sin tope sigue dando null');
    assert.ok(out.b && out.b.dur > 0.2 && out.b.dur < 0.5, `la toma nueva (~0,3 s), no la vieja de 1 s: ${JSON.stringify(out.b)}`);
    assert.equal(out.b2, null);
    assert.equal(out.c, null, 'cancel() descarta la toma que dejó el tope');
    console.log(`  normal ${out.a.dur} s · después del tope + start(): ${out.b.dur} s · cancel() suelta la toma del tope`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test(`zd-rec v${V} · mediarecorder · el temporizador del tope de una toma vieja no corta la siguiente`, async () => {
  const { ctx, page, errors } = await open('mediarecorder');
  try {
    const out = await page.evaluate(async () => {
      let limits = 0;
      const rec = make(() => { limits++; });
      await rec.start(); await sleep(500);
      await rec.stop();                           // 0,5 s: cerrada a mano
      await rec.start();                          // la segunda arranca en t≈0,5 s
      await sleep(750);                           // t≈1,25 s: el timer viejo (t=1 s) ya habría saltado
      const mid = { state: rec.state, limits };
      await until(() => rec.state === 'idle', 5000);
      const r = S(await rec.stop());
      return { mid, limits, r };
    });
    console.log(`  a los 0,75 s de la 2ª toma: state=${out.mid.state}, onLimit ×${out.mid.limits} · cerrada por su propio tope: ${JSON.stringify(out.r)}`);
    assert.deepEqual(out.mid, { state: 'rec', limits: 0 }, 'la 2ª toma no puede cortarse con el temporizador de la 1ª');
    assert.equal(out.limits, 1);
    assert.ok(out.r && durOk('mediarecorder', out.r.dur), JSON.stringify(out.r));
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
