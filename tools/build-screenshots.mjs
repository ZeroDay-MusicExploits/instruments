#!/usr/bin/env node
// Regenera las capturas del README en docs/screenshots/ (Playwright + Chromium):
//   home.webp             index.html en escritorio (1200×900)
//   landing-mobile.webp   landing de CronBeat en 390×844
//   <slug>-390x844.webp   cada instrumento en vertical, con el shell móvil (touch)
// node tools/build-screenshots.mjs [--only <slug>]
// Convierte a WebP con ffmpeg (libwebp); si no está, deja los PNG.
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serveRoot, loadPlaywright } from './tests/lib/serve.mjs';
import { ROOT } from './tests/lib/load-block.mjs';

const data = JSON.parse(readFileSync(join(ROOT, 'data/instrumentos.json'), 'utf8'));
const OUT = join(ROOT, 'docs/screenshots');
const TMP = join(tmpdir(), 'zd-shots');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null;

function toWebp(name) {
  const png = join(TMP, name + '.png');
  const webp = join(OUT, name + '.webp');
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', webp]);
    console.log('captura:', `docs/screenshots/${name}.webp`);
  } catch {
    execFileSync('cp', [png, join(OUT, name + '.png')]);
    console.log('captura (PNG, sin ffmpeg/libwebp):', `docs/screenshots/${name}.png`);
  }
}

const pw = await loadPlaywright();
const srv = await serveRoot();
const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  if (!only) {
    const desk = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await desk.newPage();
    await p.goto(srv.origin + '/index.html', { waitUntil: 'load' });
    await p.screenshot({ path: join(TMP, 'home.png') });
    await desk.close();
    toWebp('home');

    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const m = await mob.newPage();
    await m.goto(srv.origin + '/' + data.instruments.cronbeat.page, { waitUntil: 'load' });
    await m.screenshot({ path: join(TMP, 'landing-mobile.png') });
    await mob.close();
    toWebp('landing-mobile');
  }
  for (const slug of data.order) {
    if (only && only !== slug) continue;
    const I = data.instruments[slug];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(srv.origin + '/' + I.file.replace(/^\.\//, ''), { waitUntil: 'load' });
    await page.waitForTimeout(800);
    // MonoMoon y J4 abren con una pantalla de encendido: un toque la quita.
    for (const sel of ['#powerOvl', '#power']) {
      const el = await page.$(sel);
      if (el && await el.isVisible()) { await el.tap().catch(() => {}); await page.waitForTimeout(700); }
    }
    // el banner de instalar no suele estar en una captura de documentación
    await page.evaluate(() => document.querySelectorAll('.zd-pwa-banner').forEach((b) => b.remove()));
    await page.screenshot({ path: join(TMP, slug + '-390x844.png') });
    await ctx.close();
    toWebp(slug + '-390x844');
  }
} finally {
  await browser.close();
  await srv.close();
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
}
