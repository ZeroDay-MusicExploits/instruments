// Parser de Standard MIDI File formato 0 y análisis de notas, para los tests
// de `zd-midi`. Sin dependencias: solo Node >=18.
//
// No valida todo el estándar: cubre lo que escribe `ZD.midi.write()` (un solo
// track, tempo, nombre de track, note on/off, CC, pitch bend, end of track) y
// alcanza para responder las tres preguntas del bug: ¿hay notas solapadas?
// ¿colgadas? ¿de duración cero? Y, la que importa: ¿a igual tick, salió algún
// note-off DESPUÉS de un note-on?

/** Lee el SMF y devuelve { ppq, format, tracks, tempoBpm, trackName, events }.
 *  `events` son absolutos en ticks, en el orden en que están en el archivo. */
export function parseSMF(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  if (str(0, 4) !== 'MThd') throw new Error('no es un SMF: falta MThd');
  const headLen = u32(b, 4);
  const format = u16(b, 8);
  const tracks = u16(b, 10);
  const ppq = u16(b, 12);
  let p = 8 + headLen;

  if (str(p, 4) !== 'MTrk') throw new Error('no es un SMF: falta MTrk');
  const trkLen = u32(b, p + 4);
  const end = p + 8 + trkLen;
  if (end > b.length) throw new Error(`MTrk declara ${trkLen} bytes y el archivo tiene ${b.length - p - 8}`);
  p += 8;

  const events = [];
  let tick = 0, running = 0, tempoBpm = null, trackName = '', sawEOT = false;

  while (p < end) {
    const d = readVLQ(b, p); tick += d.value; p = d.next;
    let status = b[p];
    if (status & 0x80) p++; else status = running;          // running status
    if (status < 0xF0) running = status;

    const type = status & 0xF0, ch = status & 0x0F;
    if (type === 0x80 || type === 0x90) {
      const pitch = b[p++], vel = b[p++];
      // un note-on de velocity 0 es un note-off (convención del estándar)
      const kind = type === 0x90 && vel > 0 ? 'on' : 'off';
      events.push({ tick, kind, ch, pitch, vel });
    } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) {
      const a = b[p++], c = b[p++];
      events.push({ tick, kind: type === 0xB0 ? 'cc' : type === 0xE0 ? 'bend' : 'aftertouch', ch, a, b: c, value: type === 0xE0 ? a | (c << 7) : c, cc: a });
    } else if (type === 0xC0 || type === 0xD0) {
      const a = b[p++];
      events.push({ tick, kind: 'program', ch, a });
    } else if (status === 0xFF) {
      const meta = b[p++];
      const len = readVLQ(b, p); p = len.next;
      const data = b.subarray(p, p + len.value); p += len.value;
      if (meta === 0x51 && len.value === 3) {
        const mpq = (data[0] << 16) | (data[1] << 8) | data[2];
        tempoBpm = 60000000 / mpq;
        events.push({ tick, kind: 'tempo', mpq, bpm: tempoBpm });
      } else if (meta === 0x03) {
        trackName = String.fromCharCode(...data);
        events.push({ tick, kind: 'trackName', text: trackName });
      } else if (meta === 0x2F) {
        sawEOT = true;
        events.push({ tick, kind: 'eot' });
      } else {
        events.push({ tick, kind: 'meta', meta, data: Array.from(data) });
      }
    } else if (status === 0xF0 || status === 0xF7) {
      const len = readVLQ(b, p); p = len.next + len.value;
      events.push({ tick, kind: 'sysex' });
    } else {
      throw new Error(`status 0x${status.toString(16)} inesperado en el offset ${p}`);
    }
  }
  if (!sawEOT) throw new Error('el track no termina con End of Track');
  return { ppq, format, tracks, tempoBpm, trackName, events, bytes: b };
}

/** Empareja on/off y devuelve notas + los defectos que busca el bug de zd-midi. */
export function analyzeNotes(parsed) {
  const notes = [];
  const open = new Map();                 // "ch:pitch" -> { on, index }
  const overlapping = [], orphanOff = [], zeroLength = [], offAfterOnSameTick = [];

  // ¿a igual tick salió un off después de un on? (la promesa de write())
  let lastOnTick = null;
  for (const e of parsed.events) {
    if (e.kind === 'on') lastOnTick = e.tick;
    else if (e.kind === 'off' && lastOnTick === e.tick) {
      offAfterOnSameTick.push({ tick: e.tick, pitch: e.pitch, ch: e.ch });
    }
  }

  for (const e of parsed.events) {
    if (e.kind !== 'on' && e.kind !== 'off') continue;
    const key = `${e.ch}:${e.pitch}`;
    if (e.kind === 'on') {
      if (open.has(key)) overlapping.push({ tick: e.tick, pitch: e.pitch, ch: e.ch, openedAt: open.get(key).tick });
      open.set(key, e);
    } else {
      const on = open.get(key);
      if (!on) { orphanOff.push({ tick: e.tick, pitch: e.pitch, ch: e.ch }); continue; }
      open.delete(key);
      const note = { ch: e.ch, pitch: e.pitch, start: on.tick, end: e.tick, dur: e.tick - on.tick, vel: on.vel };
      if (note.dur <= 0) zeroLength.push(note);
      notes.push(note);
    }
  }
  const hanging = [...open.values()].map((e) => ({ tick: e.tick, pitch: e.pitch, ch: e.ch }));
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { notes, overlapping, orphanOff, zeroLength, hanging, offAfterOnSameTick };
}

/** Resumen legible para la salida del test (antes/después del arreglo). */
export function describe(parsed, a = analyzeNotes(parsed)) {
  const lines = [];
  lines.push(`ppq=${parsed.ppq} bpm=${parsed.tempoBpm?.toFixed(2)} track="${parsed.trackName}" eventos=${parsed.events.length}`);
  lines.push('  orden (tick:evento): ' + parsed.events
    .filter((e) => e.kind === 'on' || e.kind === 'off')
    .map((e) => `${e.tick}:${e.kind}${e.pitch}`).join(' '));
  lines.push(`  notas=${a.notes.length} ` + a.notes.map((n) => `[${n.pitch} ${n.start}→${n.end} (${n.dur})]`).join(' '));
  lines.push(`  off-después-de-on-en-el-mismo-tick=${a.offAfterOnSameTick.length}` +
    ` solapadas=${a.overlapping.length} colgadas=${a.hanging.length}` +
    ` duración-cero=${a.zeroLength.length} off-huérfanos=${a.orphanOff.length}`);
  return lines.join('\n');
}

/** Lista de defectos, vacía si el archivo está sano. */
export function defects(a) {
  const out = [];
  for (const d of a.offAfterOnSameTick) out.push(`note-off de ${d.pitch} en el tick ${d.tick} sale DESPUÉS de un note-on del mismo tick`);
  for (const d of a.overlapping) out.push(`nota ${d.pitch} solapada: on en ${d.tick} con una abierta desde ${d.openedAt}`);
  for (const d of a.zeroLength) out.push(`nota ${d.pitch} de duración cero en el tick ${d.start}`);
  for (const d of a.hanging) out.push(`nota ${d.pitch} colgada (on en ${d.tick} sin off)`);
  for (const d of a.orphanOff) out.push(`note-off huérfano de ${d.pitch} en el tick ${d.tick}`);
  return out;
}

function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function readVLQ(b, o) {
  let value = 0, p = o, byte;
  do {
    if (p >= b.length) throw new Error('VLQ truncado');
    byte = b[p++];
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return { value, next: p };
}
