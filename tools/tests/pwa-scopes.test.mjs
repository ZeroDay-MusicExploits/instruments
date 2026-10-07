#!/usr/bin/env node
// tools/tests/pwa-scopes.test.mjs
//
// Los 5 manifests tienen que ser instalables por separado. Con un scope
// compartido (`"scope": "../"`, o sin `scope`, que toma la carpeta del
// `start_url`), en Android la app instalada de un instrumento capturaba los
// links a los otros 4 y Chrome no dejaba instalarlos. Cada manifest declara
// como scope **su propio archivo** (docs/pwa.md).
//
// Node puro, sin navegador. Las URLs relativas se resuelven como lo hace el
// navegador: las del manifest, contra la URL del manifest (manifests/), y el
// `<link rel="manifest">`, contra la URL del HTML. Qué exige:
//
// 1. hay 5 manifests, uno por instrumento, y cada HTML enlaza el suyo;
// 2. los `id` son distintos (el crudo y el resuelto contra el origen del
//    `start_url`, que es como los resuelve el navegador);
// 3. cada manifest declara un `scope` (sin `scope`, el navegador toma la
//    carpeta del `start_url`, que es la de los 5);
// 4. cada `start_url` es el HTML que enlaza el manifest, cae dentro de su
//    propio `scope` y fuera del `scope` de los otros 4;
// 5. ningún `scope` es prefijo de otro;
// 6. el `theme_color` de cada manifest es el <meta name="theme-color"> de su HTML.
//
// El último caso corre las mismas comprobaciones sobre manifests armados a
// mano con el defecto de antes (`"scope": "../"`) y exige que fallen.
//
//   node tools/tests/pwa-scopes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/load-block.mjs';

// El origen no importa para las comprobaciones; sí que sea el de GitHub Pages
// (bajo /instruments/) para que `..` y las rutas relativas se comporten igual.
const SITE = 'https://zeroday-musicexploits.github.io/instruments/';
const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const SLUGS = data.order;

const norm = (hex) => String(hex).trim().toLowerCase();

/** Lee, de un HTML, el href del manifest y el theme-color. */
function readPage(html) {
  const link = html.match(/<link\b[^>]*\brel=["']manifest["'][^>]*>/i);
  const href = link && link[0].match(/\bhref=["']([^"']+)["']/i);
  const meta = html.match(/<meta\b[^>]*\bname=["']theme-color["'][^>]*>/i);
  const color = meta && meta[0].match(/\bcontent=["']([^"']+)["']/i);
  return { manifestHref: href ? href[1] : null, themeColor: color ? color[1] : null };
}

/** Un instrumento del repo: su HTML, su manifest y todo resuelto como el navegador. */
function loadInstrument(slug) {
  const file = data.instruments[slug].file.replace(/^\.\//, '');
  const pageUrl = new URL(file, SITE);
  const page = readPage(readFileSync(join(ROOT, file), 'utf8'));
  assert.ok(page.manifestHref, `${file}: falta <link rel="manifest">`);
  const manifestUrl = new URL(page.manifestHref, pageUrl);
  const manifestPath = decodeURIComponent(manifestUrl.pathname.slice(new URL(SITE).pathname.length));
  const manifest = JSON.parse(readFileSync(join(ROOT, manifestPath), 'utf8'));
  return { slug, file, pageUrl, manifestPath, manifestUrl, manifest, themeColorMeta: page.themeColor };
}

/** Pasa un manifest a las URLs que el navegador usa: todo contra la URL del manifest. */
function resolve({ manifestUrl, manifest }) {
  const start = new URL(manifest.start_url, manifestUrl);
  return {
    start,
    // `id`: se resuelve contra el origen del start_url (Manifest, "id member").
    id: manifest.id === undefined ? null : new URL(manifest.id, start.origin),
    scope: manifest.scope === undefined ? null : new URL(manifest.scope, manifestUrl),
  };
}

// Una URL está dentro de un scope si el scope es prefijo de su serialización
// (sin fragmento) y son del mismo origen.
function inScope(url, scope) {
  const bare = new URL(url); bare.hash = '';
  return bare.origin === scope.origin && bare.href.startsWith(scope.href);
}

/** Todas las comprobaciones sobre un conjunto de instrumentos -> lista de problemas. */
function problems(items) {
  const out = [];
  const r = items.map((it) => ({ it, ...resolve(it) }));
  const name = (x) => x.it.slug;

  const ids = new Map();
  for (const x of r) {
    for (const key of [x.it.manifest.id, x.id && x.id.href]) {
      if (!key) continue;
      if (ids.has(key) && ids.get(key) !== name(x)) out.push(`id repetido «${key}» (${ids.get(key)} y ${name(x)})`);
      ids.set(key, name(x));
    }
    if (!x.it.manifest.id) out.push(`${name(x)}: el manifest no tiene id`);
  }

  for (const x of r) {
    if (!x.scope) { out.push(`${name(x)}: el manifest no declara scope`); continue; }
    if (x.start.href !== x.it.pageUrl.href) out.push(`${name(x)}: start_url ${x.start.href} no es su HTML (${x.it.pageUrl.href})`);
    if (!inScope(x.start, x.scope)) out.push(`${name(x)}: su start_url ${x.start.href} cae fuera de su scope ${x.scope.href}`);
    for (const y of r) {
      if (y === x || !y.scope) continue;
      if (inScope(x.start, y.scope)) out.push(`${name(x)}: su start_url cae dentro del scope de ${name(y)} (${y.scope.href})`);
    }
  }

  for (const a of r) for (const b of r) {
    if (a === b || !a.scope || !b.scope) continue;
    if (b.scope.href.startsWith(a.scope.href)) out.push(`el scope de ${name(a)} (${a.scope.href}) es prefijo del de ${name(b)} (${b.scope.href})`);
  }

  for (const x of r) {
    const color = x.it.manifest.theme_color;
    if (!color) out.push(`${name(x)}: el manifest no tiene theme_color`);
    else if (!x.it.themeColorMeta) out.push(`${name(x)}: el HTML no tiene <meta name="theme-color">`);
    else if (norm(color) !== norm(x.it.themeColorMeta)) out.push(`${name(x)}: theme_color ${color} del manifest ≠ <meta name="theme-color"> ${x.it.themeColorMeta} del HTML`);
  }
  return out;
}

const instruments = SLUGS.map(loadInstrument);

test('manifests: hay 5, uno por instrumento, y cada HTML enlaza el suyo', () => {
  assert.equal(instruments.length, 5);
  const onDisk = readdirSync(join(ROOT, 'manifests')).filter((f) => f.endsWith('.webmanifest')).sort();
  const linked = instruments.map((i) => i.manifestPath.replace(/^manifests\//, '')).sort();
  assert.deepEqual(linked, onDisk, 'cada archivo de manifests/ lo enlaza un instrumento, y a la inversa');
  assert.equal(new Set(linked).size, 5, 'dos instrumentos enlazan el mismo manifest');
});

test('manifests: id distintos, scope propio y start_url dentro de su scope y fuera de los otros 4', () => {
  const bad = problems(instruments);
  assert.deepEqual(bad.filter((p) => !/theme/.test(p)), []);
});

test('manifests: el scope de cada uno es su propio archivo y ninguno es prefijo de otro', () => {
  const scopes = instruments.map((i) => ({ slug: i.slug, scope: resolve(i).scope.href }));
  for (const { slug, scope } of scopes) {
    const own = instruments.find((i) => i.slug === slug).pageUrl.href;
    assert.equal(scope, own, `${slug}: el scope tiene que ser su HTML (${own}), no ${scope}`);
  }
  for (const a of scopes) for (const b of scopes) {
    if (a !== b) assert.ok(!b.scope.startsWith(a.scope), `el scope de ${a.slug} es prefijo del de ${b.slug}`);
  }
});

test('manifests: el theme_color de cada manifest es el <meta name="theme-color"> de su HTML', () => {
  const bad = problems(instruments).filter((p) => /theme/.test(p));
  assert.deepEqual(bad, []);
  for (const i of instruments) console.log(`  ${i.slug}: ${i.manifest.theme_color}`);
});

test('el test detecta el defecto de antes: "scope": "../" compartido', () => {
  const shared = instruments.map((i) => ({ ...i, manifest: { ...i.manifest, scope: '../' } }));
  const bad = problems(shared);
  assert.ok(bad.some((p) => /es prefijo del de/.test(p)), 'no marcó los scopes que se pisan');
  assert.ok(bad.some((p) => /cae dentro del scope de/.test(p)), 'no marcó que un start_url cae en el scope de otro');
  console.log(`  con "scope": "../" en los 5: ${bad.length} problemas (ej.: ${bad[0]})`);
});

test('el test detecta un manifest sin scope y un id repetido', () => {
  const noScope = instruments.map((i, n) => (n === 0 ? { ...i, manifest: { ...i.manifest, scope: undefined } } : i));
  assert.ok(problems(noScope).some((p) => /no declara scope/.test(p)));
  const dupId = instruments.map((i, n) => (n === 1 ? { ...i, manifest: { ...i.manifest, id: instruments[0].manifest.id } } : i));
  assert.ok(problems(dupId).some((p) => /id repetido/.test(p)));
  const theme = instruments.map((i, n) => (n === 2 ? { ...i, themeColorMeta: '#ff00ff' } : i));
  assert.ok(problems(theme).some((p) => /theme_color/.test(p)));
});
