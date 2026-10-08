#!/usr/bin/env node
// Verifica los íconos de los 5 instrumentos. Sale con código 1 si
// algo no cumple. Los PNG los entrega el diseño (src/brand/zeroday-brand-assets/icons/)
// y se copian tal cual a icons/: acá no se generan, se comprueban.
//
//   node tools/check-icons.mjs [--root <carpeta>]     (npm run check-icons)
//
// Por instrumento y variante (192, 512, 512-maskable, apple-touch-180):
//   1. el archivo existe y mide lo que dice su nombre;
//   2. es 100 % opaco (alfa 255 en todos los píxeles);
//   3. el fondo (las 4 esquinas) es el color de acento de data/instrumentos.json;
//   4. nada tocando el borde: el anillo exterior de 1 px es todo fondo (no hay recorte);
//   5. maskable: todo el contenido (lo que difiere del fondo) cae dentro del círculo
//      de zona segura, de radio 40 % del lado (204,8 px en 512). Se mide hasta la
//      esquina más lejana de cada píxel, o sea, del lado conservador.
// Y de las referencias, con el mismo criterio de «existe y mide lo que dice»:
//   6. manifests/<slug>.webmanifest: íconos any 192 y 512 y maskable 512, sin
//      «monochrome», con `sizes`, `type` y `purpose` que coinciden con el archivo;
//   7. sw.js precachea los 20 PNG.
//
// Solo usa pngjs (devDependency) y módulos de Node.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? resolve(process.argv[rootArg + 1]) : join(HERE, '..');

const VARIANTS = [
  { suffix: '192', size: 192 },
  { suffix: '512', size: 512 },
  { suffix: '512-maskable', size: 512, maskable: true },
  { suffix: 'apple-touch-180', size: 180 },
];
// W3C Web App Manifest: la zona segura del ícono maskable es un círculo de radio 40 % del lado.
const SAFE_RADIUS = 0.4;

const fails = [];
const fail = (msg) => fails.push(msg);
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readPng = (rel) => PNG.sync.read(readFileSync(join(ROOT, rel)));

const data = JSON.parse(read('data/instrumentos.json'));

// El slug de los íconos (j4-sirens, acid-bass) no es el de data/ (sirens, acid): se lee del
// <link rel="apple-touch-icon"> del propio instrumento, que es lo que usa favicon.test.mjs.
function iconSlug(key) {
  const file = data.instruments[key].file.replace(/^\.\//, '');
  const m = /href="\.\.\/icons\/([a-z0-9-]+)-apple-touch-180\.png"/.exec(read(file));
  if (!m) throw new Error(`${file}: no encontré el <link rel="apple-touch-icon" href="../icons/<slug>-apple-touch-180.png">`);
  return m[1];
}

function checkIcon(slug, accent, { suffix, size, maskable }) {
  const rel = `icons/${slug}-${suffix}.png`;
  const tag = `${slug} ${suffix}`;
  if (!existsSync(join(ROOT, rel))) { fail(`${rel}: no existe`); return null; }
  const png = readPng(rel);
  const { width: w, height: h, data: d } = png;
  if (w !== size || h !== size) { fail(`${rel}: mide ${w}×${h}, tiene que medir ${size}×${size}`); return null; }

  let transparent = 0, border = 0, maxR = 0, content = 0;
  const bg = hex(d[0], d[1], d[2]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] !== 255) transparent++;
      const isBg = d[i] === d[0] && d[i + 1] === d[1] && d[i + 2] === d[2];
      if (isBg) continue;
      content++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
      // distancia al centro hasta la esquina más lejana del píxel
      const r = Math.hypot(Math.abs(x + 0.5 - w / 2) + 0.5, Math.abs(y + 0.5 - h / 2) + 0.5);
      if (r > maxR) maxR = r;
    }
  }
  const corners = new Set([0, w - 1, (h - 1) * w, h * w - 1].map((p) => hex(d[p * 4], d[p * 4 + 1], d[p * 4 + 2])));
  if (transparent) fail(`${rel}: ${transparent} píxel(es) no opaco(s)`);
  if (corners.size !== 1 || !corners.has(accent)) fail(`${rel}: fondo ${[...corners].join('/')}, el acento de data/instrumentos.json es ${accent}`);
  if (!content) fail(`${rel}: está vacío (solo fondo)`);
  if (border) fail(`${rel}: ${border} píxel(es) de contenido tocan el borde (recorte)`);
  const safe = size * SAFE_RADIUS;
  if (maskable && maxR > safe) fail(`${rel}: el contenido llega a ${maxR.toFixed(1)} px del centro y la zona segura es ${safe.toFixed(1)} px`);
  const extra = maskable ? ` · contenido a ${maxR.toFixed(1)} px del centro (zona segura ${safe.toFixed(1)})` : '';
  console.log(`  ${tag.padEnd(26)} ${w}×${h} · opaco${transparent ? ' ✗' : ''} · fondo ${bg}${extra}`);
  return png;
}

function checkManifest(slug) {
  const rel = `manifests/${slug}.webmanifest`;
  if (!existsSync(join(ROOT, rel))) { fail(`${rel}: no existe`); return; }
  const man = JSON.parse(read(rel));
  const icons = man.icons || [];
  const want = [['any', 192], ['any', 512], ['maskable', 512]];
  for (const [purpose, size] of want) {
    const it = icons.find((i) => (i.purpose || 'any') === purpose && i.sizes === `${size}x${size}`);
    if (!it) { fail(`${rel}: falta el ícono ${purpose} ${size}×${size}`); continue; }
    const suffix = purpose === 'maskable' ? '512-maskable' : String(size);
    const target = `../icons/${slug}-${suffix}.png`;
    if (it.src !== target) fail(`${rel}: el ícono ${purpose} ${size} apunta a ${it.src}, tiene que apuntar a ${target}`);
    if (it.type !== 'image/png') fail(`${rel}: el ícono ${it.src} declara type ${it.type}`);
    const file = join('manifests', it.src);
    const abs = resolve(ROOT, file);
    if (!existsSync(abs)) { fail(`${rel}: ${it.src} no existe`); continue; }
    const png = PNG.sync.read(readFileSync(abs));
    if (png.width !== size || png.height !== size) fail(`${rel}: ${it.src} mide ${png.width}×${png.height}, declara ${it.sizes}`);
  }
  for (const i of icons) if (/monochrome/.test(i.purpose || '')) fail(`${rel}: declara un ícono «monochrome» y el diseño no lo trajo (${i.src})`);
  if (icons.length !== want.length) fail(`${rel}: tiene ${icons.length} íconos, se esperan ${want.length}`);
}

function checkServiceWorker(slugs) {
  const sw = read('sw.js');
  const block = /PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/.exec(sw);
  if (!block) { fail('sw.js: no encontré PRECACHE_URLS'); return; }
  const listed = new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const slug of slugs) for (const { suffix } of VARIANTS) {
    if (!listed.has(`icons/${slug}-${suffix}.png`)) fail(`sw.js: no precachea icons/${slug}-${suffix}.png`);
  }
}

const slugs = [];
console.log('Íconos de los instrumentos (icons/)');
for (const key of data.order) {
  const slug = iconSlug(key);
  slugs.push(slug);
  const accent = data.instruments[key].colorHex.toLowerCase();
  for (const v of VARIANTS) checkIcon(slug, accent, v);
}
console.log('Manifests y service worker');
for (const slug of slugs) checkManifest(slug);
checkServiceWorker(slugs);
console.log(`  ${slugs.length} manifests y sw.js revisados`);

if (fails.length) {
  console.error(`\nFALLA: ${fails.length} problema${fails.length === 1 ? '' : 's'}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`\nOK: ${slugs.length * VARIANTS.length} íconos y ${slugs.length} manifests en regla.`);
