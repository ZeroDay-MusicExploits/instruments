#!/usr/bin/env node
// reports/F3-barrido-scroll.mjs
//
// Mediciones de reports/F3-barrido-scroll.md. No es un test de aceptación: no
// falla por lo que encuentra, imprime lo que mide para que el reporte no
// dependa solo de leer código.
//
// Para cada sheet de cada instrumento (360×640 por defecto, el teléfono
// mínimo de SPEC R1), con gestos táctiles reales por CDP
// (tools/tests/lib/touch.mjs: pasan por touch-action, el scroll nativo y el
// ajuste de toque de Chromium):
//
//   knob     swipe vertical (dedo 120 px hacia arriba, 4 px de deriva) que
//            arranca en el centro de un knob de arrastre vertical
//            ([role=slider] que no es input y tiene touch-action:none).
//   slider   el mismo swipe sobre el slider alternativo (<input type=range>),
//            desde la pista (lejos de la perilla) y desde la perilla, y un
//            toque en la pista.
//   otra     el mismo swipe sobre otra superficie con touch-action:none del
//            sheet (teclado, tira, canvas).
//   carril   el mismo swipe en el carril lateral de zd-mobile v5.
//
// Por cada gesto: cuánto scrolleó el sheet y qué valores cambiaron (input/
// select y aria-valuenow del documento). Se mide hasta 3 elementos de cada
// tipo por sheet (primero, del medio, último) y la página se recarga por sheet.
// Además, qué porcentaje del área del contenido (sin el carril) ocupan las
// cajas que agarran el dedo: knobs, sliders nativos y otras superficies con
// touch-action:none.
//
//   node reports/F3-barrido-scroll.mjs                      # Acid, Nebularp, MonoMoon, J4
//   node reports/F3-barrido-scroll.mjs --file CronBeat-808.html   # referencia (después del arreglo)
//   node reports/F3-barrido-scroll.mjs --vp 390x844 --json /tmp/f3.json
//
// Necesita Playwright + Chromium (no es dependencia del runtime).
import { writeFileSync } from 'node:fs';
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';
import { swipe, tap, settleScroll } from '../tools/tests/lib/touch.mjs';

const argv = process.argv.slice(2);
const arg = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const FILES = argv.includes('--file') ? [arg('--file').replace(/^.*\//, '')]
  : ['Acid_Bass-303.html', 'Nebularp_2035.html', 'MonoMoon70.html', 'J4-Sirens_Station.html'];
const [W, H] = arg('--vp', '360x640').split('x').map(Number);
const JSON_OUT = arg('--json', null);
const SB = '#zd-sheet .zd-sbody';
const POWER = ['#power', '#powerOvl'];

const srv = await serveRoot(ROOT);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const out = (s) => console.log(s);
const results = [];

/* Valores con nombre: input/select por id o aria-label, y aria-valuenow. */
const VALUES = () => {
  const o = {};
  const nm = (e, i) => e.getAttribute('aria-label') || e.id || (e.tagName.toLowerCase() + i);
  document.querySelectorAll('input,select').forEach((e, i) => { if (e.type !== 'file') o['in:' + nm(e, i)] = e.type === 'checkbox' ? e.checked : e.value; });
  document.querySelectorAll('[aria-valuenow]:not(input)').forEach((e, i) => { o['aria:' + nm(e, i)] = e.getAttribute('aria-valuenow'); });
  return o;
};
const diff = (a, b) => Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `${k.replace(/^(in|aria):/, '')} ${a[k]}→${b[k]}`);

/* Marca hasta 3 elementos de cada tipo (primero, del medio, último). */
const MARK = () => {
  const pane = document.querySelector('#zd-sheet .zd-pane.on');
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.getClientRects().length; };
  const all = [...pane.querySelectorAll('*')].filter(vis);
  const ta = (e) => getComputedStyle(e).touchAction;
  const knobs = all.filter((e) => e.getAttribute('role') === 'slider' && e.tagName !== 'INPUT' && ta(e) === 'none');
  const sliders = all.filter((e) => e.tagName === 'INPUT' && e.type === 'range');
  const inside = (e, list) => list.some((k) => k !== e && k.contains(e));
  const other = all.filter((e) => ta(e) === 'none' && !knobs.includes(e) && !sliders.includes(e) && !inside(e, knobs) && !knobs.some((k) => e.contains(k))
    && !inside(e, all.filter((x) => ta(x) === 'none' && x !== e)));
  const pick = (list) => [...new Set([list[0], list[Math.floor(list.length / 2)], list[list.length - 1]])].filter(Boolean);
  document.querySelectorAll('[data-f3]').forEach((e) => e.removeAttribute('data-f3'));
  const res = [];
  for (const [kind, list] of [['knob', knobs], ['slider', sliders], ['otra', other]]) {
    pick(list).forEach((e, i) => {
      const id = kind + i;
      e.setAttribute('data-f3', id);
      res.push({ id, kind, total: list.length, ta: ta(e), label: e.getAttribute('aria-label') || e.id || e.className || e.tagName });
    });
  }
  const sb = document.querySelector('#zd-sheet .zd-sbody');
  /* Qué parte del área del contenido (todo el alto, sin el carril) agarra el
     dedo: grilla de puntos cada 4 px contra las cajas de cada tipo. En CronBeat
     los sliders del sheet ya no agarran (pointer-events:none): no cuentan. */
  const pr = pane.getBoundingClientRect(), cover = { knob: 0, slider: 0, otra: 0, total: 0 };
  const boxes = (list) => list.map((e) => e.getBoundingClientRect());
  const grab = (e) => getComputedStyle(e).pointerEvents !== 'none';
  const B = { knob: boxes(knobs), slider: boxes(sliders.filter(grab)), otra: boxes(other) };
  let n = 0;
  for (let y = pr.top + 2; y < pr.bottom; y += 4) for (let x = pr.left + 2; x < pr.right; x += 4) {
    n++;
    let any = false;
    for (const k of ['knob', 'slider', 'otra']) if (B[k].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) { cover[k]++; any = true; }
    if (any) cover.total++;
  }
  for (const k in cover) cover[k] = n ? Math.round(cover[k] / n * 100) : 0;
  return { items: res, cover, scrollMax: sb.scrollHeight - sb.clientHeight, peek: document.getElementById('zd-sheet').classList.contains('peek') };
};

/* Deja el elemento a media altura del sheet y devuelve dónde tocar. */
const PLACE = (id) => {
  const e = document.querySelector(`[data-f3="${id}"]`), sb = document.querySelector('#zd-sheet .zd-sbody');
  const rel = e.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop;
  sb.scrollTop = Math.max(0, rel - sb.clientHeight * 0.6 + e.getBoundingClientRect().height / 2);
  const r = e.getBoundingClientRect(), s = sb.getBoundingClientRect();
  let thumb = null;
  if (e.tagName === 'INPUT') {
    const min = +e.min || 0, max = +e.max || 100, v = +e.value;
    // la perilla nativa mide ~16-20 px; su centro recorre el ancho menos eso
    thumb = r.left + 9 + (v - min) / (max - min || 1) * (r.width - 18);
  }
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, w: r.width, thumb, st: sb.scrollTop, max: sb.scrollHeight - sb.clientHeight,
    top: s.top, bottom: s.bottom, railX: s.left + sb.clientLeft + sb.clientWidth - parseFloat(getComputedStyle(sb).paddingRight) / 2,
    rail: parseFloat(getComputedStyle(sb).paddingRight) };
};

async function powerOn(page) {
  const sel = await page.evaluate((list) => list.find((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return false;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && +cs.opacity > 0; }) || null, POWER);
  if (!sel) return;
  await page.click(sel);
  await page.waitForTimeout(600);
}

async function gesture(page, kind, fn) {
  const v0 = await page.evaluate(VALUES);
  const st0 = await page.evaluate((s) => document.querySelector(s).scrollTop, SB);
  await fn();
  const st1 = await settleScroll(page, SB);
  const v1 = await page.evaluate(VALUES);
  // un modal abierto por el gesto (long-press = entrada numérica) se cierra
  const modal = await page.evaluate(() => !!document.querySelector('.zd-scrim'));
  if (modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  return { kind, dScroll: Math.round(st1 - st0), changed: diff(v0, v1), modal };
}

for (const file of FILES) {
  out(`\n## ${file} · ${W}×${H}`);
  const ctx0 = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
  const p0 = await ctx0.newPage();
  await p0.goto(`${srv.origin}/descargables/${file}`, { waitUntil: 'load' });
  await p0.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active), null, { timeout: 10000 });
  const tabs = await p0.evaluate(() => (window.ZD_M.tabs || []).slice(0, 5).map((t) => ({ id: t.id, label: t.label })));
  await ctx0.close();

  for (const t of tabs) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`${srv.origin}/descargables/${file}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.ZD && ZD.mobile && ZD.mobile.active), null, { timeout: 10000 });
    await powerOn(page);
    await page.evaluate((id) => { ZD.mobile.open(id); document.querySelector('#zd-sheet .zd-sbody').scrollTop = 0; }, t.id);
    await page.waitForTimeout(300);
    const m = await page.evaluate(MARK);
    const row = { file, tab: t.label, peek: m.peek, scrollMax: m.scrollMax, cover: m.cover, items: [] };
    const count = (k) => (m.items.find((i) => i.kind === k) || { total: 0 }).total;
    out(`\n### ${t.label}${m.peek ? ' (peek)' : ''} · scroll máx ${m.scrollMax}px · knobs ${count('knob')} · sliders ${count('slider')} · otras touch-action:none ${count('otra')}`);
    out(`- agarra el dedo: ${m.cover.total}% del contenido (knobs ${m.cover.knob}% · sliders nativos ${m.cover.slider}% · otras ${m.cover.otra}%)`);

    for (const it of m.items) {
      const p = await page.evaluate(PLACE, it.id);
      await page.waitForTimeout(60);
      const g = await page.evaluate(PLACE, it.id);
      const D = Math.min(120, (g.cy - g.top) - 8);
      const up = g.max - g.st >= 30 ? -1 : 1;
      const mk = (x) => () => swipe(page, { x, y: g.cy }, { x: x + 4, y: g.cy + up * D });
      const res = { ...it, gestures: [] };
      if (it.kind === 'slider') {
        const track = Math.abs(g.left + g.w * 0.1 - g.thumb) > Math.abs(g.left + g.w * 0.9 - g.thumb) ? g.left + g.w * 0.1 : g.left + g.w * 0.9;
        res.gestures.push(await gesture(page, 'swipe desde la pista', mk(track)));
        const g2 = await page.evaluate(PLACE, it.id);
        res.gestures.push(await gesture(page, 'swipe desde la perilla', () => swipe(page, { x: g2.thumb, y: g2.cy }, { x: g2.thumb + 4, y: g2.cy + up * D })));
        const g3 = await page.evaluate(PLACE, it.id);
        const tr3 = Math.abs(g3.left + g3.w * 0.1 - g3.thumb) > Math.abs(g3.left + g3.w * 0.9 - g3.thumb) ? g3.left + g3.w * 0.1 : g3.left + g3.w * 0.9;
        res.gestures.push(await gesture(page, 'toque en la pista', () => tap(page, { x: tr3, y: g3.cy })));
      } else {
        res.gestures.push(await gesture(page, 'swipe vertical', mk(g.cx)));
      }
      row.items.push(res);
      for (const ge of res.gestures) {
        out(`- ${it.kind} «${String(it.label).slice(0, 40)}» (touch-action ${it.ta}) · ${ge.kind}: scroll ${ge.dScroll >= 0 ? '+' : ''}${ge.dScroll}px · ` +
          (ge.changed.length ? `CAMBIA ${ge.changed.slice(0, 3).join(', ')}${ge.changed.length > 3 ? ` (+${ge.changed.length - 3})` : ''}` : 'no cambia nada') +
          (ge.modal ? ' · abrió un modal' : ''));
      }
    }
    // el carril
    const g = await page.evaluate(() => { const sb = document.querySelector('#zd-sheet .zd-sbody'); sb.scrollTop = 0; const s = sb.getBoundingClientRect();
      return { x: s.left + sb.clientLeft + sb.clientWidth - parseFloat(getComputedStyle(sb).paddingRight) / 2, top: s.top, bottom: s.bottom, rail: parseFloat(getComputedStyle(sb).paddingRight) }; });
    await page.waitForTimeout(60);
    const r = await gesture(page, 'swipe en el carril', () => swipe(page, { x: g.x, y: g.top + (g.bottom - g.top) * 0.8 }, { x: g.x + 2, y: g.top + (g.bottom - g.top) * 0.2 }));
    row.rail = { width: g.rail, ...r };
    out(`- carril (${g.rail}px) · swipe vertical: scroll ${r.dScroll >= 0 ? '+' : ''}${r.dScroll}px · ${r.changed.length ? 'CAMBIA ' + r.changed.join(', ') : 'no cambia nada'}`);
    results.push(row);
    await ctx.close();
  }
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
await browser.close();
await srv.close();
