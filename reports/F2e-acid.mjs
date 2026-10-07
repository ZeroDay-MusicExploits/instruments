#!/usr/bin/env node
// reports/F2e-acid.mjs — el tope del corte de acid-svf (0,45 × sampleRate) a
// 32 kHz: cuántas tomas de la grilla de F2d cambian y cuánto. No es un test (el
// test es tools/tests/acid-svf.test.mjs).
//
// La grilla: CUTOFF de 0 a 100 % en pasos de 5 %, el pico de la envolvente sin
// acento (×3,39) y con acento (×9,33), RESO 0–100 %, LP/BP/HP, sierra de 55 Hz,
// 0,6 s. Diferencia = RMS de (ahora − antes) contra el RMS de antes, en dB.
//
//   node reports/F2e-acid.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const FILE = 'descargables/Acid_Bass-303.html', BASE = '70a916a';
const wk = (html) => html.match(/const WORKLET_CODE *= *`([\s\S]*?)`;/)[1];
const OLD = wk(execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${FILE}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const NOW = wk(readFileSync(join(ROOT, FILE), 'utf8'));
const svf = (code, sr) => { const C = {}; new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(class { constructor() { this.port = {}; } }, (n, c) => { C[n] = c; }, sr); return new C['acid-svf'](); };
function render(code, sr, { base, peak, res, mode, dec }) {
  const L = svf(code, sr), B = 128, N = Math.round(0.6 * sr), y = new Float32Array(N);
  const inp = [[new Float32Array(B)]], out = [[new Float32Array(B)]], pr = { cutoff: new Float32Array(B), resonance: new Float32Array([res]), mode: new Float32Array([mode]) };
  let ph = 0;
  for (let b = 0; b * B < N; b++) {
    for (let n = 0; n < B; n++) { const t = (b * B + n) / sr; ph = (ph + 55 / sr) % 1; inp[0][0][n] = 0.8 * (2 * ph - 1); pr.cutoff[n] = Math.fround(t < dec ? peak * Math.pow(base / peak, t / dec) : base); }
    L.process(inp, out, pr); y.set(out[0][0].subarray(0, Math.min(B, N - b * B)), b * B);
  }
  return y;
}
const cutoffHz = (k) => 40 * Math.pow(200, k);
const sr = 32000, cap = 0.45 * sr, rows = [];
for (let i = 0; i <= 20; i++) for (const mult of [1, 3.39, 9.33]) for (const res of [0, 0.25, 0.5, 0.75, 1]) for (const mode of [0, 1, 2]) {
  const base = Math.max(30, Math.min(16000, cutoffHz(i / 20))), c = { base, peak: Math.max(30, Math.min(16000, base * mult)), res, mode, dec: 0.3 };
  const a = render(OLD, sr, c), b = render(NOW, sr, c);
  let ss = 0, s2 = 0, diff = false;
  for (let k = 0; k < a.length; k++) { const e = b[k] - a[k]; ss += e * e; s2 += a[k] * a[k]; if (!Object.is(a[k], b[k])) diff = true; }
  if (diff) rows.push({ ...c, rel: 10 * Math.log10(ss / s2) });
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rel = rows.map((r) => r.rel);
console.log(`32 kHz, tope ${cap} Hz: ${rows.length} de 945 tomas cambian (todas con el pico del corte sobre el tope: ${rows.every((r) => r.peak > cap)})`);
console.log(`diferencia contra la señal (RMS de ahora − antes): mediana ${q(rel, 0.5).toFixed(1)} dB · p90 ${q(rel, 0.9).toFixed(1)} dB · la mayor ${Math.max(...rel).toFixed(1)} dB`);
for (const mode of [0, 1, 2]) {
  const m = rows.filter((r) => r.mode === mode);
  console.log(`  ${['LP', 'BP', 'HP'][mode]}: ${m.length} tomas · mediana ${q(m.map((r) => r.rel), 0.5).toFixed(1)} dB · la mayor ${Math.max(...m.map((r) => r.rel)).toFixed(1)} dB`);
}
for (const res of [0, 0.5, 1]) {
  const m = rows.filter((r) => r.res === res);
  console.log(`  RESO ${res}: ${m.length} tomas · mediana ${q(m.map((r) => r.rel), 0.5).toFixed(1)} dB · la mayor ${Math.max(...m.map((r) => r.rel)).toFixed(1)} dB`);
}
const lp = rows.filter((r) => r.mode === 0 && r.res === 0.5).sort((a, b) => b.rel - a.rel)[0];
if (lp) console.log(`  ejemplo, LP con RESO 50 % (el modo y la resonancia de fábrica): la mayor ${lp.rel.toFixed(1)} dB (CUTOFF ${Math.round(lp.base)} Hz, pico ${Math.round(lp.peak)} Hz)`);
