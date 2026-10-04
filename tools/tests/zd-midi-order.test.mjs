#!/usr/bin/env node
// tools/tests/zd-midi-order.test.mjs
//
// Bug reportado por la sesión C1 (reports/nebularp-block-request.md, punto 1):
// `ZD.midi.write()` promete que a igual tick resuelve `off → cc → bend → on`,
// pero el comparador usa `(ORDER[a.type] || 9)` y `ORDER.off === 0` es falsy,
// así que el note-off se va al final y sale DESPUÉS del note-on del mismo tick.
//
// El test exporta el patrón "0 ~ 0" de Acid con el código real del instrumento,
// más dos secuencias sintéticas de notas repetidas (una escrita a mano y otra
// por `ZD.midi.recorder()`), parsea el SMF y exige que no haya note-offs
// después del note-on del mismo tick, ni notas solapadas, colgadas o de
// duración cero.
//
//   node tools/tests/zd-midi-order.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBlock, blobBytes } from './lib/load-block.mjs';
import { loadAcidMidi } from './lib/acid-midi.mjs';
import { parseSMF, analyzeNotes, describe, defects } from './lib/smf.mjs';

const { ZD, version } = loadBlock('zd-midi');
const acid = loadAcidMidi();

async function check(label, blob) {
  const parsed = parseSMF(await blobBytes(blob));
  const a = analyzeNotes(parsed);
  console.log(`\n${label}\n${describe(parsed, a)}`);
  const bad = defects(a);
  if (bad.length) console.log('  DEFECTOS:\n' + bad.map((d) => `    - ${d}`).join('\n'));
  return { parsed, a, bad };
}

test(`zd-midi v${version} · caso del reporte: off y on de la misma altura en el tick 48`, async () => {
  const { parsed, a, bad } = await check('caso del reporte', ZD.midi.write({
    ppq: 96, bpm: 120, trackName: 'repro', events: [
      { t: 0, type: 'on', pitch: 60, vel: 100 }, { t: 48, type: 'off', pitch: 60 },
      { t: 48, type: 'on', pitch: 60, vel: 100 }, { t: 96, type: 'off', pitch: 60 },
    ],
  }));

  // el orden del archivo, no solo el resultado: a igual tick el off va primero
  const nn = parsed.events.filter((e) => e.kind === 'on' || e.kind === 'off')
    .map((e) => `${e.tick}:${e.kind}`);
  assert.deepEqual(nn, ['0:on', '48:off', '48:on', '96:off'],
    'a igual tick el note-off tiene que salir antes que el note-on');
  assert.deepEqual(a.notes.map((n) => [n.pitch, n.start, n.end]), [[60, 0, 48], [60, 48, 96]]);
  assert.deepEqual(bad, [], 'el SMF tiene que quedar sin defectos');
});

test(`zd-midi v${version} · todos los tipos a igual tick: off → cc → bend → on`, async () => {
  const blob = ZD.midi.write({
    ppq: 96, bpm: 120, events: [
      { t: 0, type: 'on', pitch: 60, vel: 100 },
      { t: 24, type: 'on', pitch: 60, vel: 90 }, { t: 24, type: 'bend', val: 9000 },
      { t: 24, type: 'cc', cc: 74, val: 70 }, { t: 24, type: 'off', pitch: 60 },
      { t: 48, type: 'off', pitch: 60 },
    ],
  });
  const parsed = parseSMF(await blobBytes(blob));
  const order = parsed.events.filter((e) => e.tick === 24 && e.kind !== 'eot').map((e) => e.kind);
  console.log(`\norden a igual tick (24): ${order.join(' → ')}`);
  assert.deepEqual(order, ['off', 'cc', 'bend', 'on'], 'el orden documentado es off → cc → bend → on');
  assert.deepEqual(defects(analyzeNotes(parsed)), []);
});

test(`zd-midi v${version} · note-off estable por altura a igual tick`, async () => {
  // tres offs y tres ons en el mismo tick: los offs primero y, entre ellos,
  // por altura ascendente (orden estable, reproducible entre corridas)
  const events = [];
  for (const p of [67, 60, 64]) events.push({ t: 0, type: 'on', pitch: p, vel: 100 });
  for (const p of [67, 60, 64]) { events.push({ t: 48, type: 'off', pitch: p }); events.push({ t: 48, type: 'on', pitch: p, vel: 100 }); }
  for (const p of [67, 60, 64]) events.push({ t: 96, type: 'off', pitch: p });

  const parsed = parseSMF(await blobBytes(ZD.midi.write({ ppq: 96, bpm: 120, events })));
  const at48 = parsed.events.filter((e) => e.tick === 48).map((e) => `${e.kind}${e.pitch}`);
  console.log(`\nacorde repetido en el tick 48: ${at48.join(' ')}`);
  assert.deepEqual(at48, ['off60', 'off64', 'off67', 'on60', 'on64', 'on67'],
    'offs antes que ons y, entre offs, por altura ascendente');
  assert.deepEqual(defects(analyzeNotes(parsed)), []);
});

test(`zd-midi v${version} · recorder(): nota repetida que cae en el mismo tick`, async () => {
  // El recorder cierra la nota abierta cuando entra otra de la misma altura, y
  // ese off cae en el tick del on nuevo cuando los dos redondean igual.
  // 120 bpm, ppq 96 -> 192 ticks/s; 0,25 s = 48 ticks exactos.
  const rec = ZD.midi.recorder({ ppq: 96, bpm: 120, trackName: 'repetidas' });
  rec.start(0);
  rec.noteOn(60, 100, 0);
  rec.noteOff(60, 0.25);
  rec.noteOn(60, 100, 0.25);      // off y on en el tick 48
  rec.noteOff(60, 0.5);
  rec.noteOn(60, 100, 0.5);
  rec.noteOn(60, 100, 0.75);      // re-trigger sin noteOff: el bloque cierra sola
  rec.noteOff(60, 1.0);
  rec.stop(1.0);

  const { a, bad } = await check('recorder: notas repetidas', rec.blob({ bpm: 120 }));
  assert.deepEqual(a.notes.map((n) => [n.start, n.end]), [[0, 48], [48, 96], [96, 144], [144, 192]],
    'cuatro notas de 48 ticks, una detrás de la otra');
  assert.deepEqual(bad, []);
});

test('Acid Bass-303 · patrón "0 ~ 0": nota ligada que termina donde arranca otra igual', async () => {
  const { a, bad } = await check('Acid "0 ~ 0"', acid.exportPattern('0 ~ 0'));
  assert.equal(a.notes.length, 2, 'dos notas: la ligada (pasos 1-2) y la del paso 3');
  assert.deepEqual(a.notes.map((n) => [n.pitch, n.start, n.end]), [[33, 0, 48], [33, 48, 60]],
    'la primera cierra en 48 y la segunda arranca en 48');
  assert.deepEqual(bad, [], 'sin solapadas, colgadas ni de duración cero');
});

test('Acid Bass-303 · patrón de fábrica y otros con alturas repetidas', async () => {
  const patterns = [
    '0a 0s 12 ~ 0a . 7s 12a 0 0s 3 . 12a 10s 7 0',   // el de initPattern()
    '0 ~ 0 ~ 0 ~ 0 ~ 0 ~ 0 ~ 0 ~ 0 ~',               // ligaduras y repetición constante
    '0s 0 0s 0 0s 0 0s 0',                            // slide entre alturas iguales
    '12 ~ ~ 12 . 12 12 12',
  ];
  for (const p of patterns) {
    const { bad } = await check(`Acid "${p}"`, acid.exportPattern(p));
    assert.deepEqual(bad, [], `el patrón "${p}" tiene que exportar un SMF sano`);
  }
});
