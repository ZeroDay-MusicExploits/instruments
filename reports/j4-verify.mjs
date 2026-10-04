#!/usr/bin/env node
// reports/j4-verify.mjs
//
// Verificación completa de J4-Sirens Station (reports/j4.md). Es una
// adaptación de tools/tests/acid-verify.test.mjs más lo propio de J4:
// viewports de SPEC R1 (pad XY ≥60 % del alto útil), banner de instalación con
// un beforeinstallprompt sintético (prompt() una sola vez, "Ahora no" por 14
// días, standalone, iframe y file://), autoguardado y migración de los slots
// (R3), export JSON / MIDI / WAV (R4), audio con suspend/resume (R5), rotación
// de tablet 1180×820 ↔ 820×1180 con la sirena sonando, pad XY + SIREN con dos
// dedos a la vez, scroll táctil donde corresponde, service worker sobre http y
// un hub C2 falso (el adaptador sigue registrando y arrancando sin gesto).
//
// Vive en reports/ y no en tools/tests/ porque tools/ lo maneja la sesión D.
// Usa sin modificar el servidor y el parser SMF de tools/tests/lib/.
//
//   node reports/j4-verify.mjs
//   node reports/j4-verify.mjs --shots <carpeta>    # además guarda capturas
//
// Necesita Playwright + Chromium (no es dependencia del runtime):
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';
import { parseSMF, analyzeNotes, defects } from '../tools/tests/lib/smf.mjs';

const FILE = 'descargables/J4-Sirens_Station.html';
const URL_PATH = '/' + FILE;
const IFRAME_PATH = '/__test-iframe.html';
const HUB_PATH = '/__test-hub.html';
const KEEP = ['xypad', 'perfDeck'];
const argv = process.argv.slice(2);
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* SPEC R1: 360×640 como mínimo, más 390×844, 430×932, iPad vertical 768×1024,
   landscape 844×390 y escritorio ≥1024. `pad60`: en los teléfonos verticales
   el pad tiene que llevarse el 60 % del alto útil (SPEC 3.4). */
const VIEWPORTS = [
  { width: 360, height: 640, shell: true, pad60: true, label: '360×640 (mínimo)' },
  { width: 390, height: 844, shell: true, pad60: true, label: '390×844' },
  { width: 430, height: 932, shell: true, pad60: true, label: '430×932' },
  { width: 768, height: 1024, shell: true, pad60: true, label: '768×1024 (iPad vertical)' },
  { width: 844, height: 390, shell: true, pad60: true, label: '844×390 (landscape)' },
  { width: 1440, height: 900, shell: false, label: '1440×900 (escritorio)' },
];

let srv, browser;

test.before(async () => {
  srv = await serveRoot(ROOT, {
    [IFRAME_PATH]: {
      body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>iframe</title></head>
<body style="margin:0"><iframe id="f" src="${URL_PATH}" style="width:390px;height:100vh;border:0" title="J4"></iframe></body></html>`,
    },
    // hub C2 mínimo: lo que el adaptador usa (apiVersion, ctx, registerInstrument, transport.bpm)
    [HUB_PATH]: {
      body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>hub</title><script>
window.C2 = { apiVersion: 1, ctx: new AudioContext(), registered: [], transport: { bpm: 100, play(){}, stop(){} },
  registerInstrument(api){ this.registered.push(api); const g = this.ctx.createGain(); g.connect(this.ctx.destination); return g; } };
</script></head><body style="margin:0"><iframe name="c2slot:j4test" src="${URL_PATH}" style="width:1200px;height:800px;border:0" title="J4"></iframe></body></html>`,
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
async function open(viewport, opts = {}, { init } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true, isMobile: viewport.width < 1200, acceptDownloads: true, ...opts,
  });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}
/** Primer toque: enciende el audio (overlay "TOCÁ PARA ENCENDER"). */
async function powerOn(page) {
  await page.click('#power');
  await page.waitForFunction(() => !document.getElementById('power') && typeof ctx !== 'undefined' && ctx && ctx.state === 'running', null, { timeout: 8000 });
}

const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
}, sel);
const overlap = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
const topBarUnder44 = (page) => page.evaluate(() => {
  const top = document.getElementById('zd-top');
  if (!top) return [];
  return Array.from(top.querySelectorAll('button,a,input,select'))
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((c) => c.w > 0 && c.h > 0 && Math.min(c.w, c.h) < 44);
});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };

/* beforeinstallprompt sintético con prompt()/userChoice propios que cuentan. */
const FIRE_BIP = () => {
  window.__prompts = 0;
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompts++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
  window.dispatchEvent(e);
};
const touchPoint = (x, y, id = 0) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
async function swipe(cdp, x, y0, y1, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(x, y0)] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(x, y0 + (y1 - y0) * i / steps)] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [touchPoint(x, y1)] });
  await new Promise((r) => setTimeout(r, 400));
}

// ───────────────────────────────── R1 · viewports ─────────────────────────────

for (const v of VIEWPORTS) {
  test(`J4 · ${v.label} · layout`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      await shot(page, `j4-${v.width}x${v.height}-overlay`);
      await powerOn(page);
      const s = await page.evaluate(() => ({
        shell: !!(window.ZD && ZD.mobile && ZD.mobile.active),
        scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
        tabs: document.querySelectorAll('#zd-tabs button').length,
        stage: document.getElementById('zd-stage') ? Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean) : [],
        rotate: !!document.getElementById('zd-rotate'),
        viewport: (document.querySelector('meta[name=viewport]') || {}).content || '',
        canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
        bodyTouch: getComputedStyle(document.body).touchAction,
        util: innerHeight,
      }));
      assert.equal(s.shell, v.shell, `${v.label}: el shell tiene que estar ${v.shell ? 'activo' : 'inactivo'}`);
      assert.ok(s.scrollW <= s.clientW + 1, `${v.label}: no puede haber scroll horizontal (${s.scrollW} > ${s.clientW})`);
      assert.equal(s.rotate, false, 'no puede existir #zd-rotate (SPEC R1)');
      assert.ok(!/maximum-scale|user-scalable/.test(s.viewport), 'el meta viewport no puede traer maximum-scale ni user-scalable');
      assert.match(s.canonical, /^https:\/\/.+\/descargables\/J4-Sirens_Station\.html$/, 'falta el <link rel=canonical> absoluto');
      assert.equal(s.bodyTouch, 'manipulation', 'body tiene que ser touch-action:manipulation (el bug era none)');
      const surf = await page.evaluate(() => ['#xypad', '#bigTrig', '.scopewrap'].map((q) => getComputedStyle(document.querySelector(q)).touchAction));
      assert.deepEqual(surf, ['none', 'none', 'none'], 'pad XY, SIREN y visualizador con touch-action:none');

      const pad = await rect(page, '#xypad'), siren = await rect(page, '#bigTrig');
      assert.ok(pad.visible && siren.visible, `${v.label}: pad XY y SIREN visibles`);
      if (v.shell) {
        assert.ok(s.tabs > 0 && s.tabs <= 5, `${v.label}: entre 1 y 5 tabs, hay ${s.tabs}`);
        assert.deepEqual(s.stage, KEEP, `${v.label}: el stage tiene que tener el pad y el deck`);
        const throws = await page.evaluate(() => [...document.querySelectorAll('#perfDeck .throwbtn')].map((b) => { const r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }));
        const latch = await rect(page, '#latchBtn');
        assert.ok(throws.every((t) => t >= 44), `${v.label}: los throws tienen que medir ≥44 px en el eje corto (${throws})`);
        assert.ok(Math.min(latch.w, latch.h) >= 44, `${v.label}: LATCH ≥44 px`);
        assert.ok(Math.min(siren.w, siren.h) >= 80, `${v.label}: SIREN grande (${Math.round(siren.w)}×${Math.round(siren.h)})`);
        const pct = pad.h / s.util;
        if (v.pad60) assert.ok(pct >= 0.595, `${v.label}: el pad XY tiene que llevarse el 60 % del alto útil, tiene ${(pct * 100).toFixed(1)} %`);
        assert.deepEqual(await topBarUnder44(page), [], `${v.label}: controles de la barra superior por debajo de 44 px`);
        const tabH = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('#zd-tabs button')).map((e) => e.getBoundingClientRect().height)));
        assert.ok(tabH >= 44, `${v.label}: las tabs miden ${tabH} px de alto`);
        // SIREN y los throws al alcance del pulgar: abajo en vertical, a la derecha en landscape
        if (v.width < v.height) assert.ok(siren.y > pad.y + pad.h - 1, `${v.label}: SIREN va debajo del pad`);
        else assert.ok(siren.x > pad.x + pad.w - 1, `${v.label}: SIREN va a la derecha del pad`);
        console.log(`  ${v.label} · shell · pad ${Math.round(pad.w)}×${Math.round(pad.h)} (${(pct * 100).toFixed(0)} % del alto) · SIREN ${Math.round(siren.w)}×${Math.round(siren.h)} · throws ${throws.join('/')} px · barra ≥44`);
        // sheet en peek: la zona de tocar queda usable por encima
        await page.evaluate(() => ZD.mobile.open('fx'));
        await page.waitForTimeout(300);
        const sheet = await rect(page, '#zd-sheet'), pad2 = await rect(page, '#xypad'), sir2 = await rect(page, '#bigTrig');
        assert.ok(pad2.visible && sir2.visible && pad2.h >= 100, `${v.label}: con el sheet en peek el pad y SIREN siguen a la vista (pad ${Math.round(pad2.h)} px)`);
        assert.ok(!overlap(sheet, pad2) && !overlap(sheet, sir2), `${v.label}: el sheet peek no puede tapar el pad ni SIREN`);
        await shot(page, `j4-${v.width}x${v.height}-peek`);
        await page.evaluate(() => ZD.mobile.close());
      } else {
        console.log(`  ${v.label} · sin shell · pad ${Math.round(pad.w)}×${Math.round(pad.h)} · sin scroll horizontal`);
      }
      await shot(page, `j4-${v.width}x${v.height}`);
      assert.deepEqual(errors, [], `${v.label}: errores de consola`);
    } finally { await ctx.close(); }
  });
}

// ─────────────────────────── R2 · oferta de instalación ───────────────────────

test('J4 · banner de instalación: no tapa REC, el pad ni SIREN; prompt() una vez; "Ahora no" 14 días', async () => {
  for (const v of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(v);
    try {
      await powerOn(page);
      await page.evaluate(FIRE_BIP);
      await page.waitForSelector('.zd-pwa-banner', { timeout: 3000 });
      const banner = await rect(page, '.zd-pwa-banner');
      const first = await page.evaluate(() => { const s = document.getElementById('zd-stage'); return s && s.firstElementChild ? s.firstElementChild.className : null; });
      assert.match(String(first), /zd-pwa-banner/, 'el banner tiene que ser el primer hijo de #zd-stage');
      for (const sel of ['#zd-top', '#recBtn', '#xypad', '#bigTrig', '#latchBtn', '#throwRow']) {
        const r = await rect(page, sel);
        assert.ok(r && r.visible, `${v.width}×${v.height}: ${sel} tiene que seguir visible con el banner`);
        assert.ok(!overlap(banner, r), `${v.width}×${v.height}: el banner tapa ${sel}`);
      }
      await shot(page, `j4-${v.width}x${v.height}-banner`);
      // ↓ Instalar: prompt() una sola vez; después ya no hay deferredPrompt
      await page.click('.zd-pwa-banner >> text=/Instalar/');
      await page.waitForTimeout(150);
      const after1 = await page.evaluate(() => window.__prompts);
      const top = await page.$('#zd-pwa-topbtn');
      if (top) { await top.click(); await page.waitForTimeout(150); }
      const after2 = await page.evaluate(() => window.__prompts);
      assert.equal(after1, 1, 'tocar "Instalar" llama a prompt() una vez');
      assert.equal(after2, 1, 'un segundo intento no vuelve a llamar a prompt() (el evento ya se usó)');
      console.log(`  ${v.width}×${v.height} · banner ${Math.round(banner.h)} px, no tapa REC/pad/SIREN/LATCH/throws · prompt() ${after2} vez`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
  // "Ahora no": se guarda la fecha y no vuelve por 14 días
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await powerOn(page);
    await page.evaluate(FIRE_BIP);
    await page.click('.zd-pwa-banner >> text=/Ahora no/i');
    const key = await page.evaluate(() => localStorage.getItem('zd:pwa:dismissed'));
    assert.ok(key, 'tiene que quedar zd:pwa:dismissed');
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(FIRE_BIP);
    await page.waitForTimeout(250);
    const again = await page.evaluate(() => ({ banner: !!document.querySelector('.zd-pwa-banner'), icon: !!document.getElementById('zd-pwa-topbtn') }));
    assert.equal(again.banner, false, 'dentro de los 14 días el banner no vuelve');
    assert.equal(again.icon, true, 'el ícono ↓ de la barra sigue disponible');
    await page.evaluate(() => localStorage.setItem('zd:pwa:dismissed', String(Date.now() - 15 * 864e5)));
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(FIRE_BIP);
    await page.waitForSelector('.zd-pwa-banner', { timeout: 3000 });
    console.log('  "Ahora no" → sin banner tras recargar (ícono ↓ sí) · con la marca de hace 15 días vuelve');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('J4 · standalone: sin banner, sin ícono ↓ ni ítem de instalar', async () => {
  const init = () => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
  };
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, {}, { init });
  try {
    await page.evaluate(FIRE_BIP);
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => ({ standalone: ZD.pwa.isStandalone(), banner: !!document.querySelector('.zd-pwa-banner'), icon: !!document.getElementById('zd-pwa-topbtn'), item: document.getElementById('zd-install-btn').hidden }));
    assert.deepEqual(s, { standalone: true, banner: false, icon: false, item: true });
    console.log('  standalone · sin banner, sin ↓, ítem del menú oculto');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── R3 · autoguardado ──────────────────────────

test('J4 · autoguardado: tocar → recargar → mismo estado, sin arrancar el audio; slots migrados', async () => {
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctxB.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    // slots como los guardaba la versión anterior
    await page.goto(srv.origin + '/robots.txt');
    await page.evaluate(() => {
      localStorage.setItem('dubsiren.preset.Mi Wail', JSON.stringify({ __hackwave: 'dub-siren', v: 3, wave: 'saw', mode: 'wail', cutoff: 900 }));
      localStorage.setItem('dubsiren.preset.Roto', '{no es json');
    });
    await page.goto(srv.origin + URL_PATH, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const mig = await page.evaluate(() => ({ slots: slots.map((s) => s.name), key: !!localStorage.getItem('zd:j4-sirens:slots'), old: Object.keys(localStorage).filter((k) => k.startsWith('dubsiren.preset.')).length }));
    assert.deepEqual(mig, { slots: ['Mi Wail'], key: true, old: 2 }, 'migra los slots válidos y deja las claves viejas intactas');

    const want = await page.evaluate(() => {
      KREG.cutoff.setNorm(0.3); KREG.etime.setNorm(0.7);
      document.querySelector('#modes .mode[data-mode="alarm"]').click();
      document.querySelector('#padXSeg button[data-v="rate"]').click();
      document.getElementById('latchBtn').click();
      document.querySelector('#vizSeg button[data-v="mandala"]').click();
      document.getElementById('phOn').click();
      return { cutoff: Math.round(P.cutoff), etime: +P.echo.time.toFixed(3), mode: P.mode, padX, latch: latchMode, viz: vizMode, ph: P.ph.on };
    });
    await page.waitForTimeout(2000);
    const env = await page.evaluate(async () => { const e = await ZD.store.open({ slug: 'j4-sirens', app: 'j4-sirens-station', version: 1, enabled: false }).load(); return e && { app: e.app, version: e.version, data: !!e.data }; });
    assert.deepEqual(env, { app: 'j4-sirens-station', version: 1, data: true }, 'envoltorio { app, version, savedAt, data }');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('text=Sesión restaurada', { timeout: 6000 });
    const got = await page.evaluate(() => ({ cutoff: Math.round(P.cutoff), etime: +P.echo.time.toFixed(3), mode: P.mode, padX, latch: latchMode, viz: vizMode, ph: P.ph.on }));
    assert.deepEqual(got, want, 'el estado tiene que volver igual');
    assert.equal(await page.evaluate(() => ctx === null), true, 'restaurar no puede crear el AudioContext');
    console.log(`  migración 1 slot (1 dañado descartado) · ${JSON.stringify(got)} vuelve igual y sin AudioContext`);
    assert.deepEqual(errors, []);
  } finally { await ctxB.close(); }
});

// ───────────────────────────────── R4 · exports ───────────────────────────────

test('J4 · export JSON / MIDI / WAV', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await powerOn(page);
    const grab = async (fn) => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), fn()]);
      return { name: dl.suggestedFilename(), buf: readFileSync(await dl.path()) };
    };
    await page.evaluate(() => { KREG.cutoff.setNorm(0.25); document.getElementById('slotName').value = 'Backup'; saveSlot(); });
    await page.evaluate(() => ZD.mobile.open('ses'));
    await page.waitForTimeout(200);
    const json = await grab(() => page.click('#btnExport'));
    assert.match(json.name, /^j4-sirens-\d{8}-\d{4}\.json$/, `nombre del JSON: ${json.name}`);
    const obj = JSON.parse(json.buf.toString('utf8'));
    assert.equal(obj.app, 'j4-sirens-station');
    assert.equal(obj.version, 1);
    assert.match(String(obj.savedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(obj.data.patch && obj.data.pad && obj.data.viz && obj.data.perf, 'estado completo en .data');
    assert.deepEqual(obj.data.slots.map((s) => s.name), ['Backup'], 'el JSON trae los patches guardados');
    // ida y vuelta + patch viejo + error en modal
    const p1 = join(tmpdir(), `zd-j4-${process.pid}.json`), p2 = join(tmpdir(), `zd-j4-old-${process.pid}.json`), p3 = join(tmpdir(), `zd-j4-bad-${process.pid}.json`);
    writeFileSync(p1, json.buf);
    writeFileSync(p2, JSON.stringify({ __hackwave: 'dub-siren', v: 3, mode: 'random', wave: 'saw', cutoff: 2200 }));
    writeFileSync(p3, JSON.stringify({ app: 'acid-bass-303', version: 1, data: {} }));
    await page.evaluate(() => KREG.cutoff.setNorm(0.9));
    page.once('filechooser', (fc) => fc.setFiles(p1)); await page.click('#btnImport'); await page.waitForTimeout(300);
    assert.equal(Math.round(await page.evaluate(() => P.cutoff)), Math.round(obj.data.patch.cutoff), 'el JSON exportado vuelve a abrir igual');
    page.once('filechooser', (fc) => fc.setFiles(p2)); await page.click('#btnImport'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [P.mode, P.wave, P.cutoff]), ['random', 'saw', 2200], 'abre un dubsiren-patch.json viejo');
    page.once('filechooser', (fc) => fc.setFiles(p3)); await page.click('#btnImport');
    await page.waitForSelector('.zd-dlg', { timeout: 3000 });
    assert.match(await page.textContent('.zd-dlg'), /otro instrumento/, 'el JSON de otra app sale en un modal');
    await page.click('.zd-dlg .zd-dact button');
    [p1, p2, p3].forEach((f) => rmSync(f, { force: true }));
    await page.evaluate(() => ZD.mobile.close());

    // toma: SIREN en WAIL sin barrido (para ver el glide), legato por la tira, el pad
    await page.evaluate(() => { applyPatch(FACTORY['Classic Wail']); P.depth = 0; applyMode(); P.glide = 300; });
    await page.click('#recBtn');
    await page.waitForFunction(() => recState === 'rec');
    await page.evaluate(async () => {
      const w = (ms) => new Promise((r) => setTimeout(r, ms));
      noteOn('pad', 57); await w(500); noteOn('strip', 64); await w(500); noteOff('strip'); await w(300); noteOff('pad'); await w(200);
      for (let i = 0; i <= 8; i++) { KREG[padX].setNorm(i / 8); midiPad(i / 8, 1 - i / 8); await w(30); }
    });
    await page.click('#recBtn');
    await page.waitForFunction(() => recState === 'idle' && take, null, { timeout: 15000 });
    await page.evaluate(() => ZD.mobile.open('ses'));
    await page.waitForTimeout(200);
    const wav = await grab(() => page.click('#recResult >> text=/DESCARGAR WAV/'));
    assert.match(wav.name, /^j4-sirens-\d{8}-\d{4}\.wav$/, `nombre del WAV: ${wav.name}`);
    assert.equal(wav.buf.subarray(0, 4).toString('latin1'), 'RIFF');
    assert.equal(wav.buf.subarray(8, 12).toString('latin1'), 'WAVE');
    assert.equal(wav.buf.readUInt16LE(22), 2, 'estéreo');
    assert.equal(wav.buf.readUInt16LE(34), 16, 'PCM 16-bit');
    const sr = wav.buf.readUInt32LE(24);
    assert.equal(sr, await page.evaluate(() => ctx.sampleRate), 'a la frecuencia real del AudioContext');
    assert.ok(wav.buf.length > 100000, `el WAV tiene que tener audio (${wav.buf.length} B)`);
    const midi = await grab(() => page.click('#takeMidi'));
    assert.match(midi.name, /^j4-sirens-\d{8}-\d{4}\.mid$/);
    const parsed = parseSMF(midi.buf), an = analyzeNotes(parsed);
    assert.equal(parsed.format, 0);
    assert.deepEqual(an.notes.map((n) => n.pitch), [57, 64, 57], 'notas de la toma: A3, legato a E4 y vuelta a A3');
    assert.deepEqual(defects(an), [], 'el MIDI de la toma tiene que estar sano');
    const ccs = parsed.events.filter((e) => e.kind === 'cc'), bends = parsed.events.filter((e) => e.kind === 'bend');
    assert.deepEqual(ccs.slice(0, 4).map((c) => [c.cc, c.value]), [[101, 0], [100, 0], [6, 24], [38, 0]], 'RPN 0 = ±24 semitonos');
    assert.ok(ccs.some((c) => c.cc === 74) && ccs.some((c) => c.cc === 71), 'CC74 (X) y CC71 (Y) del pad');
    const on64 = parsed.events.find((e) => e.kind === 'on' && e.pitch === 64).tick;
    const glide = bends.filter((b) => b.tick >= on64 && b.tick < on64 + 60).map((b) => (b.value - 8192) / 8192 * 24);
    assert.ok(glide.length > 3 && glide[0] < -6 && glide[glide.length - 1] > glide[0] + 3, `el glide A3→E4 tiene que verse como bend de -7 hacia 0 (${glide.map((x) => x.toFixed(1)).join(' ')})`);
    console.log(`  ${json.name} (ida y vuelta, patch viejo, error en modal) · ${wav.name} ${wav.buf.length} B ${sr} Hz · ${midi.name} ${an.notes.length} notas, ${bends.length} bends, glide ${glide[0].toFixed(1)}→${glide[glide.length - 1].toFixed(1)}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── R5 · audio ─────────────────────────────────

test('J4 · audio: el primer toque enciende, suspend y resume, latencyHint', async () => {
  const init = () => { window.__ctxOpts = []; const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ctxOpts.push(a[0] || null); } }; };
  const { ctx, page, errors } = await open({ width: 390, height: 844 }, {}, { init });
  try {
    assert.equal(await page.evaluate(() => ctx === null), true, 'sin AudioContext antes del primer toque');
    await powerOn(page);
    const on = await page.evaluate(() => ({ state: ctx.state, opts: window.__ctxOpts[0], unlocked: ZD.audio.unlocked }));
    assert.equal(on.state, 'running');
    assert.equal(on.unlocked, true, 'ZD.audio.unlock() corrió dentro del gesto');
    assert.equal(on.opts && on.opts.latencyHint, 'interactive');
    await page.evaluate(() => ctx.suspend()); await page.waitForTimeout(120);
    await page.evaluate(() => ZD.audio.resume()); await page.waitForTimeout(300);
    const r1 = await page.evaluate(() => ctx.state);
    await page.evaluate(() => ctx.suspend()); await page.waitForTimeout(120);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(400);
    const r2 = await page.evaluate(() => ctx.state);
    assert.equal(r1, 'running', 'ZD.audio.resume() vuelve a running');
    assert.equal(r2, 'running', 'volver a la pestaña reanuda el contexto');
    // SIREN prende el "sonando" de zd-audio (wake lock)
    await page.evaluate(() => noteOn('pad', 57)); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => playingOn), true, 'con la sirena sonando, ZD.audio.setPlaying(true)');
    await page.evaluate(() => noteOff('pad'));
    console.log(`  latencyHint ${on.opts.latencyHint} · running → suspended → resume() → ${r1} · visibilitychange → ${r2}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ──────────────── rotación de tablet con la sirena sonando ────────────────────

test('J4 · rotación de tablet 1180×820 ↔ 820×1180 con la sirena sonando', async () => {
  const { ctx, page, errors } = await open({ width: 1180, height: 820 });
  try {
    await powerOn(page);
    await page.evaluate(() => { setLatch(true); sirenToggle(); });   // sirena latcheada
    const t0 = await page.evaluate(() => ctx.currentTime);
    for (let i = 1; i <= 4; i++) {
      for (const v of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
        await page.setViewportSize(v);
        await page.waitForTimeout(220);
        const s = await page.evaluate(() => ({
          shell: !!(ZD.mobile && ZD.mobile.active), state: ctx.state, voice: voiceActive,
          stage: Array.from(document.getElementById('zd-stage').children).map((e) => e.id).filter(Boolean),
          scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
          pad: document.getElementById('xypad').getBoundingClientRect().height > 0,
          siren: document.getElementById('bigTrig').getBoundingClientRect().height > 0,
          sirenOn: document.getElementById('bigTrig').getAttribute('aria-pressed'),
        }));
        const where = `vuelta ${i} · ${v.width}×${v.height}`;
        assert.equal(s.state, 'running', `${where}: el audio no puede cortarse al rotar`);
        assert.equal(s.voice, true, `${where}: la sirena latcheada sigue sonando`);
        assert.equal(s.sirenOn, 'true', `${where}: SIREN sigue marcado`);
        assert.equal(s.shell, v.width === 820, `${where}: shell`);
        assert.ok(s.pad && s.siren, `${where}: pad y SIREN visibles`);
        assert.ok(s.scrollW <= s.clientW + 1, `${where}: sin scroll horizontal`);
        if (s.shell) assert.deepEqual(s.stage, KEEP, `${where}: el stage se quedó vacío al volver a entrar`);
        else assert.deepEqual(s.stage, [], `${where}: el stage vacío fuera del shell`);
      }
    }
    const t1 = await page.evaluate(() => ctx.currentTime);
    assert.ok(t1 > t0, 'el reloj del AudioContext avanzó');
    console.log(`  8 rotaciones con la sirena latcheada · ctx.currentTime ${t0.toFixed(2)} → ${t1.toFixed(2)} · sin cortes`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ──────────────────── multitáctil y scroll donde corresponde ───────────────────

test('J4 · pad XY y SIREN con dos dedos a la vez', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await powerOn(page);
    const cdp = await ctx.newCDPSession(page);
    const pad = await rect(page, '#xypad'), sir = await rect(page, '#bigTrig');
    const S = (dx = 0) => touchPoint(sir.x + sir.w / 2 + dx, sir.y + sir.h / 2, 1);
    const Q = (i) => touchPoint(pad.x + 40 + i * 25, pad.y + pad.h - 40 - i * 30, 2);
    const st = () => page.evaluate(() => ({ voice: voiceActive, cutoff: Math.round(P.cutoff) }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [S()] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [S(), Q(0)] });
    const a = await st();
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [S(i % 2 * 3), Q(i)] });
    const b = await st();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [Q(8)] });   // CDP: touchEnd suelta los puntos que recibe
    const c = await st();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [S()] });
    await page.waitForTimeout(50);
    const d = await st();
    assert.equal(a.voice, true, 'SIREN suena con el primer dedo');
    assert.notEqual(b.cutoff, a.cutoff, 'el pad responde al segundo dedo mientras SIREN sigue apretado');
    assert.equal(b.voice, true);
    assert.equal(c.voice, true, 'soltar el pad no corta la sirena');
    assert.equal(d.voice, false, 'soltar SIREN la corta');
    console.log(`  SIREN + pad: cutoff ${a.cutoff} → ${b.cutoff} con la sirena sonando · soltar el pad no la corta`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('J4 · scroll táctil: la página sin shell y el sheet en 768×1024; el pad no arrastra nada', async () => {
  {
    const { ctx, page, errors } = await open({ width: 1180, height: 820 });
    try {
      await powerOn(page);
      const cdp = await ctx.newCDPSession(page);
      await swipe(cdp, 600, 600, 200);
      const y = await page.evaluate(() => scrollY);
      assert.ok(y > 100, `sin shell, un swipe sobre la página tiene que scrollear (scrollY=${y}); con body{touch-action:none} daba 0`);
      console.log(`  1180×820 sin shell: swipe → scrollY ${y}`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
  const { ctx, page, errors } = await open({ width: 768, height: 1024 });
  try {
    await powerOn(page);
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(() => ZD.mobile.open('fx'));
    await page.waitForTimeout(300);
    const lab = await rect(page, '#zd-sheet #knobsEcho .knob:nth-child(3) .lab');
    const body = await rect(page, '#zd-sheet .zd-sbody');
    await swipe(cdp, lab.x + lab.w / 2, lab.y + lab.h / 2, body.y + 10);
    const top = await page.evaluate(() => document.querySelector('#zd-sheet .zd-sbody').scrollTop);
    assert.ok(top > 30, `el sheet tiene que scrollear con el dedo (scrollTop=${top})`);
    await page.evaluate(() => ZD.mobile.close());
    await page.waitForTimeout(250);
    const pad = await rect(page, '#xypad');
    const c0 = await page.evaluate(() => P.cutoff);
    await swipe(cdp, pad.x + pad.w / 2, pad.y + pad.h / 2 + 100, pad.y + pad.h / 2 - 100);
    const s = await page.evaluate(() => ({ cutoff: P.cutoff, y: scrollY }));
    assert.notEqual(s.cutoff, c0, 'el pad toma el gesto');
    assert.equal(s.y, 0, 'el gesto en el pad no scrollea la página');
    console.log(`  768×1024: el sheet scrollea (scrollTop ${top}) · el pad toma el gesto sin scrollear`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────── SPEC 3.2 · file://, http, iframe ─────────────────

test('J4 · file://: sin service worker, sin manifest, solo el aviso del archivo local', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url()); });
  try {
    await page.goto(pathToFileURL(join(ROOT, FILE)).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(FIRE_BIP);
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({
      protocol: location.protocol, active: ZD.pwa.active, registered: ZD.pwa.registered,
      local: !!document.querySelector('.zd-pwa-local'), banner: !!document.querySelector('.zd-pwa-banner'),
      openWeb: (() => { const a = document.querySelector('.zd-pwa-local a'); return a ? a.getAttribute('href') : null; })(),
    }));
    assert.equal(s.protocol, 'file:');
    assert.equal(s.active, false); assert.equal(s.registered, false);
    assert.equal(s.local, true, 'tiene que salir el aviso del archivo local');
    assert.equal(s.banner, false, 'ni con beforeinstallprompt sale el banner en file://');
    assert.match(String(s.openWeb), /^https:\/\/.+J4-Sirens_Station\.html$/, '[Abrir web] va al canonical');
    // el instrumento anda igual en file://
    await page.click('#power');
    await page.waitForFunction(() => ctx && ctx.state === 'running', null, { timeout: 8000 });
    assert.deepEqual(requests, [], `no puede haber pedidos de red en file://: ${requests.join(', ')}`);
    console.log(`  file:// · aviso local con [Abrir web] → ${s.openWeb} · sin banner · 0 pedidos de red · audio running`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('J4 · hosted: service worker registrado e instalable', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.ZD && ZD.pwa && ZD.pwa.registered, null, { timeout: 15000 });
    const s = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return { manifest: ZD.pwa.manifest, scopes: regs.map((r) => r.scope), scripts: regs.map((r) => (r.active || r.installing || r.waiting).scriptURL),
        theme: document.querySelector('meta[name=theme-color]').content, title: document.querySelector('meta[name=apple-mobile-web-app-title]').content };
    });
    const man = JSON.parse(readFileSync(join(ROOT, 'manifests/j4-sirens.webmanifest'), 'utf8'));
    assert.match(s.manifest, /manifests\/j4-sirens\.webmanifest$/);
    assert.equal(s.theme, man.theme_color, 'theme-color igual al theme_color del manifest');
    assert.equal(s.title, man.short_name, 'apple-mobile-web-app-title igual al short_name');
    assert.match(s.scripts[0], /\/sw\.js$/);
    const cdp = await ctx.newCDPSession(page);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(inst.installabilityErrors, [], 'Chromium no reporta errores de instalabilidad');
    console.log(`  SW ${s.scripts[0]} scope ${s.scopes[0]} · theme-color ${s.theme} · instalable (0 errores)`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('J4 · iframe: zd-pwa inerte, sin banner, sin errores', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(srv.origin + IFRAME_PATH, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const frame = page.frames().find((f) => f.url().includes('J4-Sirens_Station.html'));
    await frame.evaluate(FIRE_BIP);
    await page.waitForTimeout(200);
    const s = await frame.evaluate(() => ({ top: window.top === window, active: ZD.pwa.active, banner: !!document.querySelector('.zd-pwa-banner, .zd-pwa-local'), css: !!document.getElementById('zd-pwa-css'), host: HOST === null }));
    assert.deepEqual(s, { top: false, active: false, banner: false, css: false, host: true });
    console.log('  iframe · ZD.pwa inerte (0 banner, 0 CSS) · sin hub C2 → HOST null · 0 errores');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('J4 · hub C2 falso: el adaptador registra, arranca sin gesto y no autoguarda', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  try {
    await page.goto(srv.origin + HUB_PATH, { waitUntil: 'load' });
    await page.waitForFunction(() => window.C2.registered.length === 1, null, { timeout: 8000 });
    const frame = page.frames().find((f) => f.url().includes('J4-Sirens_Station.html'));
    await frame.waitForFunction(() => ctx && !document.getElementById('power'), null, { timeout: 8000 });
    const s = await frame.evaluate(() => ({
      sameCtx: ctx === window.parent.C2.ctx, slot: SLOT_ID, session: Session === null, echo: +P.echo.time.toFixed(3),
      title: document.title, state: typeof window.parent.C2.registered[0].getState().echo,
    }));
    const api = await page.evaluate(() => { const a = C2.registered[0]; return { v: a.apiVersion, id: a.id, name: a.name }; });
    assert.equal(s.sameCtx, true, 'usa el AudioContext del hub');
    assert.equal(s.slot, 'j4test', 'toma el slot del nombre del iframe');
    assert.equal(s.session, true, 'con hub no abre la sesión (no restaura ni guarda)');
    assert.equal(s.echo, 0.6, 'onTempo(100) sincroniza el eco a 60/100 s');
    assert.equal(s.state, 'object', 'getState() devuelve P');
    assert.deepEqual(api, { v: 1, id: 'j4test', name: 'J4 Sirens' });
    console.log(`  hub C2 · registrado ${JSON.stringify(api)} · mismo AudioContext · eco ${s.echo} s · título "${s.title}" · sin autoguardado`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
