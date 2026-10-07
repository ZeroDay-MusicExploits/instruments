#!/usr/bin/env node
// Re-pega los bloques ZD de tools/blocks/ en los descargables/*.html (SPEC 3.1.2).
// Node >=18, sin dependencias.
//
// Para cada archivo de descargables/ y cada bloque, reemplaza la región que va de
// `/* ZD-BLOCK:<nombre> v<n> */` a `/* /ZD-BLOCK:<nombre> */` (los dos incluidos,
// una sola vez por archivo) por la de tools/blocks/<nombre>.html. El número de
// versión del delimitador viene de la copia canónica, así que subir la versión
// ahí la propaga sola.
//
// Si un archivo no tiene el bloque, lo reporta como "pendiente" y NO lo inserta:
// pegar un bloque nuevo en un instrumento es trabajo de la sesión de ese
// instrumento (hay que ubicarlo en el <head>, en el orden de docs/zd-blocks.md,
// escribir el skin y cablearlo).
//
//   node tools/sync-blocks.mjs                 escribe
//   node tools/sync-blocks.mjs --check         no escribe; exit 1 si hay diferencias
//   node tools/sync-blocks.mjs --only zd-midi  un bloque (repetible, o con comas)
//   node tools/sync-blocks.mjs --file Acid_Bass-303.html   un archivo (repetible)
//
// Después de sincronizar, `node tools/check-blocks.mjs` tiene que quedar en verde.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'descargables');
const CANON = join(ROOT, 'tools', 'blocks');

// mismo orden y nombres que tools/check-blocks.mjs
const BLOCKS = ['zd-mobile', 'zd-sheet-input', 'zd-audio', 'zd-store', 'zd-ui', 'zd-rec', 'zd-dl', 'zd-midi', 'zd-pwa'];

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const list = (flag) => argv.flatMap((a, i) => (argv[i - 1] === flag ? a.split(',') : [])).filter(Boolean);
const onlyBlocks = list('--only');
const onlyFiles = list('--file').map((f) => basename(f));

if (argv.some((a) => a === '-h' || a === '--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  process.exit(0);
}
for (const b of onlyBlocks) {
  if (!BLOCKS.includes(b)) { console.error(`ERROR  --only ${b}: no es un bloque ZD (${BLOCKS.join(', ')})`); process.exit(2); }
}

const names = onlyBlocks.length ? BLOCKS.filter((b) => onlyBlocks.includes(b)) : BLOCKS;
const files = readdirSync(SRC).filter((f) => f.endsWith('.html')).sort()
  .filter((f) => !onlyFiles.length || onlyFiles.includes(f));
if (onlyFiles.length && files.length !== onlyFiles.length) {
  console.error(`ERROR  --file: no están en descargables/: ${onlyFiles.filter((f) => !files.includes(f)).join(', ')}`);
  process.exit(2);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ubica la región del bloque `name` en `source`. -> {start, end, text, version} | null
 *  Tira si está mal formada (abierta más de una vez, sin cerrar, cerrada antes). */
function locate(source, name, where) {
  const openRe = new RegExp('/\\* ZD-BLOCK:' + esc(name) + ' v(\\d+) \\*/', 'g');
  const closeTag = `/* /ZD-BLOCK:${name} */`;
  const opens = [...source.matchAll(openRe)];
  const closes = [];
  for (let i = source.indexOf(closeTag); i !== -1; i = source.indexOf(closeTag, i + 1)) closes.push(i);

  if (opens.length === 0 && closes.length === 0) return null;
  if (opens.length !== 1 || closes.length !== 1) {
    throw new Error(`${where}: ${name} aparece ${opens.length} vez/veces abierto y ${closes.length} cerrado (tiene que ser 1 y 1)`);
  }
  const start = opens[0].index;
  const end = closes[0] + closeTag.length;
  if (end <= start) throw new Error(`${where}: ${name} cierra antes de abrir`);
  return { start, end, text: source.slice(start, end), version: opens[0][1] };
}

// --- copias canónicas ---
const canon = new Map();
let problems = 0;
for (const name of names) {
  const path = join(CANON, `${name}.html`);
  if (!existsSync(path)) { console.error(`ERROR  falta la copia canónica tools/blocks/${name}.html`); problems++; continue; }
  let got;
  try { got = locate(readFileSync(path, 'utf8'), name, `tools/blocks/${name}.html`); }
  catch (err) { console.error(`ERROR  ${err.message}`); problems++; continue; }
  if (!got) { console.error(`ERROR  tools/blocks/${name}.html no contiene el bloque ${name}`); problems++; continue; }
  canon.set(name, got);
}
if (problems) { console.error(`\nFALLA: ${problems} problema(s) con las copias canónicas de tools/blocks/.`); process.exit(1); }

// --- reemplazo archivo por archivo ---
const rows = [];
let changed = 0, pending = 0, same = 0;

for (const file of files) {
  const path = join(SRC, file);
  let source = readFileSync(path, 'utf8');
  const before = source;
  const done = [], skipped = [], updated = [];

  // de atrás para adelante: los offsets de los bloques anteriores no se mueven
  const found = [];
  for (const name of names) {
    let got;
    try { got = locate(source, name, file); }
    catch (err) { console.error(`ERROR  ${err.message}`); problems++; continue; }
    if (got) found.push({ name, ...got });
    else { skipped.push(name); pending++; }
  }
  found.sort((a, b) => b.start - a.start);

  for (const hit of found) {
    const target = canon.get(hit.name);
    if (hit.text === target.text) { done.push(hit.name); same++; continue; }
    source = source.slice(0, hit.start) + target.text + source.slice(hit.end);
    updated.push(`${hit.name} v${hit.version}→v${target.version}`);
  }

  if (source !== before) {
    changed++;
    if (!CHECK) writeFileSync(path, source);
  }
  rows.push({ file, updated, done, skipped, wrote: source !== before });
}

// --- reporte ---
console.log(`sync-blocks${CHECK ? ' --check' : ''} · ${files.length} archivo(s) en descargables/ · ${names.length} bloque(s)`);
for (const r of rows) {
  const state = r.wrote ? (CHECK ? 'DIFIERE' : 'actualizado') : 'al día';
  console.log(`  ${r.file.padEnd(26)} ${state}`);
  if (r.updated.length) console.log(`    ${CHECK ? 'difiere' : 'repegado'}: ${r.updated.join(', ')}`);
  if (r.done.length) console.log(`    idéntico: ${r.done.join(', ')}`);
  if (r.skipped.length) console.log(`    pendiente (no lo inserta): ${r.skipped.join(', ')}`);
}
console.log(`\n${same} bloque(s) ya idénticos · ${changed} archivo(s) ${CHECK ? 'con diferencias' : 'escritos'} · ${pending} pendiente(s)`);

if (problems) { console.error(`\nFALLA: ${problems} bloque(s) mal formado(s).`); process.exit(1); }
if (CHECK && changed) {
  console.error('\nFALLA: hay bloques desincronizados. Corré `node tools/sync-blocks.mjs` y volvé a commitear.');
  process.exit(1);
}
if (!CHECK && changed) console.log('Ahora: node tools/check-blocks.mjs');
