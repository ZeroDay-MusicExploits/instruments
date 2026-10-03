#!/usr/bin/env node
// Generador estático del sitio (no de los instrumentos). Lee data/instrumentos.json,
// renderiza con las plantillas de templates/ y escribe los .html a la raíz del repo,
// en las mismas rutas/URLs de siempre. node tools/build-site.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildIndexPage } from '../templates/index.mjs';
import { buildLandingPage } from '../templates/landing.mjs';
import { buildPrivacidadPage } from '../templates/privacidad.mjs';
import { build404Page } from '../templates/404.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));

function write(relPath, content) {
  writeFileSync(join(ROOT, relPath), content);
  console.log('build:', relPath, `(${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
}

write('index.html', buildIndexPage(data));
for (const slug of data.order) {
  write(data.instruments[slug].page, buildLandingPage(data, slug));
}
write('privacidad.html', buildPrivacidadPage(data));
write('404.html', build404Page(data));

console.log('listo.');
