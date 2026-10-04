#!/usr/bin/env node
// tools/tests/zd-rec-comments.test.mjs
//
// Desde zd-rec v2 el corte por tope ya no descarta la toma (docs/zd-blocks.md,
// changelog 2026-10-04). Los comentarios de J4 (getRecorder) y MonoMoon
// (startTake) que decían lo contrario quedaron viejos y llevaban a pensar que
// el workaround era obligatorio (reports/E1.md, tarea 7). Node puro.
//
//   node tools/tests/zd-rec-comments.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/load-block.mjs';

const STALE = /descarta el resultado|stop\(\) interno lo descarta|zd-rec descarta/i;

test('ningún instrumento dice que zd-rec descarta la toma del tope', () => {
  const hits = [];
  for (const f of readdirSync(join(ROOT, 'descargables')).filter((x) => x.endsWith('.html'))) {
    readFileSync(join(ROOT, 'descargables', f), 'utf8').split('\n').forEach((l, i) => { if (STALE.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  }
  if (hits.length) console.log('  ' + hits.join('\n  '));
  assert.deepEqual(hits, [], 'comentarios de zd-rec v1 que quedaron viejos');
});
