// Carga un bloque ZD (tools/blocks/<nombre>.html) en un sandbox de Node, para
// poder testear la lógica pura (zd-midi) sin navegador. Sin dependencias.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Devuelve el texto del bloque `<nombre>` tal como está delimitado en `source`. */
export function extractBlock(source, name) {
  const open = source.match(new RegExp('/\\* ZD-BLOCK:' + name.replace(/[-]/g, '\\-') + ' v(\\d+) \\*/'));
  const closeTag = `/* /ZD-BLOCK:${name} */`;
  const closeAt = source.indexOf(closeTag);
  if (!open || closeAt === -1) throw new Error(`no encontré el bloque ${name}`);
  return { text: source.slice(open.index, closeAt + closeTag.length), version: open[1] };
}

export function readBlock(name) {
  return extractBlock(readFileSync(join(ROOT, 'tools', 'blocks', `${name}.html`), 'utf8'), name);
}

/** Corre el bloque en un contexto mínimo y devuelve { ZD, ctx, version }. */
export function loadBlock(name, { userAgent = 'node-test', maxTouchPoints = 0 } = {}) {
  const { text, version } = readBlock(name);
  const win = {
    navigator: { userAgent, maxTouchPoints },
    Blob, Uint8Array, Math, Date, JSON, console,
  };
  win.window = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(text, ctx, { filename: `tools/blocks/${name}.html` });
  return { ZD: win.ZD, ctx, version };
}

export async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
