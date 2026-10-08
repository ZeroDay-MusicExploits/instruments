#!/usr/bin/env node
// Íconos del sitio («0xD» verde sobre un cuadrado redondeado casi negro, con las esquinas
// transparentes). El diseño entregó PNG RGBA de 7 a 26 KB (src/brand/zeroday-brand-assets/icons/);
// acá se pasan a PNG con paleta y alfa (tRNS) para que pesen ≤ 2 KB sin cambiar su aspecto.
//
//   node tools/make-site-icons.mjs [--root <carpeta>]
//
//   src/.../icons/favicon.png      64×64   → assets/favicon.png      <link rel="icon" sizes="64x64">
//   src/.../icons/favicon-32.png   32×32   → assets/favicon-32.png   <link rel="icon" sizes="32x32">
//   src/.../icons/favicon-180.png  180×180 → assets/favicon-180.png  <link rel="apple-touch-icon">
//
// favicon-512.png del diseño no se usa: el sitio no tiene manifest y ninguna página lo declara.
//
// Por cada archivo que pese más de 2 KB se prueba la paleta más grande (256, 128, 96, 64, 48, 32,
// 24, 16 colores) cuyo PNG entre en 2 KB, o sea, se pierde lo mínimo. Si el original ya tiene
// menos colores que la paleta, la salida es idéntica píxel a píxel. Se informa el error máximo
// y el medio por píxel (0–255, canal más desviado, alfa incluido) y sale con 1 si el máximo pasa
// de 8: más que eso ya se vería. Los archivos de ≤ 2 KB se copian tal cual.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { encodeIndexedPNG } from './lib/png.mjs';
import { quantize, pixelError } from './lib/quantize.mjs';

const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? resolve(process.argv[rootArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..');
const FROM = join(ROOT, 'src', 'brand', 'zeroday-brand-assets', 'icons');
const TO = join(ROOT, 'assets');

const FILES = [
  { name: 'favicon.png', size: 64 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-180.png', size: 180 },
];
const BUDGET = 2048; // bytes
const PALETTES = [256, 128, 96, 64, 48, 32, 24, 16];
const MAX_ERROR = 8;

mkdirSync(TO, { recursive: true });
let failed = false;
for (const { name, size } of FILES) {
  const original = readFileSync(join(FROM, name));
  const src = PNG.sync.read(original);
  if (src.width !== size || src.height !== size) throw new Error(`${name}: mide ${src.width}×${src.height}, tiene que medir ${size}×${size}`);
  let out = original, note = 'copiado tal cual (≤ 2 KB)', err = { max: 0, mean: 0 };
  if (original.length > BUDGET) {
    let pick = null;
    for (const n of PALETTES) {
      const { palette, indices } = quantize(src.data, n);
      const png = encodeIndexedPNG(size, size, indices, palette);
      if (png.length <= BUDGET) { pick = { png, n: palette.length }; break; }
    }
    if (!pick) throw new Error(`${name}: ni con ${PALETTES[PALETTES.length - 1]} colores entra en ${BUDGET} B`);
    out = pick.png;
    err = pixelError(src.data, PNG.sync.read(out).data);
    note = `paleta de ${pick.n} colores`;
  }
  writeFileSync(join(TO, name), out);
  const bad = err.max > MAX_ERROR;
  if (bad) failed = true;
  console.log(`assets/${name.padEnd(16)} ${String(original.length).padStart(5)} B → ${String(out.length).padStart(5)} B · ${note} · error máx ${err.max}, medio ${err.mean.toFixed(2)}${bad ? '  ✗ pasa de ' + MAX_ERROR : ''}`);
}
process.exit(failed ? 1 : 0);
