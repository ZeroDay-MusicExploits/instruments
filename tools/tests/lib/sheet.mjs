// Andamiaje común de los tests de gestos en los sheets del shell móvil
// (zd-sheet-input, sheet-knobs, sheets-layout): abrir un instrumento con
// toques, pasar la pantalla de encendido, abrir una pestaña y sacar la huella
// de todos los valores del documento. Sin dependencias.
import { serveRoot, loadPlaywright } from './serve.mjs';

export const SB = '#zd-sheet .zd-sbody';
export const FOUR = ['Acid_Bass-303.html', 'Nebularp_2035.html', 'MonoMoon70.html', 'J4-Sirens_Station.html'];
export const FIVE = ['Acid_Bass-303.html', 'CronBeat-808.html', 'J4-Sirens_Station.html', 'MonoMoon70.html', 'Nebularp_2035.html'];
export const PHONE = { width: 360, height: 640 };
export const VIEWPORTS = [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }];

/** `--file X.html` filtra la lista. */
export function filesFromArgv(list) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--file') ? argv[argv.indexOf('--file') + 1].replace(/^.*\//, '') : null;
  const out = list.filter((f) => !only || f === only);
  if (!out.length) { console.error(`--file ${only}: no es uno de ${list.join(', ')}`); process.exit(2); }
  return out;
}

/** Servidor + Chromium para todo el archivo de test. */
export async function harness() {
  const srv = await serveRoot();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  return { srv, browser, close: async () => { await browser.close(); await srv.close(); } };
}

/* J4 (#power) y MonoMoon (#powerOvl) arrancan con una pantalla de encendido
   que tapa todo hasta el primer toque: sin esto el gesto cae en ella. */
const POWER = ['#power', '#powerOvl'];
async function powerOn(page) {
  const shown = (sels) => sels.find((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && +cs.opacity > 0;
  }) || null;
  const sel = await page.evaluate(shown, POWER);
  if (!sel) return;
  await page.click(sel);
  await page.waitForFunction(`!(${shown})(${JSON.stringify([sel])})`, null, { timeout: 8000 });
}

/** Abre `file` (de descargables/) con toques y el shell activo. */
export async function open(h, file, vp = PHONE) {
  const ctx = await h.browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${h.srv.origin}/descargables/${file}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active && ZD.mobile.pane), null, { timeout: 10000 });
  await powerOn(page);
  const tabs = await page.evaluate(() => (window.ZD_M.tabs || []).slice(0, 5).map((t) => ({ id: t.id, label: t.label, peek: !!t.peek })));
  return { ctx, page, errors, tabs };
}

/** Recarga la misma página (mismo contexto: el autoguardado sigue ahí). */
export async function reload(page) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active && ZD.mobile.pane), null, { timeout: 10000 });
  await powerOn(page);
}

export const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

export async function openTab(page, id, wait = 260) {
  await page.evaluate((id) => { ZD.mobile.open(id); document.querySelector('#zd-sheet .zd-sbody').scrollTop = 0; }, id);
  if (wait) await page.waitForTimeout(wait);   // el sheet entra con una transición de 180 ms
  await frames(page);
}

/** Cierra un modal que haya quedado abierto (long-press, Enter). */
export async function closeModal(page) {
  if (await page.evaluate(() => !!document.querySelector('.zd-scrim'))) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

/* Huella de todos los valores del documento: inputs/selects, aria-valuenow de
   los knobs y botones con estado. Si un gesto cambió un parámetro, cambia. */
export const VALUES = () => {
  const out = [];
  const nm = (e, i) => e.getAttribute('aria-label') || e.id || e.tagName.toLowerCase() + i;
  document.querySelectorAll('input,select,textarea').forEach((e, i) => {
    if (e.type !== 'file') out.push(nm(e, i) + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value));
  });
  document.querySelectorAll('[aria-valuenow],[aria-pressed],[aria-checked]').forEach((e, i) => {
    if (e.tagName !== 'INPUT') out.push(nm(e, i) + '=' + [e.getAttribute('aria-valuenow'), e.getAttribute('aria-pressed'), e.getAttribute('aria-checked')].join('/'));
  });
  return out;
};
export const diffValues = (a, b) => b.map((v, i) => (v !== a[i] ? `${a[i]} → ${v.replace(/^.*=/, '')}` : null)).filter(Boolean);

/** Lleva el elemento `sel` a media altura del cuerpo del sheet (hasta donde dé el scroll). */
export const center = (page, sel) => page.evaluate((sel) => {
  const e = document.querySelector(sel), sb = document.querySelector('#zd-sheet .zd-sbody');
  const rel = e.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop;
  sb.scrollTop = Math.max(0, rel - sb.clientHeight / 2 + e.getBoundingClientRect().height / 2);
}, sel);

/** Datos del cuerpo del sheet para planear un swipe vertical. */
export const body = (page) => page.evaluate(() => {
  const sb = document.querySelector('#zd-sheet .zd-sbody'), r = sb.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, st: sb.scrollTop, max: sb.scrollHeight - sb.clientHeight };
});
