#!/usr/bin/env node
// Corre todos los tests de tools/tests/ en orden y devuelve exit 1 si alguno
// falla. `node tools/tests/run.mjs` (o `node --test tools/tests/`).
//
// zd-midi-order es Node puro. zd-mobile-cycle necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort();

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
