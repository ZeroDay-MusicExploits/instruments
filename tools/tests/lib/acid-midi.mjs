// Saca de descargables/Acid_Bass-303.html el código real que arma el MIDI del
// patrón (buildMIDI y los helpers del patrón) y lo corre en un sandbox junto al
// bloque zd-midi. Así el test exporta el MIDI con el mismo código que el
// instrumento publicado, sin navegador y sin copiarlo a mano.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT, readBlock } from './load-block.mjs';

const FNS = ['makeStep', 'parseStep', 'pat', 'patNote', 'buildMIDI'];
const CONSTS = [/^const STEPS=\d+, BASE_MIDI=\d+;$/m, /^const clamp=.*$/m, /^const MIDI_TRACK_NAME=.*$/m];

/** Extrae `function <name>(...){...}` balanceando llaves. */
function fn(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(`no encontré function ${name}() en el instrumento`);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`function ${name}() sin cerrar`);
}

/** Devuelve { ZD, pat, buildMIDI, Seq, setPattern } con el código real de Acid. */
export function loadAcidMidi(file = 'descargables/Acid_Bass-303.html') {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const pieces = [];
  for (const re of CONSTS) {
    const m = src.match(re);
    if (!m) throw new Error(`no encontré ${re} en ${file}`);
    pieces.push(m[0]);
  }
  for (const name of FNS) pieces.push(fn(src, name));

  const win = { navigator: { userAgent: 'node-test', maxTouchPoints: 0 }, Blob, Math, Date, JSON, console, parseInt, isNaN };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(readBlock('zd-midi').text, ctx, { filename: 'tools/blocks/zd-midi.html' });
  vm.runInContext(
    'var pattern = [], patternOct = 0, Seq = { bpm: 130 };\n' + pieces.join('\n') + '\n',
    ctx, { filename: `${file} (buildMIDI)` }
  );

  return {
    ZD: win.ZD,
    get Seq() { return win.Seq; },
    /** Carga un patrón en la notación de Acid ("0 ~ 0") y exporta el MIDI. */
    exportPattern(notation, bpm = 130) {
      return vm.runInContext(
        `pattern = pat(${JSON.stringify(notation)}); Seq.bpm = ${+bpm}; buildMIDI();`,
        ctx, { filename: `${file} (export)` }
      );
    },
  };
}
