#!/usr/bin/env node
// Corre todos los tests de tools/tests/ en orden y devuelve exit 1 si alguno
// falla. `node tools/tests/run.mjs` (o `node --test tools/tests/`).
//
// zd-midi-order es Node puro. zd-mobile-cycle y los *-verify necesitan Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
//
//   node tools/tests/run.mjs                 # todo (los *-verify tardan ~1 min cada uno)
//   node tools/tests/run.mjs --quick         # modo corto: sin los *-verify.test.mjs
//   node tools/tests/run.mjs --only cronbeat # solo los archivos cuyo nombre contiene el texto
// Ver docs/tests.md.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const quick = args.includes('--quick') || args.includes('--corto');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !(quick && f.endsWith('-verify.test.mjs')))
  .filter((f) => !only || f.includes(only))
  .sort();
if (!files.length) { console.error('Ningún test coincide con los filtros.'); process.exit(1); }

let failed = 0;
for (const f of files) {
  console.log(`\n${'─'.repeat(72)}\n▶ ${f}\n${'─'.repeat(72)}`);
  const code = await new Promise((ok) => {
    spawn(process.execPath, [join(HERE, f)], { stdio: 'inherit' }).on('close', ok);
  });
  if (code !== 0) { failed++; console.log(`✗ ${f} falló (exit ${code})`); }
}
console.log(`\n${failed ? `FALLA: ${failed} de ${files.length} archivos de test` : `OK: ${files.length} archivos de test en verde`}`);
process.exit(failed ? 1 : 0);
