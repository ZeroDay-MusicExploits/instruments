// Convierte oklch(L C H) -> #rrggbb (sRGB). Fórmulas de referencia: Björn Ottosson / CSS Color 4.
export function oklchToHex(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b2 = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const f = (x) => {
    x = Math.min(1, Math.max(0, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };
  r = f(r); g = f(g); b2 = f(b2);
  const to255 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return '#' + hex(to255(r)) + hex(to255(g)) + hex(to255(b2));
}

// Acepta "oklch(.82 .16 80)" o "#rrggbb" y devuelve siempre un hex.
export function toHex(cssColor) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(cssColor.trim());
  if (!m) return cssColor;
  return oklchToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
}
