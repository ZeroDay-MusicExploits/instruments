#!/usr/bin/env node
// reports/nebularp-verify.mjs
//
// Re-verificación completa de NEBULARP 2035, la que se corrió después de pegar
// zd-mobile v4 y zd-midi v2 (reports/nebularp.md, sección 0 y anexo). Es una
// adaptación de tools/tests/acid-verify.test.mjs: viewports de SPEC R1, banner
// de instalación, autoguardado (R3), JSON, MIDI de REC parseado como SMF (gate
// 150 %, ratchet, Chord, pad y autoplay) y WAV (R4), audio con suspend/resume
// (R5), rotación de tablet 1180×820 ↔ 820×1180 con el arpegio sonando,
// `file://`, service worker sobre http e iframe.
//
// Vive en reports/ y no en tools/tests/ porque tools/ lo maneja la sesión D.
// Usa sin modificar el servidor y el parser SMF de tools/tests/lib/.
//
//   node reports/nebularp-verify.mjs
//
// Necesita Playwright + Chromium (no es dependencia del runtime):
//   npm i -D playwright && npx playwright install chromium
//
// Nebularp vive en un IIFE sin globales: para ver si suena, un addInitScript
// guarda los AudioContext que crea la página y cuenta los start() de las
// fuentes. Los knobs se manejan por teclado (ZD.ui.a11ySlider).
//
// Intermitente conocido: el caso de rotación falló 1 vez en 8 corridas
// completas (2026-10-04) y no quedó el mensaje. Pasó las otras 7 y 3 de 3
// corriendo solo. Si vuelve a fallar, guardar la salida completa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';
import { parseSMF, analyzeNotes, defects } from '../tools/tests/lib/smf.mjs';

const FILE = 'descargables/Nebularp_2035.html';
const URL_PATH = '/' + FILE;
const IFRAME_PATH = '/__test-iframe.html';
const KEEP = ['.hero', '.octctl', '.kbwrap'];

const VIEWPORTS = [
  { width: 360, height: 640, shell: true, label: '360×640 (mínimo)' },
  { width: 390, height: 844, shell: true, label: '390×844' },
  { width: 430, height: 932, shell: true, label: '430×932' },
  { width: 768, height: 1024, shell: true, label: '768×1024 (iPad vertical)' },
  { width: 844, height: 390, shell: true, label: '844×390 (landscape)' },
  { width: 1440, height: 900, shell: false, label: '1440×900 (escritorio)' },
];

let srv, browser;

/* Captura los AudioContext que crea la página y cuenta los start() de las
   fuentes (cada voz del arpegio arranca osciladores): así se ve si suena. */
const HOOKS = () => {
  window.__ctxs = []; window.__ctxOpts = []; window.__starts = 0;
  const AC = window.AudioContext;
  if (AC) {
    window.AudioContext = class extends AC {
      constructor(...a) { super(...a); window.__ctxs.push(this); window.__ctxOpts.push(a[0] || null); }
    };
    window.webkitAudioContext = window.AudioContext;
  }
  if (window.AudioScheduledSourceNode) {
    const st = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (...a) { window.__starts++; return st.apply(this, a); };
  }
};

test.before(async () => {
  srv = await serveRoot(ROOT, {
    [IFRAME_PATH]: {
      body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>iframe</title></head>
<body style="margin:0"><iframe id="f" src="${URL_PATH}" style="width:360px;height:100vh;border:0" title="Nebularp"></iframe></body></html>`,
    },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true, isMobile: true, acceptDownloads: true, ...opts,
  });
  await ctx.addInitScript(HOOKS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
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
const overlap = (a, b) => !!(a && b && a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5);
const stageKids = (page) => page.evaluate(() => {
  const s = document.getElementById('zd-stage');
  return s ? Array.from(s.children).filter((e) => !/zd-pwa-/.test(e.className)).map((e) => '.' + e.className.split(/\s+/)[0]) : [];
});
const ctxState = (page) => page.evaluate(() => {
  const c = window.__ctxs[window.__ctxs.length - 1];
  return c ? c.state : null;
});
/* knob por nombre: [role=slider][aria-label=<nombre>] (ZD.ui.a11ySlider) */
async function knobKey(page, name, key) {
  const loc = page.locator(`.dial[role=slider][aria-label="${name}"]`).first();
  await loc.focus();
  await page.keyboard.press(key);
  return loc.getAttribute('aria-valuetext');
}
const snapshot = (page) => page.evaluate(() => ({
  sliders: Array.from(document.querySelectorAll('.dial[role=slider]')).map((e) => e.getAttribute('aria-label') + '=' + e.getAttribute('aria-valuetext')),
  pressed: Array.from(document.querySelectorAll('[aria-pressed]'))
    .filter((e) => e.id !== 'play' && e.id !== 'recBtn' && !e.closest('#zd-tabs'))
    .map((e) => (e.id || (e.parentElement.id + ':' + (e.dataset.val || e.textContent.trim()))) + '=' + e.getAttribute('aria-pressed')),
  oct: (document.getElementById('octVal') || document.querySelector('.octctl .oval') || {}).textContent || null,
  held: Array.from(document.querySelectorAll('#held .chip, #held span:not(.held-empty)')).map((e) => e.textContent.trim()),
}));

function wavInfo(buf) {
  assert.equal(buf.subarray(0, 4).toString('latin1'), 'RIFF', 'el WAV tiene que ser RIFF');
  assert.equal(buf.subarray(8, 12).toString('latin1'), 'WAVE');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.subarray(p, p + 4).toString('latin1'), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), sampleRate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') data = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  let peak = 0;
  for (let i = 0; i + 1 < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
  return { ...fmt, seconds: data.length / (fmt.channels * fmt.bits / 8) / fmt.sampleRate, peak: peak / 32768 };
}

const grab = async (page, fn, timeout = 30000) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), fn()]);
  return { name: dl.suggestedFilename(), buf: readFileSync(await dl.path()) };
};

/* Una toma: REC → during() → espera → REC. Devuelve el MIDI y el WAV. */
async function takeOf(page, ms, during, { wav = false, beforeStop = null } = {}) {
  await page.click('#recBtn');
  await page.waitForFunction(() => document.getElementById('recBtn').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
  if (during) await during();
  await page.waitForTimeout(ms);
  if (beforeStop) await beforeStop();
  await page.click('#recBtn');
  await page.waitForSelector('#recResult .iobtn', { timeout: 20000 });
  const label = await page.locator('#recResult .iobtn').first().textContent();
  const midi = await grab(page, () => page.locator('#recResult .iobtn').first().click());
  const parsed = parseSMF(midi.buf);
  const an = analyzeNotes(parsed);
  let w = null;
  if (wav) w = await grab(page, () => page.click('#recResult >> text=/DESCARGAR WAV/i'));
  return { label, midi, parsed, an, wav: w };
}

/* Notas de la misma altura, una detrás de otra: hueco en ticks entre el off de
   la anterior y el on de la siguiente. */
function sameGaps(an) {
  const by = new Map(); const gaps = [];
  for (const n of an.notes) { const k = n.ch + ':' + n.pitch; (by.get(k) || by.set(k, []).get(k)).push(n); }
  for (const list of by.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) gaps.push(list[i].start - list[i - 1].end);
  }
  return gaps;
}

// ───────────────────────────────── R1 · viewports ─────────────────────────────

for (const v of VIEWPORTS) {
  test(`Nebularp · ${v.label} · layout`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      const s = await page.evaluate(() => ({
        shell: !!(window.ZD && ZD.mobile && ZD.mobile.active),
        scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
        tabs: document.querySelectorAll('#zd-tabs button').length,
        rotate: !!document.getElementById('zd-rotate'),
        ctxs: window.__ctxs.length,
      }));
      assert.equal(s.shell, v.shell, `${v.label}: shell`);
      assert.ok(s.scrollW <= s.clientW + 1, `${v.label}: scroll horizontal (${s.scrollW} > ${s.clientW})`);
      assert.equal(s.rotate, false, 'no puede existir #zd-rotate');
      assert.equal(s.ctxs, 0, 'no se crea AudioContext antes del primer gesto');
      if (v.shell) {
        assert.equal(s.tabs, 5);
        assert.deepEqual(await stageKids(page), KEEP);
        // transporte de la barra: ≥44 en el eje corto y adentro de .zd-ttr (sin recorte)
        const bar = await page.evaluate(() => {
          const ttr = document.querySelector('#zd-top .zd-ttr').getBoundingClientRect();
          const top = document.getElementById('zd-top').getBoundingClientRect();
          return {
            topH: Math.round(top.height),
            ctrls: Array.from(document.querySelectorAll('#zd-top button,#zd-top a')).map((e) => {
              const r = e.getBoundingClientRect();
              return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height),
                clipped: e.closest('.zd-ttr') ? (r.left < ttr.left - 0.5 || r.right > ttr.right + 0.5) : false };
            }).filter((c) => c.w > 0),
          };
        });
        const small = bar.ctrls.filter((c) => Math.min(c.w, c.h) < 44);
        const clipped = bar.ctrls.filter((c) => c.clipped);
        assert.deepEqual(small, [], `${v.label}: controles de la barra < 44 px`);
        assert.deepEqual(clipped, [], `${v.label}: controles recortados en .zd-ttr`);
        const piano = await rect(page, '.piano');
        const keyH = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('.pkey.white')).map((e) => e.getBoundingClientRect().height)));
        const keyW = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('.pkey.white')).map((e) => e.getBoundingClientRect().width)));
        assert.ok(piano.visible && keyH >= 44 && keyW >= 40, `${v.label}: piano ${keyW}×${keyH}`);
        const tabH = await page.evaluate(() => Math.min(...Array.from(document.querySelectorAll('#zd-tabs button')).map((e) => e.getBoundingClientRect().height)));
        assert.ok(tabH >= 44);
        console.log(`  ${v.label} · shell · barra ${bar.topH}px · ${bar.ctrls.map((c) => `${c.id} ${c.w}×${c.h}`).join(' · ')} · teclas ${Math.round(keyW)}×${Math.round(keyH)} · tabs ${Math.round(tabH)}`);
      } else {
        console.log(`  ${v.label} · sin shell · sin scroll horizontal`);
      }
      assert.deepEqual(errors, [], `${v.label}: consola`);
    } finally { await ctx.close(); }
  });
}

test('Nebularp · el banner de instalación no tapa el pad (360×640 y 390×844)', async () => {
  for (const v of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await open(v);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
      await page.waitForTimeout(200);
      const banner = await rect(page, '.zd-pwa-banner');
      assert.ok(banner && banner.visible, 'banner visible');
      const first = await page.evaluate(() => document.getElementById('zd-stage').firstElementChild.className);
      assert.match(first, /zd-pwa-banner/);
      const hit = [];
      for (const sel of ['#play', '#recBtn', '#latch', '#tap', '.orbit-frame', '.octctl', '.piano', '#zd-tabs', '#zd-top']) {
        const r = await rect(page, sel);
        assert.ok(r && r.visible, `${sel} visible con el banner`);
        if (overlap(banner, r)) hit.push(sel);
      }
      assert.deepEqual(hit, [], `${v.width}×${v.height}: el banner tapa ${hit.join(', ')}`);
      // las teclas del piano tienen que seguir enteras dentro del viewport
      const keys = await page.evaluate(() => {
        const ks = Array.from(document.querySelectorAll('.pkey.white')).map((e) => e.getBoundingClientRect());
        const tabs = document.getElementById('zd-tabs').getBoundingClientRect();
        return { h: Math.min(...ks.map((r) => r.height)), below: ks.filter((r) => r.bottom > tabs.top + 0.5).length };
      });
      assert.equal(keys.below, 0, 'ninguna tecla puede quedar debajo de las tabs');
      assert.ok(keys.h >= 44, `teclas de ${keys.h}px con el banner`);
      await page.click('.zd-pwa-banner >> text=/Ahora no/i');
      await page.waitForTimeout(120);
      const gone = await page.evaluate(() => ({ banner: !!document.querySelector('.zd-pwa-banner'), key: localStorage.getItem('zd:pwa:dismissed') }));
      assert.equal(gone.banner, false);
      assert.ok(gone.key);
      console.log(`  ${v.width}×${v.height} · banner ${Math.round(banner.h)}px · no tapa PLAY/REC/latch/tap/orbit/octava/piano/tabs · teclas ${Math.round(keys.h)}px · "Ahora no" ok`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

// ───────────────────────────────── R3 · autoguardado ──────────────────────────

test('Nebularp · autoguardado: tocar → recargar → mismo estado, sin audio', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    const base = await snapshot(page);
    await page.evaluate(() => ZD.mobile.open('arp'));
    await page.waitForTimeout(250);
    await knobKey(page, 'Gate', 'End');
    await knobKey(page, 'Ratchet', 'End');
    await knobKey(page, 'Swing', 'PageUp');
    await page.click('#patternSeg button[data-val="chord"]');
    await page.evaluate(() => ZD.mobile.open('son'));
    await page.waitForTimeout(250);
    await knobKey(page, 'Cutoff', 'PageDown');
    await knobKey(page, 'Detune', 'End');
    await page.evaluate(() => ZD.mobile.close && ZD.mobile.close());
    await page.waitForTimeout(250);
    await page.click('#octUp');
    await page.click('#latch');
    // acorde latcheado: con el transporte parado suena como pad (crea el contexto)
    await page.keyboard.down('a'); await page.keyboard.down('d');
    await page.waitForTimeout(150);
    await page.keyboard.up('a'); await page.keyboard.up('d');
    const changed = await snapshot(page);
    assert.notDeepEqual(changed, base, 'el estado tiene que haber cambiado');
    await page.waitForTimeout(2100);                       // debounce 1,5 s + margen
    const stored = await page.evaluate(async () => {
      const env = await ZD.store.open({ slug: 'nebularp', app: 'nebularp-2035', version: 1, enabled: false }).load();
      return env && { app: env.app, version: env.version, savedAt: typeof env.savedAt, state: !!(env.data && env.data.state) };
    });
    assert.deepEqual(stored, { app: 'nebularp-2035', version: 1, savedAt: 'string', state: true });

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('text=Sesión restaurada', { timeout: 6000 });
    const after = await snapshot(page);
    const audio = await page.evaluate(() => ({ ctxs: window.__ctxs.length, playing: document.getElementById('play').getAttribute('aria-pressed') }));
    console.log(`  ${changed.sliders.filter((x, i) => x !== base.sliders[i]).length} knobs + ${changed.pressed.filter((x, i) => x !== base.pressed[i]).length} botones cambiados · held=[${after.held.join(' ')}] · AudioContext al restaurar: ${audio.ctxs} · PLAY ${audio.playing}`);
    assert.deepEqual(after, changed, 'el estado tiene que volver igual después de recargar');
    assert.equal(audio.ctxs, 0, 'restaurar no puede crear el AudioContext');
    assert.equal(audio.playing, 'false');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── R4 · JSON ──────────────────────────────────

test('Nebularp · JSON: export, ida y vuelta y rechazo con mensaje', async () => {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 });
  try {
    await knobKey(page, 'Gate', 'End');
    await knobKey(page, 'Ratchet', 'End');
    const json = await grab(page, () => page.click('#saveJson'));
    assert.match(json.name, /^nebularp-\d{8}-\d{4}\.json$/, json.name);
    const obj = JSON.parse(json.buf.toString('utf8'));
    assert.equal(obj.app, 'nebularp-2035');
    assert.equal(obj.version, 1);
    assert.match(String(obj.savedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(obj.data.state.gate, 1.5);
    assert.equal(obj.data.state.ratchet, 1);
    const jsonPath = join(tmpdir(), `zd-nebularp-${process.pid}.json`);
    writeFileSync(jsonPath, json.buf);

    await knobKey(page, 'Gate', 'Home');
    await knobKey(page, 'Ratchet', 'Home');
    page.once('filechooser', (fc) => fc.setFiles(jsonPath));
    await page.click('#loadJson');
    await page.waitForSelector('text=/Sesión «.+» cargada/', { timeout: 5000 });
    const back = await page.evaluate(() => ['Gate', 'Ratchet'].map((n) => document.querySelector(`.dial[aria-label="${n}"]`).getAttribute('aria-valuetext')));
    assert.deepEqual(back, ['150%', '100%'], 'el JSON exportado tiene que volver a abrir igual');

    const badPath = join(tmpdir(), `zd-nebularp-otra-app-${process.pid}.json`);
    writeFileSync(badPath, JSON.stringify({ app: 'acid-bass-303', version: 1, savedAt: new Date().toISOString(), data: { state: {} } }));
    page.once('filechooser', (fc) => fc.setFiles(badPath));
    await page.click('#loadJson');
    await page.waitForSelector('.zd-dlg', { timeout: 5000 });
    const msg = await page.locator('.zd-dlg').textContent();
    assert.match(msg, /otro instrumento/);
    rmSync(jsonPath, { force: true }); rmSync(badPath, { force: true });
    console.log(`  ${json.name} ${json.buf.length}B · envoltorio ok · ida y vuelta Gate/Ratchet = ${back.join('/')} · otra app → modal "${msg.replace(/\s+/g, ' ').slice(0, 70)}…"`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────── R4 · REC → WAV + MIDI ────────────────────────────

test('Nebularp · zd-midi v2 embebido: off antes que on a igual tick', async () => {
  const { ctx, page } = await open({ width: 1440, height: 900 });
  try {
    const hex = await page.evaluate(async () => {
      const b = ZD.midi.write({ ppq: 96, bpm: 120, events: [
        { t: 0, type: 'on', pitch: 60, vel: 100 }, { t: 48, type: 'off', pitch: 60 },
        { t: 48, type: 'on', pitch: 60, vel: 100 }, { t: 96, type: 'off', pitch: 60 }] });
      return Array.from(new Uint8Array(await b.arrayBuffer())).map((x) => x.toString(16).padStart(2, '0')).join(' ');
    });
    assert.ok(hex.includes('00 90 3c 64 30 80 3c 00 00 90 3c 64 30 80 3c 00'), hex);
    console.log('  track: 00 90 3c 64 · 30 80 3c 00 · 00 90 3c 64 · 30 80 3c 00');
  } finally { await ctx.close(); }
});

test('Nebularp · REC: arpegio con gate 150 % y ratchet 100 % → MIDI sano + WAV', async () => {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 });
  try {
    await knobKey(page, 'Gate', 'End');
    await knobKey(page, 'Ratchet', 'End');
    const bpm = Number(await page.locator('.dial[aria-label="BPM"]').getAttribute('aria-valuetext'));
    await page.click('#play');
    await page.keyboard.down('a'); await page.keyboard.down('d'); await page.keyboard.down('g');
    const t = await takeOf(page, 4000, null, { wav: true });
    await page.keyboard.up('a'); await page.keyboard.up('d'); await page.keyboard.up('g');
    await page.click('#play');
    const { parsed, an } = t;
    const gaps = sameGaps(an);
    const w = wavInfo(t.wav.buf);
    const sr = await page.evaluate(() => window.__ctxs[0].sampleRate);
    console.log(`  ${t.label.trim()} · ${t.midi.name} · fmt ${parsed.format} · ${parsed.ppq} ppq · ${parsed.tempoBpm} bpm · ${an.notes.length} notas · alturas ${[...new Set(an.notes.map((n) => n.pitch))].join(',')}`);
    console.log(`  repeticiones de la misma altura: ${gaps.length} · hueco min ${Math.min(...gaps)} / max ${Math.max(...gaps)} ticks · defectos ${defects(an).length}`);
    console.log(`  ${t.wav.name} · ${w.channels} ch · ${w.sampleRate} Hz (ctx ${sr}) · ${w.bits} bit · ${w.seconds.toFixed(2)} s · pico ${w.peak.toFixed(3)}`);
    assert.equal(parsed.format, 0);
    assert.equal(parsed.ppq, 96);
    assert.equal(Math.round(parsed.tempoBpm), bpm);
    assert.equal(parsed.trackName, 'ZERO DAY NEBULARP 2035');
    assert.ok(an.notes.length > 10, 'tiene que haber notas');
    assert.ok(gaps.length > 0, 'el caso tiene que tener repeticiones de la misma altura');
    assert.deepEqual(defects(an), [], 'MIDI sano: sin off-después-de-on, solapes, colgadas ni duración cero');
    assert.ok(Math.min(...gaps) >= 1, 'el hueco de 1,5 ticks de endTake() sigue (redondea a 1 o 2)');
    assert.equal(w.format, 1); assert.equal(w.bits, 16); assert.equal(w.channels, 2);
    assert.equal(w.sampleRate, sr);
    assert.ok(w.seconds > 3.5 && w.seconds < 5.5, `duración ${w.seconds}`);
    assert.ok(w.peak > 0.01, 'el WAV no puede estar en silencio');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Nebularp · REC: Chord, pad sostenido al cortar y autoplay → MIDI sano', async () => {
  const { ctx, page, errors } = await open({ width: 1440, height: 900 });
  try {
    const out = [];
    // Chord con gate 150 %: todas las notas del acorde se repiten cada paso
    await page.click('#patternSeg button[data-val="chord"]');
    await knobKey(page, 'Gate', 'End');
    await page.click('#play');
    await page.keyboard.down('a'); await page.keyboard.down('d'); await page.keyboard.down('g');
    let t = await takeOf(page, 2500);
    await page.keyboard.up('a'); await page.keyboard.up('d'); await page.keyboard.up('g');
    await page.click('#play');
    assert.deepEqual(defects(t.an), [], 'Chord: ' + defects(t.an).join('; '));
    assert.ok(t.an.notes.length >= 6);
    out.push(`Chord ${t.an.notes.length} notas`);

    // pad con el transporte parado, una tecla apretada al cortar la toma
    await page.waitForTimeout(300);
    t = await takeOf(page, 600, async () => {
      await page.keyboard.down('a'); await page.waitForTimeout(500); await page.keyboard.up('a');
      await page.keyboard.down('s');
    }, { beforeStop: async () => {} });
    await page.keyboard.up('s');
    assert.deepEqual(defects(t.an), [], 'pad: ' + defects(t.an).join('; '));
    assert.equal(t.an.notes.length, 2, 'pad: dos notas, la segunda cerrada al final de la toma');
    const last = t.parsed.events.find((e) => e.kind === 'eot');
    assert.ok(t.an.notes[1].end <= last.tick, 'la nota sostenida se cierra antes del End of Track');
    out.push(`pad 2 notas (la sostenida cierra en ${t.an.notes[1].end}/${last.tick})`);

    // autoplay (prende el transporte solo)
    await page.click('#patternSeg button[data-val="up"]').catch(() => {});
    await page.click('#autoTgl');
    t = await takeOf(page, 3000);
    await page.click('#autoTgl');
    if (await page.locator('#play[aria-pressed="true"]').count()) await page.click('#play');
    assert.deepEqual(defects(t.an), [], 'autoplay: ' + defects(t.an).join('; '));
    assert.ok(t.an.notes.length > 4);
    out.push(`autoplay ${t.an.notes.length} notas`);
    console.log('  ' + out.join(' · ') + ' · 0 defectos');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ───────────────────────────────── R5 · audio ─────────────────────────────────

test('Nebularp · audio: destrabar, sonar, suspend → overlay → resume', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    assert.equal(await page.evaluate(() => window.__ctxs.length), 0);
    await page.click('#play');
    await page.waitForTimeout(400);
    await page.keyboard.down('a'); await page.keyboard.down('g');
    await page.waitForTimeout(500);
    const on = await page.evaluate(() => ({ n: window.__ctxs.length, state: window.__ctxs[0].state, hint: window.__ctxOpts[0] && window.__ctxOpts[0].latencyHint, unlocked: ZD.audio.unlocked, starts: window.__starts }));
    assert.equal(on.n, 1); assert.equal(on.state, 'running'); assert.equal(on.hint, 'interactive'); assert.equal(on.unlocked, true);
    await page.waitForTimeout(500);
    const s1 = await page.evaluate(() => window.__starts);
    assert.ok(s1 > on.starts, 'el arpegio tiene que estar programando voces');

    await page.evaluate(() => window.__ctxs[0].suspend());
    await page.waitForTimeout(300);
    const ov = await page.evaluate(() => ({ state: window.__ctxs[0].state, overlay: !!document.querySelector('.zd-resume.on') }));
    assert.equal(ov.state, 'suspended');
    assert.equal(ov.overlay, true, 'con el transporte sonando, suspend muestra "Tocá para reanudar"');
    await page.click('.zd-resume.on');
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => ({ state: window.__ctxs[0].state, overlay: !!document.querySelector('.zd-resume.on'), playing: document.getElementById('play').getAttribute('aria-pressed'), starts: window.__starts }));
    assert.equal(back.state, 'running'); assert.equal(back.overlay, false); assert.equal(back.playing, 'true');
    await page.waitForTimeout(500);
    const s2 = await page.evaluate(() => window.__starts);
    assert.ok(s2 > back.starts, 'después de reanudar el arpegio sigue programando voces');

    // segundo plano y volver
    await page.evaluate(() => window.__ctxs[0].suspend());
    await page.waitForTimeout(150);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(400);
    const vis = await page.evaluate(() => ({ state: window.__ctxs[0].state, overlay: !!document.querySelector('.zd-resume.on') }));
    await page.keyboard.up('a'); await page.keyboard.up('g');

    // con el transporte parado, suspend no muestra el overlay
    if (vis.overlay) { await page.click('.zd-resume.on'); await page.waitForTimeout(300); }
    await page.click('#play');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__ctxs[0].suspend());
    await page.waitForTimeout(300);
    const stopped = await page.evaluate(() => !!document.querySelector('.zd-resume.on'));
    console.log(`  1 contexto · interactive · running · suspend → overlay → toque → ${back.state} (voces ${on.starts}→${s1}→${s2}) · visibilitychange → ${vis.state}${vis.overlay ? ' + overlay' : ''} · parado: overlay=${stopped}`);
    assert.equal(stopped, false);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ──────────────── rotación de tablet con el arpegio sonando ───────────────────

test('Nebularp · rotación de tablet 1180×820 ↔ 820×1180 con el arpegio sonando', async () => {
  const { ctx, page, errors } = await open({ width: 1180, height: 820 });
  try {
    await page.click('#latch');
    await page.keyboard.down('a'); await page.keyboard.down('d'); await page.keyboard.down('g');
    await page.waitForTimeout(100);
    await page.keyboard.up('a'); await page.keyboard.up('d'); await page.keyboard.up('g');
    await page.click('#play');
    await page.waitForTimeout(500);
    assert.equal(await ctxState(page), 'running');
    const t0 = await page.evaluate(() => window.__ctxs[0].currentTime);
    const held0 = (await snapshot(page)).held;
    assert.ok(held0.length >= 3, 'acorde latcheado');
    let starts = await page.evaluate(() => window.__starts);
    const steps = [];
    for (let i = 1; i <= 4; i++) {
      for (const v of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
        await page.setViewportSize(v);
        await page.waitForTimeout(350);
        const s = await page.evaluate(() => ({
          shell: !!(ZD.mobile && ZD.mobile.active), state: window.__ctxs[0].state,
          playing: document.getElementById('play').getAttribute('aria-pressed'),
          starts: window.__starts, orbit: document.querySelector('.orbit-center .big') ? document.querySelector('.orbit-center .big').textContent : '',
          scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
          play: (() => { const r = document.getElementById('play').getBoundingClientRect(); return r.width > 0 && r.height >= 44; })(),
          piano: (() => { const r = document.querySelector('.piano').getBoundingClientRect(); const inShell = !!(ZD.mobile && ZD.mobile.active); return r.width > 0 && r.height > 0 && (!inShell || r.bottom <= innerHeight + 1); })(),
        }));
        const where = `vuelta ${i} · ${v.width}×${v.height}`;
        assert.equal(s.state, 'running', `${where}: audio`);
        assert.equal(s.playing, 'true', `${where}: transporte`);
        assert.equal(s.shell, v.width === 820, `${where}: shell`);
        assert.ok(s.starts > starts, `${where}: el arpegio dejó de programar voces`);
        assert.ok(s.play, `${where}: PLAY visible y ≥44`);
        assert.ok(s.piano, `${where}: piano visible`);
        assert.ok(s.scrollW <= s.clientW + 1, `${where}: scroll horizontal`);
        assert.deepEqual(await stageKids(page), s.shell ? KEEP : [], `${where}: stage`);
        starts = s.starts; steps.push(s.orbit);
      }
    }
    const t1 = await page.evaluate(() => window.__ctxs[0].currentTime);
    const held1 = (await snapshot(page)).held;
    assert.deepEqual(held1, held0, 'el acorde latcheado sobrevive las rotaciones');
    console.log(`  8 rotaciones sonando · ctx ${t0.toFixed(2)}→${t1.toFixed(2)} s · voces ${starts} · notas en la órbita ${[...new Set(steps)].join(',')} · latch [${held1.join(' ')}]`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

// ─────────────────────────── SPEC 3.2 · file:// e iframe ──────────────────────

test('Nebularp · file://: sin SW, sin red, con el aviso del archivo local', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url()); });
  try {
    await page.goto(pathToFileURL(join(ROOT, FILE)).href, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({
      active: ZD.pwa.active, registered: ZD.pwa.registered,
      local: !!document.querySelector('.zd-pwa-local'),
      openWeb: (document.querySelector('.zd-pwa-local a') || {}).href || null,
      shell: ZD.mobile.active, stage: document.getElementById('zd-stage').children.length,
    }));
    assert.equal(s.active, false); assert.equal(s.registered, false); assert.equal(s.local, true);
    assert.match(String(s.openWeb), /^https:\/\/.+Nebularp_2035\.html$/);
    assert.deepEqual(requests, []);
    // el aviso no tapa el piano
    const note = await rect(page, '.zd-pwa-local');
    for (const sel of ['#play', '.piano', '.octctl']) assert.ok(!overlap(note, await rect(page, sel)), `aviso tapa ${sel}`);
    console.log(`  file:// · SW no · aviso local → ${s.openWeb} · 0 pedidos de red · shell=${s.shell}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Nebularp · hosted: SW registrado y manifest de Nebularp', async () => {
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  try {
    await page.waitForFunction(() => window.ZD && ZD.pwa && ZD.pwa.registered, null, { timeout: 15000 });
    const s = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return { manifest: ZD.pwa.manifest, scopes: regs.map((r) => r.scope), scripts: regs.map((r) => (r.active || r.installing || r.waiting).scriptURL),
        theme: document.querySelector('meta[name=theme-color]').content, canonical: document.querySelector('link[rel=canonical]').href };
    });
    assert.match(s.manifest, /manifests\/nebularp\.webmanifest$/);
    assert.equal(s.scopes.length, 1);
    assert.match(s.scripts[0], /\/sw\.js$/);
    assert.match(s.canonical, /^https:\/\/.+\/descargables\/Nebularp_2035\.html$/);
    console.log(`  SW ${s.scripts[0]} · scope ${s.scopes[0]} · ${s.manifest} · theme ${s.theme}`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Nebularp · iframe (360 px): zd-pwa inerte, shell activo, sin errores', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(HOOKS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  try {
    await page.goto(srv.origin + IFRAME_PATH, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const frame = page.frames().find((f) => f.url().includes('Nebularp_2035.html'));
    const s = await frame.evaluate(() => ({
      top: window.top === window, active: ZD.pwa.active, registered: ZD.pwa.registered,
      banner: !!document.querySelector('.zd-pwa-banner, .zd-pwa-local'), css: !!document.getElementById('zd-pwa-css'),
      shell: !!(ZD.mobile && ZD.mobile.active), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    }));
    assert.equal(s.top, false); assert.equal(s.active, false); assert.equal(s.registered, false);
    assert.equal(s.banner, false); assert.equal(s.css, false);
    assert.equal(s.shell, true, 'a 360 px el shell entra también en el iframe');
    assert.ok(s.scrollW <= s.clientW + 1);
    // y suena dentro del iframe
    await frame.click('#play');
    await page.waitForTimeout(300);
    const st = await frame.evaluate(() => window.__ctxs[0] && window.__ctxs[0].state);
    assert.equal(st, 'running');
    console.log(`  iframe · ZD.pwa inerte · shell=${s.shell} · audio ${st} · 0 errores`);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
