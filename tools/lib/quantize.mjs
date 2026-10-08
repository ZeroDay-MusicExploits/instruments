// Cuantizador de color por median cut, sin dependencias, con alfa. Lo usan
// tools/make-favicons.mjs y tools/make-site-icons.mjs (con encodeIndexedPNG de png.mjs).
//
//   const { palette, indices } = quantize(rgba, maxColors, { keep: [[r, g, b, a], …] });
//
// - `rgba`: Buffer/Uint8Array RGBA, 4 bytes por píxel.
// - `keep`: colores que tienen que quedar EXACTOS en la paleta (por ejemplo el acento del
//   favicon, cuyo píxel (0,0) lo comprueba un test). Ocupan las primeras entradas, y los
//   píxeles que ya son de ese color no se tocan.
// - Es determinista: los empates se desempatan por el color, no por el orden de un Map.
//
// Distancia: euclidiana en R, G, B y alfa. Los píxeles totalmente transparentes se
// normalizan a (0,0,0,0) (su RGB no se ve) y cuentan como un solo color.

const key = (r, g, b, a) => ((r * 256 + g) * 256 + b) * 256 + a;

/** Colores únicos con su cantidad de píxeles: [{ c: [r,g,b,a], n }] ordenados por color. */
function histogram(rgba) {
  const map = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    const c = a === 0 ? [0, 0, 0, 0] : [rgba[i], rgba[i + 1], rgba[i + 2], a];
    const k = key(...c);
    const e = map.get(k);
    if (e) e.n++; else map.set(k, { k, c, n: 1 });
  }
  return [...map.values()].sort((x, y) => x.k - y.k);
}

function splitBoxes(entries, count) {
  const boxes = [entries];
  const range = (box) => {
    const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
    for (const { c } of box) for (let ch = 0; ch < 4; ch++) { if (c[ch] < lo[ch]) lo[ch] = c[ch]; if (c[ch] > hi[ch]) hi[ch] = c[ch]; }
    const span = hi.map((h, ch) => h - lo[ch]);
    const widest = span.indexOf(Math.max(...span));
    return { widest, size: span[widest] };
  };
  while (boxes.length < count) {
    // se parte la caja con más píxeles de las que todavía tienen colores distintos
    let pick = -1, score = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const pop = box.reduce((s, e) => s + e.n, 0) * range(box).size;
      if (pop > score) { score = pop; pick = i; }
    });
    if (pick < 0) break;
    const box = boxes[pick];
    const { widest } = range(box);
    const sorted = [...box].sort((x, y) => x.c[widest] - y.c[widest] || x.k - y.k);
    const half = sorted.reduce((s, e) => s + e.n, 0) / 2;
    let acc = 0, cut = 0;
    for (; cut < sorted.length - 1; cut++) { acc += sorted[cut].n; if (acc >= half) { cut++; break; } }
    cut = Math.min(Math.max(cut, 1), sorted.length - 1);
    boxes.splice(pick, 1, sorted.slice(0, cut), sorted.slice(cut));
  }
  return boxes;
}

function average(box) {
  let n = 0; const sum = [0, 0, 0, 0];
  for (const { c, n: w } of box) { n += w; for (let ch = 0; ch < 4; ch++) sum[ch] += c[ch] * w; }
  return sum.map((s) => Math.round(s / n));
}

export function quantize(rgba, maxColors, { keep = [] } = {}) {
  const fixed = keep.map((c) => [c[0], c[1], c[2], c[3] === undefined ? 255 : c[3]]);
  const fixedKeys = new Set(fixed.map((c) => key(...c)));
  const hist = histogram(rgba);
  const free = hist.filter((e) => !fixedKeys.has(e.k));
  const room = maxColors - fixed.length;
  if (room < 0) throw new Error('hay más colores reservados que lugar en la paleta');

  let palette = [...fixed];
  if (free.length <= room) palette = palette.concat(free.map((e) => e.c));
  else if (room > 0) palette = palette.concat(splitBoxes(free, room).map(average));

  // cada color único va a la entrada más cercana (los reservados, a sí mismos)
  const lookup = new Map();
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2;
  for (const e of hist) {
    let best = 0, bd = Infinity;
    palette.forEach((p, i) => { const d = dist(p, e.c); if (d < bd) { bd = d; best = i; } });
    lookup.set(e.k, best);
  }
  const indices = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const a = rgba[i + 3];
    indices[p] = lookup.get(a === 0 ? key(0, 0, 0, 0) : key(rgba[i], rgba[i + 1], rgba[i + 2], a));
  }
  return { palette, indices };
}

/** Error entre dos RGBA del mismo tamaño: { max, mean } del canal más desviado por píxel (0–255). */
export function pixelError(a, b) {
  let max = 0, sum = 0; const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const t = Math.max(a[i + 3], b[i + 3]);
    let d = Math.abs(a[i + 3] - b[i + 3]);
    // el RGB solo importa donde hay algo que ver
    if (t > 0) for (let ch = 0; ch < 3; ch++) d = Math.max(d, Math.abs(a[i + ch] - b[i + ch]));
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / n };
}
