#!/usr/bin/env node
// Verifica que los bloques ZD sean byte a byte iguales en los 5 HTML de
// descargables/ (SPEC 3.1.2). Los archivos que todavía no tienen un bloque se
// reportan "pendiente" y no hacen fallar la corrida; dos archivos que tienen el
// mismo bloque con contenido distinto sí.
//
// Un bloque es el tramo que va de `/* ZD-BLOCK:<nombre> v<n> */` hasta
// `/* /ZD-BLOCK:<nombre> */`, ambos incluidos. Tiene que aparecer una sola vez
// por archivo. La copia canónica de cada bloque vive en tools/blocks/<nombre>.html
// y, si existe, también se compara contra ella.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'descargables');
const CANON = join(ROOT, 'tools', 'blocks');

const BLOCKS = ['zd-mobile', 'zd-audio', 'zd-store', 'zd-ui', 'zd-rec', 'zd-dl', 'zd-midi', 'zd-pwa'];

const FILES = readdirSync(SRC).filter((f) => f.endsWith('.html')).sort();

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Devuelve {text, version} o null, y tira si el bloque está mal formado. */
function extract(source, name, where) {
  const openRe = new RegExp('/\\* ZD-BLOCK:' + esc(name) + ' v(\\d+) \\*/', 'g');
  const closeTag = '/* /ZD-BLOCK:' + name + ' */';
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
  return { text: source.slice(start, end), version: opens[0][1] };
}

const sources = new Map();
for (const f of FILES) sources.set(f, readFileSync(join(SRC, f), 'utf8'));

let problems = 0;
const rows = [];

for (const name of BLOCKS) {
  const found = new Map();   // file -> {text, version}
  const missing = [];
  for (const f of FILES) {
    let got;
    try {
      got = extract(sources.get(f), name, f);
    } catch (err) {
      console.error(`ERROR  ${err.message}`);
      problems++;
      continue;
    }
    if (got) found.set(f, got);
    else missing.push(f);
  }

  if (found.size === 0) {
    rows.push({ name, version: '—', state: 'pendiente', detail: `0/${FILES.length} archivos` });
    continue;
  }

  // agrupar por contenido exacto
  const groups = new Map();
  for (const [f, got] of found) {
    if (!groups.has(got.text)) groups.set(got.text, []);
    groups.get(got.text).push(f);
  }

  const versions = [...new Set([...found.values()].map((g) => g.version))];
  const vLabel = versions.length === 1 ? `v${versions[0]}` : versions.map((v) => `v${v}`).join('/');

  if (groups.size > 1) {
    problems++;
    rows.push({ name, version: vLabel, state: 'DIFIERE', detail: `${groups.size} variantes entre ${found.size} archivos` });
    let i = 0;
    for (const [text, files] of groups) {
      console.error(`  ${name} · variante ${++i} (${text.length} bytes): ${files.join(', ')}`);
    }
  } else {
    const state = missing.length ? 'ok (parcial)' : 'ok';
    const detail = missing.length
      ? `${found.size}/${FILES.length} idénticos · pendiente: ${missing.join(', ')}`
      : `${found.size}/${FILES.length} idénticos`;
    rows.push({ name, version: vLabel, state, detail });
  }

  // comparación contra la copia canónica, si existe
  const canonPath = join(CANON, `${name}.html`);
  if (existsSync(canonPath)) {
    const canon = extract(readFileSync(canonPath, 'utf8'), name, `tools/blocks/${name}.html`);
    if (!canon) {
      console.error(`ERROR  tools/blocks/${name}.html no contiene el bloque ${name}`);
      problems++;
    } else {
      for (const [text, files] of groups) {
        if (text !== canon.text) {
          problems++;
          console.error(`ERROR  ${name}: ${files.join(', ')} no coincide con tools/blocks/${name}.html`);
        }
      }
    }
  }
}

const w = Math.max(...BLOCKS.map((b) => b.length));
console.log(`check-blocks · ${FILES.length} archivos en descargables/`);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(w)}  ${r.version.padEnd(4)}  ${r.state.padEnd(12)}  ${r.detail}`);
}

if (problems) {
  console.error(`\nFALLA: ${problems} problema(s). Los bloques ZD se copian idénticos (SPEC 3.1.2).`);
  process.exit(1);
}
console.log('\nOK: sin diferencias entre los bloques presentes.');
