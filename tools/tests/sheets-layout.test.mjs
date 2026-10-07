#!/usr/bin/env node
// tools/tests/sheets-layout.test.mjs
//
// Los sheets de los 5 instrumentos en el teléfono y la tablet: sin scroll
// horizontal y sin controles de menos de 44 px (SPEC R1), a 360×640, 390×844,
// 768×1024 y 844×390.
//
//   node tools/tests/sheets-layout.test.mjs
//   node tools/tests/sheets-layout.test.mjs --file MonoMoon70.html   # uno solo
//
// Mide, en cada pestaña, todo lo que se toca o se enfoca adentro del pane
// (botones, inputs, selects, links, role=slider/button/…, tabindex y lo que
// tenga touch-action:none). Acepta la grilla de 8 de SPEC R1 (≥38 de ancho
// con ≥48 de alto). Lo que ya medía menos de 44 antes de F3 y no es de esta
// tarea está en KNOWN, con nombre y pestaña: no falla, se lista. Una entrada de
// KNOWN que ya no aparece en ningún viewport hace fallar el test (hay que
// sacarla de la lista), así la lista no queda vieja.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIVE, VIEWPORTS, harness, open, openTab, filesFromArgv } from './lib/sheet.mjs';

const FILES = filesFromArgv(FIVE);

/* Controles que ya medían <44 px (ver tools/tests/zd-mobile-rail.test.mjs, "ya
   medían <44 px antes del carril"), por instrumento: [pestaña, nombre]. El
   nombre es '#id' o 'tag.primeraClase' (o 'tag' sin clase), exacto. */
const KNOWN = {
  // botones, select e input de texto de 40 px de alto y chips de 38 (skin de Acid)
  'Acid_Bass-303.html': [
    ['SEQ', '#tapBtn'], ['SEQ', '#octDown'], ['SEQ', '#octUp'], ['SEQ', '#initBtn'], ['SEQ', '#clearBtn'], ['SEQ', '#kbOctDown'], ['SEQ', '#kbOctUp'],
    ['SONIDO', 'button.sel'], ['SONIDO', 'button'], ['FILTRO', 'button.sel'], ['FILTRO', 'button'],
    ['PATRÓN', '#scaleSel'], ['PATRÓN', '#randBtn'], ['PATRÓN', '#mutBtn'], ['PATRÓN', 'button.chip'],
    ['EXPORT', '#patchName'], ['EXPORT', '#saveJson'], ['EXPORT', '#loadJson'], ['EXPORT', '#expMidi'], ['EXPORT', '#barsSel'], ['EXPORT', '#expWav'], ['EXPORT', '#bankSave'],
  ],
  'CronBeat-808.html': [],
  // botones de forma de onda del LFO (30–35 de ancho), casillas de 14 px de los
  // efectos y links de texto de la sesión
  'J4-Sirens_Station.html': [
    ['ENV·LFO', 'button.on'], ['ENV·LFO', 'button'], ['FX', '#echoOn'], ['FX', '#revOn'], ['FX', '#phOn'], ['SESIÓN', 'a'],
  ],
  // interruptores de 48×28, el ✕ de borrar patch (43×44) y links de texto
  'MonoMoon70.html': [
    ['OSC', 'div.toggle'], ['OSC', '#noiseTog'], ['MOD', '#osc3KbdTog'], ['MOD', '#oscModTog'], ['MOD', '#filtModTog'], ['MOD', '#glideTog'],
    ['PATCHES', '#btnDelPatch'], ['PATCHES', 'a'],
  ],
  // botones de escala/arpegio de 33–41 de ancho y links de texto
  'Nebularp_2035.html': [['ESCALA', 'button'], ['ARP', 'button'], ['TECLADO', 'a']],
};
/* Pestañas que desbordan a lo ancho por algo de antes: { archivo: [[viewport,
   pestaña]] }. Estuvieron FILTRO y VOZ de MonoMoon a 844×390 (desde zd-mobile
   v4), que se arreglaron en su skin (F3, tarea 4): la lista quedó vacía. */
const KNOWN_HSCROLL = {};

const PROBE = () => {
  const CTL = 'button,input:not([type=hidden]),select,textarea,a[href],[role=slider],[role=button],[role=switch],[role=checkbox],[role=tab],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  const pane = document.querySelector('#zd-sheet .zd-pane.on'), sb = document.querySelector('#zd-sheet .zd-sbody');
  const set = new Set(pane.querySelectorAll(CTL));
  pane.querySelectorAll('*').forEach((e) => { if (getComputedStyle(e).touchAction === 'none') set.add(e); });
  const out = [];
  set.forEach((e) => {
    const b = e.getBoundingClientRect();
    if (!b.width || !b.height || !e.getClientRects().length) return;
    const name = e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '');
    out.push({ name, w: b.width, h: b.height });
  });
  return { ctls: out, sw: sb.scrollWidth, cw: sb.clientWidth, doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
};

let h;
test.before(async () => { h = await harness(); });
test.after(async () => { if (h) await h.close(); });

for (const file of FILES) {
  test(`${file} · sheets: sin scroll horizontal y sin controles <44 px (360×640, 390×844, 768×1024, 844×390)`, async () => {
    const known = KNOWN[file] || [], knownH = KNOWN_HSCROLL[file] || [];
    const usedK = new Set(), usedH = new Set();
    for (const vp of VIEWPORTS) {
      const vpl = `${vp.width}×${vp.height}`;
      const { ctx, page, errors, tabs } = await open(h, file, vp);
      try {
        const small = [], listed = [];
        let n = 0;
        for (const t of tabs) {
          await openTab(page, t.id, 0);
          const r = await page.evaluate(PROBE);
          n += r.ctls.length;
          for (const c of r.ctls) {
            const grid8 = c.w >= 37.5 && c.h >= 47.5;          // SPEC R1: grilla de 8 con alto ≥48
            if (Math.min(c.w, c.h) >= 43.5 || grid8) continue;  // 44 de CSS a veces mide 43,99
            const k = known.findIndex(([tab, name]) => tab === t.label && name === c.name);
            const msg = `${t.label} ${c.name} ${Math.round(c.w)}×${Math.round(c.h)}`;
            if (k >= 0) { usedK.add(k); listed.push(msg); } else small.push(msg);
          }
          const hs = r.sw > r.cw + 1;
          const kh = knownH.findIndex(([v, tab]) => v === vpl && tab === t.label);
          if (hs && kh >= 0) { usedH.add(kh); listed.push(`${t.label} scroll horizontal ${r.sw} > ${r.cw}`); }
          else assert.ok(!hs, `${file} ${vpl} · ${t.label}: scroll horizontal en el sheet (${r.sw} > ${r.cw})`);
          assert.equal(r.doc, false, `${file} ${vpl} · ${t.label}: scroll horizontal en la página`);
        }
        console.log(`  ${file} ${vpl}: ${tabs.length} pestañas, ${n} controles` + (listed.length ? ` · CONOCIDOS (de antes, no fallan): ${[...new Set(listed.map((s) => s.replace(/ \d+×\d+$/, '')))].join(', ')}` : ''));
        assert.deepEqual(small, [], `${file} ${vpl}: controles de menos de 44 px en los sheets`);
        assert.deepEqual(errors, []);
      } finally { await ctx.close(); }
    }
    const stale = known.filter((_, i) => !usedK.has(i)).map(([t, n]) => `${t} ${n}`)
      .concat(knownH.filter((_, i) => !usedH.has(i)).map(([v, t]) => `${v} ${t} (scroll horizontal)`));
    assert.deepEqual(stale, [], `${file}: entradas de KNOWN que ya no aparecen en ningún viewport (sacarlas de la lista)`);
  });
}
