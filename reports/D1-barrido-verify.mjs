#!/usr/bin/env node
// reports/D1-barrido-verify.mjs
//
// Mediciones del barrido D1 (reports/D1-barrido.md), puntos b y c. No es un
// test de aceptación: no falla por lo que encuentra, imprime lo que mide para
// que el reporte no dependa solo de leer código.
//
//   b · atajos de teclado globales: qué pasa con Espacio / flechas / letras
//       cuando el foco está en un knob, un botón o el input de un modal.
//   c · primer toque táctil sin destrabe previo. Chromium headless arranca
//       todo AudioContext en 'running' (con o sin --autoplay-policy), así que
//       la regla se EMULA: el AudioContext de la página nace suspendido y su
//       resume() solo se cumple con activación transitoria (≤1 s desde el último
//       pointerup táctil, touchend, click, keydown o mousedown; un pointerdown
//       táctil NO cuenta), como dice el estándar HTML y hace WebKit. Un resume()
//       sin activación queda pendiente hasta el próximo permitido. Se registra
//       el estado del contexto en cada start() de una fuente, en pointerdown y
//       en pointerup. Es una emulación: iOS hay que verificarlo en un iPhone.
//
//   node reports/D1-barrido-verify.mjs
//
// Necesita Playwright + Chromium (no es dependencia del runtime).
import { serveRoot, loadPlaywright } from '../tools/tests/lib/serve.mjs';
import { ROOT } from '../tools/tests/lib/load-block.mjs';

const srv = await serveRoot(ROOT);
const { chromium } = await loadPlaywright();
const out = (s) => console.log(s);

/* ---------- b · teclado ---------- */
{
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async (file) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    await page.goto(`${srv.origin}/descargables/${file}`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    return { ctx, page };
  };
  out('b · atajos de teclado globales (1280×860)');

  // Acid: Espacio con el foco en un knob (role=slider con onEnter = entrada numérica)
  {
    const { ctx, page } = await open('Acid_Bass-303.html');
    await page.evaluate(() => { const k = document.querySelector('.knob[role=slider]'); k.focus(); });
    const before = await page.evaluate(() => Seq.playing);
    await page.keyboard.press('Space'); await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ playing: Seq.playing, modal: !!document.querySelector('.zd-dlg'), label: document.activeElement && document.activeElement.getAttribute('aria-label') }));
    out(`  Acid · Espacio en el knob "${r.label || '?'}": play ${before} → ${r.playing} · modal de valor abierto: ${r.modal}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    if (r.playing) await page.evaluate(() => togglePlay());
    // Acid: letras del teclado de PC mientras se escribe en un prompt
    const oct0 = await page.evaluate(() => document.getElementById('kbOctVal').textContent);
    await page.evaluate(() => { window.__trig = 0; const t = Engine.triggerAmp.bind(Engine); Engine.triggerAmp = (...a) => { window.__trig++; return t(...a); }; });
    const p = page.evaluate(() => ZD.modal.prompt('El banco guarda por nombre', { value: '' }));
    await page.waitForFunction(() => document.activeElement && document.activeElement.matches('.zd-dlg input'));
    await page.keyboard.type('kassdf zz'); await page.waitForTimeout(300);
    const typed = await page.evaluate(() => document.activeElement.value);
    await page.keyboard.press('Enter'); await p;
    const r2 = await page.evaluate(() => ({ trig: window.__trig, oct: document.getElementById('kbOctVal').textContent }));
    out(`  Acid · tipear "kassdf zz" en ZD.modal.prompt: el input recibe "${typed}" · notas disparadas por el teclado de PC: ${r2.trig} · octava ${oct0} → ${r2.oct} (cada z la baja)`);
    await ctx.close();
  }
  // CronBeat: Espacio y flechas con el foco en un botón cualquiera (fuera de un modal)
  {
    const { ctx, page } = await open('CronBeat-808.html');
    const b = await page.evaluate(() => { const el = document.querySelector('#patbtns .patbtn') || document.querySelector('button'); el.focus(); return el.id || el.className || el.tagName; });
    const t0 = await page.evaluate(() => ({ playing: isPlaying, tempo }));
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space'); await page.waitForTimeout(300);
    const t1 = await page.evaluate(() => ({ playing: isPlaying, tempo, active: document.activeElement && (document.activeElement.className || document.activeElement.tagName) }));
    out(`  CronBeat · foco en un botón (${b}) · → y Espacio: tempo ${t0.tempo} → ${t1.tempo}, play ${t0.playing} → ${t1.playing}`);
    if (t1.playing) await page.keyboard.press('Space');
    await ctx.close();
  }
  // Los otros tres, para comparar: Espacio con el foco puesto por teclado en un botón
  for (const [file, sel] of [['MonoMoon70.html', '#btnRec'], ['Nebularp_2035.html', '#play'], ['J4-Sirens_Station.html', '#recBtn']]) {
    const { ctx, page } = await open(file);
    await page.keyboard.press('Tab');                                        // navegación por teclado
    await page.evaluate((s) => document.querySelector(s).focus(), sel);
    await page.evaluate(() => { window.__clicks = 0; document.addEventListener('click', () => window.__clicks++, true); });
    await page.keyboard.press('Space'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.__clicks);
    out(`  ${file} · Espacio con foco de teclado en un botón: el botón recibe el click ${r ? 'sí' : 'no'} (${r})`);
    await ctx.close();
  }
  await browser.close();
}

/* ---------- c · primer toque táctil ---------- */
{
  const browser = await chromium.launch();
  const HOOK = () => {
    window.__log = []; window.__acs = [];
    const T = () => Math.round(performance.now());
    const log = (t) => window.__log.push(`${T()} ${t}`);
    /* activación transitoria (HTML): táctil = pointerup/touchend; mouse = mousedown */
    let act = -1e9;
    const grant = () => { act = performance.now(); };
    for (const ev of ['touchend', 'click', 'keydown', 'mousedown']) window.addEventListener(ev, grant, true);
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') grant(); }, true);
    const active = () => performance.now() - act < 1000;
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(...a) {
        super(...a); window.__acs.push(this); this.__pend = [];
        if (!active()) { this.__blocked = true; AC.prototype.suspend.call(this); }
      }
      get state() { return this.__blocked ? 'suspended' : super.state; }
      resume() {
        if (!this.__blocked) return AC.prototype.resume.call(this);
        if (!active()) { log('resume() sin activación → pendiente'); return new Promise((ok) => this.__pend.push(ok)); }
        log('resume() con activación → permitido');
        this.__blocked = false;
        return AC.prototype.resume.call(this).then((x) => { log(`contexto running, t=${this.currentTime.toFixed(3)}`); this.__pend.splice(0).forEach((f) => f()); return x; });
      }
    };
    window.webkitAudioContext = window.AudioContext;
    const st = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (when) {
      const c = this.context; log(`start(${(when || 0).toFixed(3)}) ctx=${c.state} t=${c.currentTime.toFixed(3)}`);
      return st.apply(this, arguments);
    };
    for (const ev of ['pointerdown', 'pointerup']) {
      window.addEventListener(ev, () => { const c = window.__acs[window.__acs.length - 1]; log(`${ev} ctx=${c ? c.state : 'null'}`); }, true);
    }
  };
  out('\nc · primer toque táctil sin destrabe previo (390×844, regla de activación emulada: ver arriba)');
  for (const [file, sel, label] of [
    ['CronBeat-808.html', '.bigpad[data-track="0"]', 'pad 1 (Bombo)'],
    ['Nebularp_2035.html', '.piano', 'piano'],
    ['Acid_Bass-303.html', '#keyboard .key', 'tecla del teclado'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(HOOK);
    const page = await ctx.newPage();
    await page.goto(`${srv.origin}/descargables/${file}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    if (file.startsWith('Acid')) await page.evaluate(() => { window.__amp = []; const T = () => Math.round(performance.now());
      const on = Engine.triggerAmp.bind(Engine), off = Engine.releaseAmp.bind(Engine);
      Engine.triggerAmp = (...a) => { window.__log.push(`${T()} Engine.triggerAmp`); return on(...a); };
      Engine.releaseAmp = (...a) => { window.__log.push(`${T()} Engine.releaseAmp`); return off(...a); }; });
    if (file.startsWith('Acid')) await page.evaluate(() => ZD.mobile && ZD.mobile.open('seq'));
    await page.waitForTimeout(300);
    const visible = await page.isVisible(sel);
    if (!visible) { out(`  ${file}: ${sel} no está visible en el shell, salteado`); await ctx.close(); continue; }
    await page.tap(sel);
    await page.waitForTimeout(700);
    const log = await page.evaluate(() => window.__log.slice(0, 18));
    const extra = file.startsWith('Acid') ? await page.evaluate(() => ({ activeSemi, down: !!document.querySelector('#keyboard .key.down') })) : null;
    out(`  ${file} · tap en ${label}:`);
    for (const l of log) out(`      ${l}`);
    if (extra) out(`      después del toque: activeSemi=${extra.activeSemi} · tecla marcada .down=${extra.down}`);
    await ctx.close();
  }
  await browser.close();
}
await srv.close();
