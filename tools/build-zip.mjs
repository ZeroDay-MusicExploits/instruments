#!/usr/bin/env node
// Arma descargables-zeroday.zip desde descargables/ de forma reproducible
// (orden alfabético fijo, fecha fija). No lo edites a mano: SPEC 3.2.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip, collectDescargablesEntries } from './zip-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = collectDescargablesEntries(join(ROOT, 'descargables'));
const buf = buildZip(entries);
const outPath = join(ROOT, 'descargables-zeroday.zip');
writeFileSync(outPath, buf);

console.log(`descargables-zeroday.zip escrito (${buf.length} bytes, ${entries.length} entradas):`);
for (const entry of entries) console.log(`  ${entry.name}`);
