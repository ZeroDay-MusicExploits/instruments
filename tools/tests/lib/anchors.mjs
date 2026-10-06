// Para los tests del sitio: cuenta <a> anidados sobre el texto de la página.
// El parser del navegador los desarma en silencio (un <a> dentro de otro cierra
// el primero), así que en el DOM ya no se ven: hay que mirar el HTML generado.

/** Profundidad máxima de <a> abiertos a la vez (1 = sin anidar). */
export function maxAnchorDepth(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  let depth = 0, max = 0;
  for (const m of body.matchAll(/<a(?=[\s>])[^>]*>|<\/a\s*>/gi)) {
    depth += m[0][1] === '/' ? -1 : 1;
    max = Math.max(max, depth);
  }
  return max;
}
