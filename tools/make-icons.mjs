#!/usr/bin/env node
// Genera los íconos PWA (192, 512, 512 maskable, apple-touch 180) de los 5
// instrumentos a partir de src/logo-badge.png. Reproducible: misma entrada,
// mismos bytes de salida (sin fechas, sin metadata variable).
//
// Dependencia de dev: pngjs (decodificar/codificar PNG). El recorte del
// isotipo ">_0xD", el resize y el compositing contra el color de acento
// están implementados acá mismo, sin dependencias extra.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_LOGO = join(ROOT, 'src', 'logo-badge.png');
const OUT_DIR = join(ROOT, 'icons');

// logo-badge.png es el lockup completo (isotipo ">_0xD" + "ZERO DAY" +
// "MUSIC EXPLOITS"). A tamaño de ícono solo el isotipo ">_0xD" es legible,
// así que lo recortamos detectando automáticamente sus límites: primero la
// banda de filas de arriba (separada de "ZERO DAY" por una franja vacía),
// después, dentro de esa banda, la columna más a la derecha (eso descarta
// el glifo ">_" del prompt y deja solo "0xD").
function findForegroundBands(counts, { minCount, gapTolerance }) {
  const bands = [];
  let inBand = false;
  let start = 0;
  let zeroRun = 0;
  for (let i = 0; i < counts.length; i++) {
    const has = counts[i] > minCount;
    if (has) {
      if (!inBand) { inBand = true; start = i; }
      zeroRun = 0;
    } else if (inBand) {
      zeroRun++;
      if (zeroRun > gapTolerance) {
        bands.push([start, i - zeroRun]);
        inBand = false;
      }
    }
  }
  if (inBand) bands.push([start, counts.length - 1]);
  return bands;
}

function colorDistance(data, i, bg) {
  const dr = data[i] - bg[0];
  const dg = data[i + 1] - bg[1];
  const db = data[i + 2] - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function extractMark(png) {
  const { width: w, height: h, data } = png;
  const bg = [data[0], data[1], data[2]]; // esquina superior izquierda = fondo de la placa

  const rowCounts = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) {
      if (colorDistance(data, (w * y + x) << 2, bg) > 30) c++;
    }
    rowCounts[y] = c;
  }
  const rowBands = findForegroundBands(rowCounts, { minCount: 2, gapTolerance: 8 });
  if (rowBands.length === 0) throw new Error('No se detectó ningún glifo en ' + SOURCE_LOGO);
  const [ry0, ry1] = rowBands[0]; // primera banda de arriba = isotipo ">_0xD"

  const colCounts = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = ry0; y <= ry1; y++) {
      if (colorDistance(data, (w * y + x) << 2, bg) > 30) c++;
    }
    colCounts[x] = c;
  }
  const colBands = findForegroundBands(colCounts, { minCount: 1, gapTolerance: 8 });
  const [cx0, cx1] = colBands.length >= 2 ? colBands[colBands.length - 1] : colBands[0];

  // bbox ajustado dentro de la banda fila x columna elegida
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = ry0; y <= ry1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      if (colorDistance(data, (w * y + x) << 2, bg) > 30) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const out = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const srcRow = (w * (minY + y) + minX) << 2;
    data.copy(out, (cropW * y) << 2, srcRow, srcRow + (cropW << 2));
  }
  return { data: out, width: cropW, height: cropH };
}

// Resize bilineal RGBA -> RGBA (el logo recortado es opaco, no hace falta
// premultiplicar alpha).
function resizeBilinear(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const sy = (dy + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = (dx + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));

      const i00 = (srcW * y0 + x0) << 2;
      const i10 = (srcW * y0 + x1) << 2;
      const i01 = (srcW * y1 + x0) << 2;
      const i11 = (srcW * y1 + x1) << 2;
      const o = (dstW * dy + dx) << 2;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return out;
}

function compositeOver(dst, dstW, dstH, src, srcW, srcH, offX, offY) {
  for (let y = 0; y < srcH; y++) {
    const dy = offY + y;
    if (dy < 0 || dy >= dstH) continue;
    for (let x = 0; x < srcW; x++) {
      const dx = offX + x;
      if (dx < 0 || dx >= dstW) continue;
      const si = (srcW * y + x) << 2;
      const di = (dstW * dy + dx) << 2;
      const a = src[si + 3] / 255;
      for (let c = 0; c < 3; c++) {
        dst[di + c] = Math.round(src[si + c] * a + dst[di + c] * (1 - a));
      }
      dst[di + 3] = 255;
    }
  }
}

function makeIcon(mark, size, [r, g, b], contentScale) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < canvas.length; i += 4) {
    canvas[i] = r; canvas[i + 1] = g; canvas[i + 2] = b; canvas[i + 3] = 255;
  }
  const maxW = size * contentScale;
  const maxH = size * contentScale;
  const scale = Math.min(maxW / mark.width, maxH / mark.height);
  const dstW = Math.max(1, Math.round(mark.width * scale));
  const dstH = Math.max(1, Math.round(mark.height * scale));
  const resized = resizeBilinear(mark.data, mark.width, mark.height, dstW, dstH);
  compositeOver(canvas, size, size, resized, dstW, dstH, Math.round((size - dstW) / 2), Math.round((size - dstH) / 2));

  const png = new PNG({ width: size, height: size });
  canvas.copy(png.data);
  return PNG.sync.write(png);
}

// --- color de acento por instrumento ---
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Conversión OKLCH -> sRGB (Björn Ottosson, https://bottosson.github.io/posts/oklab/).
function oklchToRgb(L, C, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const enc = (c) => {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [r, g, bl].map((c) => Math.round(enc(c) * 255));
}

const INSTRUMENTS = [
  { slug: 'cronbeat', accent: oklchToRgb(0.82, 0.16, 80) }, // oklch(.82 .16 80)
  { slug: 'monomoon', accent: hexToRgb('#f2a63c') },
  { slug: 'nebularp', accent: hexToRgb('#9a8cff') },
  { slug: 'j4-sirens', accent: hexToRgb('#f06ad8') },
  { slug: 'acid-bass', accent: hexToRgb('#dcef3a') },
];

const TARGETS = [
  { suffix: '192', size: 192, contentScale: 0.78 },
  { suffix: '512', size: 512, contentScale: 0.78 },
  { suffix: '512-maskable', size: 512, contentScale: 0.5 }, // safe zone maskable: contenido dentro del 80% central
  { suffix: 'apple-touch-180', size: 180, contentScale: 0.78 },
];

function main() {
  const sourcePng = PNG.sync.read(readFileSync(SOURCE_LOGO));
  const mark = extractMark(sourcePng);
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  for (const { slug, accent } of INSTRUMENTS) {
    for (const { suffix, size, contentScale } of TARGETS) {
      const buf = makeIcon(mark, size, accent, contentScale);
      const outPath = join(OUT_DIR, `${slug}-${suffix}.png`);
      writeFileSync(outPath, buf);
      written++;
    }
  }
  console.log(`${written} íconos escritos en ${OUT_DIR} (isotipo recortado: ${mark.width}x${mark.height}px).`);
}

main();
