// Arma una página mínima con las copias canónicas de tools/blocks/ (no las que
// están pegadas en un instrumento), para testear un bloque antes de
// sincronizarlo. Los bloques van en el orden de docs/zd-blocks.md y, si se pasa
// `zdm`, el `window.ZD_M` va justo antes de zd-mobile. Sin dependencias.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readBlock } from './load-block.mjs';

const ORDER = ['zd-ui', 'zd-store', 'zd-audio', 'zd-dl', 'zd-midi', 'zd-rec', 'zd-mobile', 'zd-pwa'];

/** Versión del delimitador de la copia canónica: 'zd-rec' -> '2'. */
export const blockVersion = (name) => readBlock(name).version;

/** -> HTML de la página. `zdm` es el texto JS del objeto (puede tener funciones). */
export function blockPage({ blocks, zdm = null, head = '', body = '', title = 'zd-test' }) {
  for (const b of blocks) if (!ORDER.includes(b)) throw new Error(`no es un bloque ZD: ${b}`);
  const parts = [];
  for (const b of ORDER.filter((x) => blocks.includes(x))) {
    if (b === 'zd-mobile' && zdm) parts.push(`<script>window.ZD_M = ${zdm};</script>`);
    parts.push(readFileSync(join(ROOT, 'tools', 'blocks', `${b}.html`), 'utf8'));
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>${head}
${parts.join('\n')}
</head><body>${body}</body></html>`;
}
