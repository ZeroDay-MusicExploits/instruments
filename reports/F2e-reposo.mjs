#!/usr/bin/env node
// reports/F2e-reposo.mjs — dónde y por qué aparece el escalón de −111,7 dB en el
// release de J4 (j4-reposo 2 «dry», intermitente). No es un test.
//
// Una sonda (GainNode alimentado con 1) recibe las mismas llamadas de
// automatización que vca.gain, y se graba muestra a muestra desde antes del
// noteOff hasta después del 0. Por cada release se mide:
//   · en qué frame empieza a caer la envolvente, contra el frame de
//     ctx.currentTime en el momento del noteOff (lo que usa ampGate como t);
//   · el valor de la envolvente justo antes de la rodilla (tk, donde la
//     exponencial pasa a la recta), contra REL_KNEE = 1e-4;
//   · el mayor escalón (lo mismo que mide j4-reposo 2).
// Patch «dry» de j4-reposo (sus 0,85, rel 340 ms → τ 113 ms), varias notas por página.
//
//   node reports/F2e-reposo.mjs                 # 4 páginas × 12 releases (~2 min)
//   DUMP=1 node reports/F2e-reposo.mjs          # además, las muestras alrededor de la rodilla
//   node reports/F2e-reposo.mjs --pages 8 --notes 12
//   node reports/F2e-reposo.mjs --path /descargables/__base.html   (con --base <commit>: otra versión)
import { execFileSync } from 'node:child_process';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PAGES = +arg('pages', 4), NOTES = +arg('notes', 12), BASE = arg('base', null);
const FILE = 'descargables/J4-Sirens_Station.html';
const PATH = BASE ? '/__f2e-base.html' : '/' + FILE;

const INIT = () => {
  const conn = AudioNode.prototype.connect;
  const CAP = `registerProcessor('f2e-cap', class extends AudioWorkletProcessor {
    constructor(){ super(); this.q = null; this.port.onmessage = (e) => { this.q = { f0: e.data.f0, buf: new Float32Array(e.data.n), k: 0, first: -1 }; }; }
    process(inp){ const q = this.q; if (!q) return true; const d = inp[0] && inp[0][0];
      for (let i = 0; i < 128 && q.k < q.buf.length; i++) { if (currentFrame + i < q.f0) continue; if (q.first < 0) q.first = currentFrame + i; q.buf[q.k++] = d ? d[i] : 0; }
      if (q.k === q.buf.length) { this.port.postMessage({ first: q.first, sr: sampleRate, buf: q.buf }, [q.buf.buffer]); this.q = null; }
      return true; } });`;
  window.__probe = async (c, param) => {
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([CAP], { type: 'application/javascript' })));
    const p = c.createGain(); p.gain.value = param.value;
    const one = c.createConstantSource(); one.start(); conn.call(one, p);
    const cap = new AudioWorkletNode(c, 'f2e-cap'); const m = c.createGain(); m.gain.value = 0;
    conn.call(p, cap); conn.call(cap, m); conn.call(m, c.destination);
    for (const k of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) {
      const f = param[k]; if (f) param[k] = function (...a) { p.gain[k](...a); return f.apply(this, a); };
    }
    return (f0, n) => new Promise((ok) => { cap.port.onmessage = (e) => ok(e.data); cap.port.postMessage({ f0, n }); });
  };
};
const DRY = { wave: 'square', mode: 'wail', shape: 'tri', rate: 6, depth: 0, cutoff: 1400, reso: 0.62, envAmt: 0.35, glide: 40,
  atk: 6, dec: 220, sus: 0.85, rel: 340, vol: 0.8, drive: 1.6,
  lfo: [{ rate: 0.8, depth: 0, dest: 'off', shape: 'sine' }, { rate: 0.15, depth: 0, dest: 'off', shape: 'tri' }],
  echo: { time: 0.38, fb: 0.2, tone: 3400, wow: 0, sat: 1.8, mix: 0.38, on: false },
  rev: { mode: 'spring', decay: 2.6, tone: 4200, mix: 0.26, on: false }, ph: { rate: 0.35, depth: 0.6, fb: 0.35, mix: 0, on: false } };
const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

const extra = BASE ? { [PATH]: { body: execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }) } } : {};
const srv = await serveRoot(ROOT, extra);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const rows = [];
try {
  await Promise.all(Array.from({ length: PAGES }, async () => {
    const bctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await bctx.addInitScript(INIT);
    const page = await bctx.newPage();
    await page.goto(srv.origin + PATH, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.click('#power');
    await page.waitForFunction(() => typeof ctx !== 'undefined' && ctx && ctx.state === 'running' && audioReady && !document.getElementById('power'), null, { timeout: 8000 });
    await page.evaluate((p) => applyPatch(p), DRY);
    await page.waitForTimeout(1200);
    await page.evaluate(async () => { window.__cap = await window.__probe(ctx, vca.gain); });
    for (let k = 0; k < NOTES; k++) {
      await page.evaluate(() => noteOn('pad', 57));
      await page.waitForTimeout(1200 + (k % 4) * 37);   // el sustain ya convergió (dec/3 = 73 ms)
      const tau = await page.evaluate(() => Math.max(.005, P.rel / 1000 / 3));
      await page.evaluate(([tau]) => {
        const sr = ctx.sampleRate;
        window.__got = window.__cap(Math.round(ctx.currentTime * sr), Math.ceil((0.2 + 12 * tau) * sr));
      }, [tau]);
      await page.waitForTimeout(80);   // la captura ya está corriendo cuando llega el noteOff
      const r = await page.evaluate(() => {
        const sr = ctx.sampleRate;
        // el t que usa ampGate: se lee dentro de la llamada (setValueAtTime(now, t) es la primera con tiempo)
        let tAmp = null; const sv = vca.gain.setValueAtTime;
        vca.gain.setValueAtTime = function (v, t) { if (tAmp === null) tAmp = t; return sv.call(this, v, t); };
        const g0 = vca.gain.value; noteOff('pad');
        vca.gain.setValueAtTime = sv;
        return { tOffFrame: Math.round(tAmp * sr), g0, sr };
      });
      const g = await page.evaluate(async () => { const x = await window.__got; return { first: x.first, sr: x.sr, buf: Array.from(x.buf) }; });
      // inicio de la caída: primera muestra < g0 después del noteOff
      const i0 = r.tOffFrame - g.first, buf = g.buf;
      let start = -1; for (let i = Math.max(1, i0 - 256); i < buf.length; i++) if (buf[i] < buf[0] * (1 - 1e-5)) { start = i; break; }
      const tkFrame = i0 + tau * r.sr * Math.log(r.g0 / 1e-4);        // la rodilla que calcula ampGate, en frames desde t
      const kb = Math.ceil(tkFrame) - 1, before = buf[kb], at = buf[kb + 1];
      // mayor escalón (como j4-reposo 2)
      const kk = Math.exp(-1 / (tau * r.sr)), lin = 1e-4 / (tau * r.sr);
      let step = 0, stepAt = -1;
      for (let i = Math.max(1, i0 - 128); i < buf.length; i++) {
        const hi = buf[i - 1], lo = hi > 1e-4 ? hi * kk : Math.max(0, hi - lin), b = buf[i];
        const d = b < lo ? lo - b : b > hi ? b - hi : 0; if (d > step) { step = d; stepAt = i; }
      }
      rows.push({ delay: start - i0, before, at, step: dB(step), stepTau: (stepAt - i0) / (tau * r.sr), tau, sr: r.sr,
        around: process.env.DUMP ? { start: buf.slice(start - 3, start + 3), knee: buf.slice(kb - 3, kb + 4).map((v) => v / 1e-4), stepZone: buf.slice(stepAt - 3, stepAt + 3) } : null });
      await page.waitForTimeout(Math.ceil(11 * tau * 1000) + 200);
    }
    await bctx.close();
  }));
} finally { await browser.close(); await srv.close(); }

const by = {};
for (const r of rows) { const k = r.delay; (by[k] ||= []).push(r); }
console.log(`${rows.length} releases (${PAGES} páginas × ${NOTES}) · ${BASE ? 'versión ' + BASE : 'versión actual'} · τ ${(rows[0].tau * 1000).toFixed(1)} ms · ${rows[0].sr} Hz`);
console.log('inicio de la caída respecto del frame de t (ctx.currentTime en el noteOff) · releases · valor justo antes de la rodilla / 1e-4 · mayor escalón');
for (const k of Object.keys(by).map(Number).sort((a, b) => a - b)) {
  const a = by[k], rb = a.map((r) => r.before / 1e-4), st = a.map((r) => r.step);
  console.log(`  ${String(k).padStart(4)} muestras: ${String(a.length).padStart(3)} · ${Math.min(...rb).toFixed(5)}–${Math.max(...rb).toFixed(5)} · ${Math.min(...st).toFixed(1)} a ${Math.max(...st).toFixed(1)} dB (a las ${[...new Set(a.map((r) => r.stepTau.toFixed(2)))].slice(0, 4).join(', ')} τ)`);
}
const predicted = 1e-4 * (Math.exp(128 / (rows[0].sr * rows[0].tau)) - 1);
console.log(`previsto con un bloque (128 muestras) de atraso: valor en la rodilla ×${Math.exp(128 / (rows[0].sr * rows[0].tau)).toFixed(5)}, escalón ${dB(predicted).toFixed(2)} dB`);
console.log(`releases con escalón ≥ −120 dB: ${rows.filter((r) => r.step >= -120).length} de ${rows.length}`);
if (process.env.DUMP) for (const r of rows.filter((x) => x.delay !== 1 || x.step >= -120)) console.log(JSON.stringify({ delay: r.delay, step: r.step.toFixed(1), stepTau: r.stepTau.toFixed(3), ...r.around }));
