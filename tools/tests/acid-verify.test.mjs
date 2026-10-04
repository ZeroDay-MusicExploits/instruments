#!/usr/bin/env node
// tools/tests/acid-verify.test.mjs
//
// Verificación completa de ACID BASS-303 (el piloto, ya publicado), la que hay
// que volver a pasar después de tocar un bloque compartido: viewports de SPEC
// R1, autoguardado (R3), export JSON/MIDI/WAV (R4), audio con suspend/resume
// (R5), banner de instalación (R2), `file://` e iframe (SPEC 3.2) y la rotación
// de tablet 1180×820 ↔ 820×1180 con el instrumento sonando.
//
//   node tools/tests/acid-verify.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';
import { parseSMF, analyzeNotes, defects } from './lib/smf.mjs';

const FILE = 'descargables/Acid_Bass-303.html';
const URL_PATH = '/' + FILE;
const IFRAME_PATH = '/__test-iframe.html';

/* SPEC R1: 360×640 como mínimo, más 390×844, iPad vertical 768×1024,
   landscape 844×390 y escritorio ≥1024. `shell` es lo que tiene que dar la
   media query `(pointer:coarse) and (max-width:1024px), (max-width:820px)`. */
const VIEWPORTS = [
  { width: 360, height: 640, shell: true, label: '360×640 (mínimo)' },
  { width: 390, height: 844, shell: true, label: '390×844' },
  { width: 768, height: 1024, shell: true, label: '768×1024 (iPad vertical)' },
  { width: 844, height: 390, shell: true, label: '844×390 (landscape)' },
  { width: 1440, height: 900, shell: false, label: '1440×900 (escritorio)' },
];

let srv, browser;

test.before(async () => {
  srv = await serveRoot(ROOT, {
    [IFRAME_PATH]: {
      body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>iframe</title></head>
<body style="margin:0"><iframe id="f" src="${URL_PATH}" style="width:100%;height:100vh;border:0" title="Acid"></iframe></body></html>`,
    },
  });
  const { chromium } = await loadPlaywright();
  // el AudioContext tiene que llegar a 'running' sin gesto real del usuario
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** Abre el instrumento y junta los errores de consola. */
async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true, isMobile: true, acceptDownloads: true, ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
}, sel);
const overlap = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);

/* SPEC R1: todo control de la barra superior, ≥44 px en el eje corto. Mira el
   DOM, no una lista de selectores: sirve igual para cualquier instrumento. */
const topBarUnder44 = (page) => page.evaluate(() => {
  const top = document.getElementById('zd-top');
  if (!top) return [];
  return Array.from(top.querySelectorAll('button,a,input,select'))
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((c) => c.w > 0 && c.h > 0 && Math.min(c.w, c.h) < 44);
});

// ───────────────────────────────── R1 · viewports ─────────────────────────────

for (const v of VIEWPORTS) {
  test(`Acid · ${v.label} · layout`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      const s = await page.evaluate(() => ({
        shell: !!(window.ZD && ZD.mobile && ZD.mobile.active),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        tabs: document.querySelectorAll('#zd-tabs button').length,
        stage: document.getElementById('zd-stage') ? Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean) : [],
        rotate: !!document.getElementById('zd-rotate'),
        viewport: (document.querySelector('meta[name=viewport]') || {}).content || '',
        canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
      }));
      assert.equal(s.shell, v.shell, `${v.label}: el shell tiene que estar ${v.shell ? 'activo' : 'inactivo'}`);
      assert.ok(s.scrollW <= s.clientW + 1, `${v.label}: no puede haber scroll horizontal (${s.scrollW} > ${s.clientW})`);
      assert.equal(s.rotate, false, 'no puede existir #zd-rotate (SPEC R1)');
      assert.ok(!/maximum-scale|user-scalable/.test(s.viewport), 'el meta viewport no puede traer maximum-scale ni user-scalable');
      assert.match(s.canonical, /^https:\/\/.+\/descargables\/Acid_Bass-303\.html$/, 'falta el <link rel=canonical> absoluto');

      if (v.shell) {
        assert.ok(s.tabs > 0 && s.tabs <= 5, `${v.label}: tiene que haber entre 1 y 5 tabs, hay ${s.tabs}`);
        assert.deepEqual(s.stage, ['seqPanel', 'stepEditPanel', 'perfPanel'], `${v.label}: el stage tiene que tener los 3 paneles`);
        const play = await rect(page, '#playBtn');
        const pad = await rect(page, '#xypad');
        // SPEC R1: target táctil ≥44 px en el eje corto. La barra mide 48, así
        // que 44 entra. Desde zd-mobile v4 el piso lo pone el bloque para todo
        // lo que caiga en #zd-top, venga del instrumento, de zd-pwa o de él.
        assert.ok(play.visible && play.h >= 44, `${v.label}: PLAY tiene que medir ≥44 px de alto, mide ${play.h}`);
        assert.ok(pad.visible && pad.h > 40, `${v.label}: el pad XY tiene que estar visible (${pad.h} px)`);
        const small = await topBarUnder44(page);
        assert.deepEqual(small, [], `${v.label}: controles de la barra superior por debajo de 44 px en el eje corto`);
        const tabH = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('#zd-tabs button')).map((e) => e.getBoundingClientRect().height)));
        assert.ok(tabH >= 44, `${v.label}: las tabs miden ${tabH} px de alto`);
        console.log(`  ${v.label} · shell · tabs=${s.tabs} · PLAY ${Math.round(play.h)}px · pad ${Math.round(pad.h)}px · barra ≥44 · sin scroll horizontal`);
      } else {
        console.log(`  ${v.label} · sin shell · sin scroll horizontal`);
      }
      assert.deepEqual(errors, [], `${v.label}: errores de consola`);
    } finally { await ctx.close(); }
  });
}

test('Acid · el banner de instalación no tapa PLAY ni el pad XY (360×640 y 390×844)', async () => {
  for (const v of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(v);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
      await page.waitForTimeout(150);
      const banner = await rect(page, '.zd-pwa-banner');
      assert.ok(banner && banner.visible, `${v.width}×${v.height}: el banner tiene que estar visible`);
      const first = await page.evaluate(() => { const s = document.getElementById('zd-stage'); return s && s.firstElementChild ? s.firstElementChild.className : null; });
      assert.match(String(first), /zd-pwa-banner/, 'el banner tiene que ser el primer hijo de #zd-stage');
      for (const sel of ['#playBtn', '.tempo-box', '#xypad']) {
        const r = await rect(page, sel);
        assert.ok(r && r.visible, `${v.width}×${v.height}: ${sel} tiene que seguir visible con el banner`);
        assert.ok(!overlap(banner, r), `${v.width}×${v.height}: el banner tapa ${sel}`);
      }
      // "Ahora no" lo descarta y guarda 14 días
      await page.click('.zd-pwa-banner >> text=/Ahora no/i');
      await page.waitForTimeout(100);
      const gone = await page.evaluate(() => ({ banner: !!document.querySelector('.zd-pwa-banner'), key: localStorage.getItem('zd:pwa:dismissed') }));
      assert.equal(gone.banner, false, 'el banner tiene que desaparecer con "Ahora no"');
      assert.ok(gone.key, 'tiene que quedar zd:pwa:dismissed en localStorage');
      console.log(`  ${v.width}×${v.height} · banner ${Math.round(banner.h)}px, no tapa PLAY/tempo/pad, "Ahora no" lo descarta`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

// ───────────────────────────────── R3 · autoguardado ──────────────────────────

test('Acid · autoguardado: tocar → recargar → mismo estado', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    const changed = await page.evaluate(() => {
      pattern[0].gate = 'tie'; pattern[1].note = 55; kbOct = 4;
      renderSeq(); $('#kbOctVal').textContent = kbOct; markDirty();
      return { gate0: pattern[0].gate, note1: pattern[1].note, kbOct };
    });
    await page.waitForTimeout(2000);                   // debounce de 1,5 s + margen
    const stored = await page.evaluate(async () => {
      const env = await ZD.store.open({ slug: 'acid-bass', app: 'acid-bass-303', version: 1, enabled: false }).load();
      return env && { app: env.app, version: env.version, hasData: !!env.data };
    });
    assert.deepEqual(stored, { app: 'acid-bass-303', version: 1, hasData: true }, 'el envoltorio guardado tiene que ser { app, version, savedAt, data }');

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('text=Sesión restaurada', { timeout: 6000 });
    const after = await page.evaluate(() => ({ gate0: pattern[0].gate, note1: pattern[1].note, kbOct }));
    console.log(`  guardado ${JSON.stringify(changed)} → restaurado ${JSON.stringify(after)} (+ toast)`);
    assert.deepEqual(after, changed, 'el estado tiene que volver igual después de recargar');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── R4 · exports ───────────────────────────────

test('Acid · export JSON / MIDI / WAV', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.evaluate(() => ZD.mobile.open('exp'));
    await page.waitForTimeout(150);

    const grab = async (fn, timeout = 60000) => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), fn()]);
      return { name: dl.suggestedFilename(), buf: readFileSync(await dl.path()) };
    };

    const json = await grab(() => page.click('#saveJson'));
    assert.match(json.name, /^acid-bass-\d{8}-\d{4}\.json$/, `nombre del JSON: ${json.name}`);
    const obj = JSON.parse(json.buf.toString('utf8'));
    // envoltorio { app, version, savedAt, data } (SPEC R4)
    assert.equal(obj.app, 'acid-bass-303');
    assert.equal(typeof obj.version, 'number');
    assert.match(String(obj.savedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(obj.data && obj.data.params, 'el JSON tiene que traer los parámetros en .data');
    assert.ok(Array.isArray(obj.data.pattern) && obj.data.pattern.length === 16, 'el JSON tiene que traer los 16 pasos');

    const midi = await grab(() => page.click('#expMidi'));
    assert.match(midi.name, /^acid-bass-\d{8}-\d{4}\.mid$/, `nombre del MIDI: ${midi.name}`);
    const parsed = parseSMF(midi.buf);
    const an = analyzeNotes(parsed);
    assert.equal(parsed.format, 0, 'SMF formato 0');
    assert.ok(an.notes.length > 0, 'el MIDI tiene que traer notas');
    assert.deepEqual(defects(an), [], 'el MIDI exportado tiene que estar sano (orden, solapes, duración)');

    await page.selectOption('#barsSel', '1');
    const wav = await grab(async () => {
      await page.click('#expWav');
      await page.waitForSelector('#wavResult audio', { timeout: 60000 });
      await page.click('#wavResult >> text=/DESCARGAR WAV/i');
    });
    assert.match(wav.name, /^acid-bass-\d{8}-\d{4}\.wav$/, `nombre del WAV: ${wav.name}`);
    assert.equal(wav.buf.subarray(0, 4).toString('latin1'), 'RIFF', 'el WAV tiene que ser RIFF');
    assert.equal(wav.buf.subarray(8, 12).toString('latin1'), 'WAVE');
    assert.equal(wav.buf.readUInt16LE(34), 16, 'PCM 16-bit');
    assert.ok(wav.buf.length > 100000, `el WAV tiene que tener audio, tiene ${wav.buf.length} bytes`);

    // ida y vuelta: el JSON exportado tiene que volver a abrir en el instrumento
    const jsonPath = join(tmpdir(), `zd-acid-${process.pid}.json`);
    writeFileSync(jsonPath, json.buf);
    await page.evaluate(() => { pattern[3].note = 99; renderSeq(); });
    page.once('filechooser', (fc) => fc.setFiles(jsonPath));
    await page.click('#loadJson');
    await page.waitForTimeout(400);
    const roundTrip = await page.evaluate(() => pattern.map((st) => st.note));
    assert.deepEqual(roundTrip, obj.data.pattern.map((st) => st.note), 'el JSON exportado tiene que volver a abrir igual');
    rmSync(jsonPath, { force: true });

    console.log(`  ${json.name} ${json.buf.length}B (ida y vuelta ok) · ${midi.name} ${midi.buf.length}B (${an.notes.length} notas, sin defectos) · ${wav.name} ${wav.buf.length}B`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── R5 · audio ─────────────────────────────────

test('Acid · audio: destrabar, sonar, suspend y resume', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.click('#playBtn');
    await page.waitForTimeout(600);
    const on = await page.evaluate(() => ({ state: Engine.ctx.state, sr: Engine.ctx.sampleRate, playing: Seq.playing, unlocked: ZD.audio.unlocked, step: Seq.current }));
    assert.equal(on.state, 'running', 'el AudioContext tiene que quedar en running después del gesto');
    assert.equal(on.playing, true);
    assert.equal(on.unlocked, true, 'ZD.audio.unlock() tiene que haber corrido dentro del gesto');

    await page.waitForTimeout(500);
    const adv = await page.evaluate(() => Seq.current);
    assert.notEqual(adv, on.step, 'el secuenciador tiene que avanzar');

    await page.evaluate(() => Engine.ctx.suspend());
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => Engine.ctx.state), 'suspended');

    await page.evaluate(() => ZD.audio.resume());
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ state: Engine.ctx.state, playing: Seq.playing }));
    assert.equal(back.state, 'running', 'ZD.audio.resume() tiene que devolver el contexto a running');
    assert.equal(back.playing, true, 'el secuenciador tiene que seguir en play');

    // suspender y volver por visibilitychange (iOS: segundo plano y volver)
    await page.evaluate(() => Engine.ctx.suspend());
    await page.waitForTimeout(100);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(400);
    const vis = await page.evaluate(() => Engine.ctx.state);
    console.log(`  ${on.sr} Hz · running → suspended → resume() → ${back.state} · visibilitychange → ${vis}`);
    assert.equal(vis, 'running', 'volver a la pestaña tiene que reanudar el contexto');

    await page.click('#playBtn');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => Seq.playing), false, 'el segundo click tiene que parar');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ──────────────── rotación de tablet con el instrumento sonando ───────────────

test('Acid · rotación de tablet 1180×820 ↔ 820×1180 con el instrumento sonando', async () => {
  const { ctx, page, errors } = await open({ width: 1180, height: 820 });
  try {
    await page.click('#playBtn');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => Engine.ctx.state), 'running');
    const t0 = await page.evaluate(() => Engine.ctx.currentTime);

    const seen = [];
    for (let i = 1; i <= 4; i++) {
      for (const v of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
        await page.setViewportSize(v);
        await page.waitForTimeout(220);
        const s = await page.evaluate(() => ({
          shell: !!(ZD.mobile && ZD.mobile.active),
          stage: document.getElementById('zd-stage') ? Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean) : [],
          state: Engine.ctx.state, playing: Seq.playing, step: Seq.current,
          time: Engine.ctx.currentTime,
          scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
          playVisible: (() => { const r = document.getElementById('playBtn').getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
          padVisible: (() => { const r = document.getElementById('xypad').getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
        }));
        seen.push({ v, s });
        const where = `vuelta ${i} · ${v.width}×${v.height}`;
        assert.equal(s.state, 'running', `${where}: el audio no puede cortarse al rotar`);
        assert.equal(s.playing, true, `${where}: el secuenciador tiene que seguir en play`);
        assert.equal(s.shell, v.width === 820, `${where}: el shell tiene que estar ${v.width === 820 ? 'activo' : 'inactivo'}`);
        assert.ok(s.playVisible, `${where}: PLAY tiene que estar visible`);
        assert.ok(s.padVisible, `${where}: el pad XY tiene que estar visible`);
        assert.ok(s.scrollW <= s.clientW + 1, `${where}: no puede haber scroll horizontal`);
        if (s.shell) assert.deepEqual(s.stage, ['seqPanel', 'stepEditPanel', 'perfPanel'], `${where}: el stage se quedó vacío al volver a entrar`);
        else assert.deepEqual(s.stage, [], `${where}: el stage tiene que quedar vacío fuera del shell`);
      }
    }
    const t1 = await page.evaluate(() => Engine.ctx.currentTime);
    assert.ok(t1 > t0, 'el reloj del AudioContext tiene que haber avanzado');
    // el patrón sigue corriendo: el paso cambió en el camino
    assert.ok(new Set(seen.map((r) => r.s.step)).size > 1, 'el secuenciador tiene que haber avanzado entre rotaciones');
    console.log(`  8 rotaciones sonando · ctx.currentTime ${t0.toFixed(2)} → ${t1.toFixed(2)} · pasos vistos ${[...new Set(seen.map((r) => r.s.step))].join(',')}`);
    assert.deepEqual(errors, [], 'errores de consola al rotar');
  } finally { await ctx.close(); }
});

// ─────────────────────────── SPEC 3.2 · file:// e iframe ──────────────────────

test('Acid · file://: sin service worker, sin manifest, con el aviso del archivo local', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()); });
  try {
    await page.goto(pathToFileURL(join(ROOT, FILE)).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({
      protocol: location.protocol,
      active: ZD.pwa.active, registered: ZD.pwa.registered,
      controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      local: !!document.querySelector('.zd-pwa-local'),
      openWeb: (() => { const a = document.querySelector('.zd-pwa-local a'); return a ? a.getAttribute('href') : null; })(),
    }));
    assert.equal(s.protocol, 'file:');
    assert.equal(s.active, false, 'ZD.pwa.active tiene que ser false en file://');
    assert.equal(s.registered, false, 'no se puede registrar el service worker en file://');
    assert.equal(s.controller, false);
    assert.equal(s.local, true, 'tiene que salir el aviso del archivo local');
    assert.match(String(s.openWeb), /^https:\/\/.+Acid_Bass-303\.html$/, '[Abrir web] tiene que ir al canonical');
    assert.deepEqual(requests, [], `no puede haber pedidos de red en file://: ${requests.join(', ')}`);
    console.log(`  file:// · SW no registrado · aviso local con [Abrir web] → ${s.openWeb} · 0 pedidos de red`);
    assert.deepEqual(errors, [], 'errores de consola en file://');
  } finally { await ctx.close(); }
});

test('Acid · hosted: el service worker se registra y zd-pwa queda activo', async () => {
  // 127.0.0.1 es contexto seguro: es la rama http(s) + top window + HEAD al
  // manifest OK de SPEC 3.2, la misma que corre en GitHub Pages.
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.ZD && ZD.pwa && ZD.pwa.registered, null, { timeout: 15000 });
    const s = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return {
        active: ZD.pwa.active, registered: ZD.pwa.registered, manifest: ZD.pwa.manifest,
        scopes: regs.map((r) => r.scope), scripts: regs.map((r) => (r.active || r.installing || r.waiting).scriptURL),
      };
    });
    assert.equal(s.active, true, 'ZD.pwa.active tiene que ser true sobre http');
    assert.equal(s.registered, true, 'el service worker tiene que quedar registrado');
    assert.match(s.manifest, /manifests\/acid-bass\.webmanifest$/, `manifest usado: ${s.manifest}`);
    assert.equal(s.scopes.length, 1, `tiene que haber un solo SW registrado, hay ${s.scopes.length}`);
    assert.match(s.scripts[0], /\/sw\.js$/, 'el SW tiene que ser el sw.js de la raíz');
    assert.match(s.scopes[0], /\/$/, `el scope tiene que ser la raíz del sitio: ${s.scopes[0]}`);
    console.log(`  hosted · SW ${s.scripts[0]} con scope ${s.scopes[0]} · manifest ${s.manifest}`);
    assert.deepEqual(errors, [], 'errores de consola sobre http');
  } finally { await ctx.close(); }
});

test('Acid · iframe: zd-pwa inerte, sin banner y sin errores', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(srv.origin + IFRAME_PATH, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const frame = page.frames().find((f) => f.url().includes('Acid_Bass-303.html'));
    assert.ok(frame, 'tiene que haber un iframe con el instrumento');
    const s = await frame.evaluate(() => ({
      top: window.top === window,
      active: ZD.pwa.active, registered: ZD.pwa.registered,
      banner: !!document.querySelector('.zd-pwa-banner, .zd-pwa-local'),
      css: !!document.getElementById('zd-pwa-css'),
      shell: !!(ZD.mobile && ZD.mobile.active),
    }));
    assert.equal(s.top, false, 'el instrumento tiene que estar dentro de un iframe');
    assert.equal(s.active, false, 'ZD.pwa.active tiene que ser false en un iframe');
    assert.equal(s.registered, false, 'no se registra el SW dentro de un iframe');
    assert.equal(s.banner, false, 'no puede haber banner dentro de un iframe');
    assert.equal(s.css, false, 'zd-pwa no puede inyectar CSS dentro de un iframe');
    console.log(`  iframe · ZD.pwa inerte (active=false, 0 banner, 0 CSS) · shell=${s.shell} · 0 errores`);
    assert.deepEqual(errors, [], 'errores de consola en el iframe');
  } finally { await ctx.close(); }
});
