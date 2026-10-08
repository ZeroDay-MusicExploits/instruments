#!/usr/bin/env node
// Genera el favicon de cada instrumento desde icons/<slug>-512.png: un PNG de 32×32
// con paleta (≈0,4 KB) y uno de 16×16 de reserva. Es el mismo método que usó el diseño
// (src/brand/zeroday-brand-assets/favicons/, LEEME.txt), implementado con pngjs y los
// helpers de tools/lib/ (sin dependencias nuevas). No da los mismos bytes que los del
// diseño, sí una imagen equivalente.
//
//   1. Se aísla la ventana oscura del ícono: es la primera banda de filas con contenido
//      (le siguen el nombre y «ZERO DAY», que a 32 px no se leen y se descartan).
//   2. Se reduce a 30 px de ancho (los 16 px en el de 16) con Lanczos 3, y se centra
//      sobre un cuadrado del color de acento (el píxel (0,0) del ícono).
//   3. Se cuantiza a 24 colores (16 en el de 16 px) con median cut; el acento queda como
//      entrada exacta de la paleta, porque tools/tests/favicon.test.mjs exige que el
//      píxel (0,0) del favicon sea el acento del ícono.
//
//   node tools/make-favicons.mjs                 informa tamaños; no escribe nada
//   node tools/make-favicons.mjs --out <dir>     escribe favicon-<slug>-32.png y -16.png
//   node tools/make-favicons.mjs --html          reemplaza el <link rel="icon"> inline
//                                                de cada descargables/*.html (solo el base64)
//   --root <carpeta>                             otra raíz del repo (por defecto, esta)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { encodeIndexedPNG } from './lib/png.mjs';
import { quantize } from './lib/quantize.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const ROOT = arg('--root') ? resolve(arg('--root')) : join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = arg('--out') ? resolve(arg('--out')) : null;
const WRITE_HTML = process.argv.includes('--html');

// size: lado del favicon · width: ancho de la ventana dentro de él · colors: tope de la paleta
export const VARIANTS = [
  { size: 32, width: 30, colors: 24 },
  { size: 16, width: 16, colors: 16 },
];

/** Caja de la ventana oscura: la primera banda contigua de filas con algo distinto del fondo. */
export function findWindow(png) {
  const { width: w, height: h, data: d } = png;
  const isBg = (i) => d[i] === d[0] && d[i + 1] === d[1] && d[i + 2] === d[2];
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w && !any; x++) any = !isBg((y * w + x) * 4);
    if (any && y0 < 0) y0 = y;
    if (!any && y0 >= 0) { y1 = y - 1; break; }
  }
  if (y0 < 0 || y1 < 0) throw new Error('no encontré la ventana: el ícono no tiene una banda de contenido separada');
  let x0 = w, x1 = -1;
  for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (!isBg((y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  const box = { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const mid = ((y0 + (box.h >> 1)) * w + x0 + 8) * 4; // dentro de la ventana, lejos de los glifos
  if (box.h < h * 0.25 || box.h > h * 0.75 || d[mid] + d[mid + 1] + d[mid + 2] > 150) {
    throw new Error(`la primera banda (${box.w}×${box.h}) no parece la ventana oscura`);
  }
  return box;
}

/** Pesos de Lanczos (a = 3) para pasar `from` píxeles a `to`, por cada píxel de salida. */
function lanczosWeights(from, to) {
  const scale = from / to, support = 3 * Math.max(1, scale);
  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const kernel = (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0);
  return Array.from({ length: to }, (_, i) => {
    const center = (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(center - support)), hi = Math.min(from - 1, Math.ceil(center + support));
    const w = [];
    for (let j = lo; j <= hi; j++) w.push(kernel((j + 0.5 - center) / Math.max(1, scale)));
    const sum = w.reduce((x, y) => x + y, 0);
    return { lo, w: w.map((x) => x / sum) };
  });
}

/** Reduce el recorte `box` de `png` a tw×th con Lanczos 3 (separable). -> Float64Array RGB */
function reduce(png, box, tw, th) {
  const wx = lanczosWeights(box.w, tw), wy = lanczosWeights(box.h, th);
  const mid = new Float64Array(tw * box.h * 3); // horizontal primero
  for (let y = 0; y < box.h; y++) {
    for (let tx = 0; tx < tw; tx++) {
      for (let c = 0; c < 3; c++) {
        let v = 0;
        wx[tx].w.forEach((wgt, k) => { v += png.data[((box.y0 + y) * png.width + box.x0 + wx[tx].lo + k) * 4 + c] * wgt; });
        mid[(y * tw + tx) * 3 + c] = v;
      }
    }
  }
  const out = new Float64Array(tw * th * 3);
  for (let ty = 0; ty < th; ty++) {
    for (let x = 0; x < tw; x++) {
      for (let c = 0; c < 3; c++) {
        let v = 0;
        wy[ty].w.forEach((wgt, k) => { v += mid[((wy[ty].lo + k) * tw + x) * 3 + c] * wgt; });
        out[(ty * tw + x) * 3 + c] = Math.min(255, Math.max(0, v));
      }
    }
  }
  return out;
}

/** Favicon de `size` px del ícono de 512 `png`. -> { png: Buffer (con paleta), rgba, colors } */
export function makeFavicon(png, { size, width, colors }) {
  const accent = [png.data[0], png.data[1], png.data[2], 255];
  const box = findWindow(png);
  const th = Math.ceil((box.h * width) / box.w);
  const small = reduce(png, box, width, th);
  const ox = (size - width) >> 1, oy = (size - th) >> 1;
  const rgba = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) rgba.set(accent, p * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < width; x++) {
      const o = ((oy + y) * size + ox + x) * 4, s = (y * width + x) * 3;
      rgba[o] = Math.round(small[s]); rgba[o + 1] = Math.round(small[s + 1]); rgba[o + 2] = Math.round(small[s + 2]);
    }
  }
  const { palette, indices } = quantize(rgba, colors, { keep: [accent] });
  return { png: encodeIndexedPNG(size, size, indices, palette), colors: palette.length, accent };
}

/** descargables/*.html con su slug de ícono (sale del <link rel="apple-touch-icon">). */
function instruments() {
  const dir = join(ROOT, 'descargables');
  return readdirSync(dir).filter((f) => f.endsWith('.html')).sort().map((file) => {
    const html = readFileSync(join(dir, file), 'utf8');
    const m = /href="\.\.\/icons\/([a-z0-9-]+)-apple-touch-180\.png"/.exec(html);
    if (!m) throw new Error(`${file}: no encontré el <link rel="apple-touch-icon" href="../icons/<slug>-apple-touch-180.png">`);
    return { file, slug: m[1], html };
  });
}

const ICON_LINK = /<link\b[^>]*\brel="(?:shortcut )?icon"[^>]*>/g;
const INLINE_PNG = /href="data:image\/png;base64,[A-Za-z0-9+/=]+"/;
function withInlineFavicon(file, html, pngBuffer) {
  const head = html.slice(0, html.indexOf('</head>'));
  const links = head.match(ICON_LINK) || [];
  if (links.length !== 1) throw new Error(`${file}: tiene que haber exactamente un <link rel="icon"> (hay ${links.length})`);
  if (!INLINE_PNG.test(links[0])) throw new Error(`${file}: el <link rel="icon"> no es un PNG inline (data:image/png;base64)`);
  const link = links[0].replace(INLINE_PNG, `href="data:image/png;base64,${pngBuffer.toString('base64')}"`);
  return html.replace(links[0], () => link);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (OUT) mkdirSync(OUT, { recursive: true });
  const pending = []; // los HTML se escriben al final: si uno falla, no queda ninguno a medias
  for (const { file, slug, html } of instruments()) {
    const icon = PNG.sync.read(readFileSync(join(ROOT, 'icons', `${slug}-512.png`)));
    const made = VARIANTS.map((v) => ({ v, ...makeFavicon(icon, v) }));
    for (const { v, png, colors, accent } of made) {
      if (OUT) writeFileSync(join(OUT, `favicon-${slug}-${v.size}.png`), png);
      const hex = accent.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('');
      console.log(`${slug.padEnd(10)} ${v.size}×${v.size}  ${String(png.length).padStart(4)} B  ${colors} colores  (0,0) = #${hex}`);
    }
    if (WRITE_HTML) pending.push({ file, html, next: withInlineFavicon(file, html, made[0].png) }); // el de 32 px es el que va inline
  }
  for (const { file, html, next } of pending) {
    if (next !== html) writeFileSync(join(ROOT, 'descargables', file), next);
    console.log(`descargables/${file}: ${next === html ? 'sin cambios' : 'favicon actualizado'}`);
  }
}
