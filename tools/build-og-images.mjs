#!/usr/bin/env node
// Genera placeholders OG (1200x630) por instrumento + uno genérico para el sitio.
// Reproducible y sin dependencias: node tools/build-og-images.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Canvas } from './lib/png.mjs';
import { drawText, textWidth, toOgSafe } from './lib/pixelfont.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));

const W = 1200, H = 630;
const BG = '#070b06';
const INK = '#ecebe5';
const MUTED = '#9fb098';
const OUT_DIR = join(ROOT, 'assets/og');
mkdirSync(OUT_DIR, { recursive: true });

function drawCard({ eyebrow, badge, name, tagline, tags, accent }) {
  const c = new Canvas(W, H, BG);
  // franja superior e inferior de acento
  c.fillRect(0, 0, W, 10, accent);
  c.fillRect(0, H - 10, W, 10, accent);
  // número de instrumento "fantasma" en la esquina, fuera del área de texto
  if (badge) {
    const num = badge.split(' ')[0];
    const s = 24;
    drawText(c, num, W - textWidth(num, s) - 64, 40, s, accent, 30);
  }
  let y = 64;
  drawText(c, toOgSafe(eyebrow), 72, y, 3, MUTED);
  y += 46;
  if (badge) {
    drawText(c, toOgSafe(badge), 72, y, 3, accent);
    y += 54;
  }
  const nameSafe = toOgSafe(name);
  const nameScale = nameSafe.length > 16 ? 5 : 6;
  drawText(c, nameSafe, 72, y, nameScale, INK);
  y += 7 * nameScale + 34;
  if (tagline) {
    drawText(c, toOgSafe(tagline), 72, y, 3, accent);
    y += 46;
  }
  if (tags && tags.length) {
    let x = 72;
    const ty = H - 72;
    for (const t of tags) {
      const label = toOgSafe(t);
      const tw = textWidth(label, 2) + 28;
      c.fillRect(x, ty - 10, tw, 36, '#0d150b');
      drawText(c, label, x + 14, ty, 2, MUTED);
      x += tw + 14;
    }
  }
  drawText(c, toOgSafe('ZERO DAY · MUSIC EXPLOITS'), 72, H - 128, 2, MUTED);
  return c;
}

for (const slug of data.order) {
  const I = data.instruments[slug];
  const c = drawCard({
    eyebrow: 'ZERO DAY · MUSIC EXPLOITS',
    badge: I.num + ' · ' + I.type,
    name: I.name,
    tagline: I.tagline.replace(/"/g, ''),
    tags: I.exporta,
    accent: I.colorHex
  });
  writeFileSync(join(OUT_DIR, slug + '.png'), c.toPNG());
  console.log('og:', slug + '.png');
}

// OG genérico para index / 404 / privacidad
{
  const c = new Canvas(W, H, BG);
  c.fillRect(0, 0, W, 10, '#7fdc5c');
  c.fillRect(0, H - 10, W, 10, '#7fdc5c');
  let y = 120;
  drawText(c, toOgSafe('ZERO DAY'), 72, y, 7, INK);
  y += 7 * 7 + 20;
  drawText(c, toOgSafe('MUSIC EXPLOITS'), 72, y, 5, '#7fdc5c');
  y += 7 * 5 + 50;
  drawText(c, toOgSafe('5 instrumentos gratis en el navegador'), 72, y, 3, MUTED);
  // swatch de los 5 acentos
  let x = 72;
  const sw = 90;
  for (const slug of data.order) {
    c.fillRect(x, H - 150, sw, 24, data.instruments[slug].colorHex);
    x += sw + 10;
  }
  writeFileSync(join(OUT_DIR, 'home.png'), c.toPNG());
  console.log('og: home.png');
}

// El favicon del sitio ya no sale de acá: son los PNG del diseño, optimizados por tools/make-site-icons.mjs.
