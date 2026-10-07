#!/usr/bin/env node
// Generador estático del sitio (no de los instrumentos). Lee data/instrumentos.json,
// renderiza con las plantillas de templates/ y escribe los .html a la raíz del repo,
// en las mismas rutas/URLs de siempre. node tools/build-site.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildIndexPage } from '../templates/index.mjs';
import { buildLandingPage } from '../templates/landing.mjs';
import { buildPrivacidadPage } from '../templates/privacidad.mjs';
import { build404Page } from '../templates/404.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));

// Lo que se escribió en esta corrida, para que el sitemap sepa qué páginas cambiaron.
const pages = {};

function write(relPath, content) {
  writeFileSync(join(ROOT, relPath), content);
  pages[relPath] = content;
  console.log('build:', relPath, `(${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
}

write('index.html', buildIndexPage(data));
for (const slug of data.order) {
  write(data.instruments[slug].page, buildLandingPage(data, slug));
}
write('privacidad.html', buildPrivacidadPage(data));
write('404.html', build404Page(data));
write('sitemap.xml', buildSitemap(data, pages));
write('robots.txt', buildRobots(data));

console.log('listo.');

// El <lastmod> de cada URL solo se mueve cuando cambia la página: junto a cada una
// queda un comentario con el hash de su contenido; si el hash de esta corrida es el
// de la anterior se conserva la fecha, y si no (o si la URL es nueva) pasa a hoy.
// Sin comentario previo (sitemap de antes de este cambio) se conserva la fecha y se
// siembra el hash: así correr el build sin tocar nada deja el archivo igual.
// El resultado depende solo de las páginas y del sitemap anterior, no del día.
function buildSitemap(data, pages) {
  const today = new Date().toISOString().slice(0, 10);
  const prev = existsSync(join(ROOT, 'sitemap.xml')) ? readFileSync(join(ROOT, 'sitemap.xml'), 'utf8') : '';
  const before = {};
  for (const m of prev.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>(?:\s*<!-- sha256:([0-9a-f]+) -->)?\s*<\/url>/g)) {
    before[m[1]] = { lastmod: m[2], hash: m[3] || null };
  }
  const paths = ['', ...data.order.map((s) => data.instruments[s].page), 'privacidad.html'];
  const urls = paths
    .map((p) => {
      const loc = `${data.site.baseUrl}${p}`;
      const hash = createHash('sha256').update(pages[p || 'index.html']).digest('hex').slice(0, 16);
      const old = before[loc];
      const lastmod = old && (old.hash === null || old.hash === hash) ? old.lastmod : today;
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <!-- sha256:${hash} -->\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildRobots(data) {
  return `User-agent: *\nAllow: /\nDisallow: /legacy/\n\nSitemap: ${data.site.baseUrl}sitemap.xml\n`;
}
