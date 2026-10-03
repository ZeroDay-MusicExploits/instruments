#!/usr/bin/env node
// Falla (exit 1) si descargables-zeroday.zip no coincide byte a byte con lo
// que build-zip.mjs generaría hoy a partir de descargables/. Pensado para
// correr en CI en cada push (ver .github/workflows/check-zip.yml).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip, collectDescargablesEntries, readZipEntries } from './zip-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = join(ROOT, 'descargables-zeroday.zip');

const entries = collectDescargablesEntries(join(ROOT, 'descargables'));
const expected = buildZip(entries);

if (!existsSync(zipPath)) {
  console.error('descargables-zeroday.zip no existe. Corré: node tools/build-zip.mjs');
  process.exit(1);
}

const actual = readFileSync(zipPath);

if (Buffer.compare(expected, actual) === 0) {
  console.log(`OK: descargables-zeroday.zip coincide con descargables/ (${entries.length} entradas).`);
  process.exit(0);
}

console.error('descargables-zeroday.zip NO coincide con descargables/.');
const expectedEntries = readZipEntries(expected);
const actualEntries = readZipEntries(actual);
const names = new Set([...expectedEntries.keys(), ...actualEntries.keys()]);
for (const name of names) {
  const exp = expectedEntries.get(name);
  const act = actualEntries.get(name);
  if (!act) console.error(`  + falta en el ZIP: ${name}`);
  else if (!exp) console.error(`  - sobra en el ZIP: ${name}`);
  else if (exp.crc32 !== act.crc32 || exp.size !== act.size) console.error(`  ~ difiere: ${name}`);
}
console.error('Corré: node tools/build-zip.mjs y commiteá el ZIP regenerado.');
process.exit(1);
