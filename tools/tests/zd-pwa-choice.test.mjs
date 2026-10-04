#!/usr/bin/env node
// tools/tests/zd-pwa-choice.test.mjs
//
// Pedido de CronBeat y MonoMoon (reports/cronbeat-block-request.md punto 3,
// reports/monomoon-block-request.md punto 2): en zd-pwa v2, si el usuario
// rechaza el diálogo nativo (`userChoice.outcome === 'dismissed'`), el banner
// queda montado con un "↓ Instalar" que ya no instala (el evento se usó) y que
// al tocarlo muestra "Usá el menú del navegador…".
//
// Contrato de v3:
//   - 'dismissed' = "Ahora no": se desmonta el banner y se guarda
//     zd:pwa:dismissed (14 días). Si el navegador vuelve a mandar
//     beforeinstallprompt, el ↓ de la barra / el botón de escritorio vuelven
//     (no dependen del descarte) pero el banner no.
//   - 'accepted' o `appinstalled`: se desmonta todo lo de instalar, con un
//     solo toast "App instalada" aunque lleguen los dos.
//
// (Sin shell no existe el menú, así que tampoco su ítem #zd-install-btn.)
//
// Sobre la copia canónica de tools/blocks/ (zd-ui + zd-mobile + zd-pwa) en una
// página mínima con un ZD_M de prueba, en 360×640 (shell) y 1440×900
// (escritorio, sin shell: ahí no hay banner sino el botón fijo "↓ Instalar").
// La página no declara manifest: zd-pwa no registra el service worker.
//
//   node tools/tests/zd-pwa-choice.test.mjs
//
// Necesita Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveRoot, loadPlaywright } from './lib/serve.mjs';
import { ROOT } from './lib/load-block.mjs';
import { blockPage, blockVersion } from './lib/block-page.mjs';

const V = blockVersion('zd-pwa');
const PAGE = '/__zd-pwa-test.html';
const ZDM = `{
  name: 'ZD TEST', titleParts: ['ZD ', 'TEST'],
  transport: ['#playBtn'], keep: ['#pad'],
  tabs: [{ id: 'opt', label: 'OPC', title: 'OPCIONES', nodes: ['#opts'] }],
  menu: [{ label: '↓ Instalar app', id: 'zd-install-btn', hidden: true }]
}`;
const BODY = `<div class="wrap"><button id="playBtn" type="button">PLAY</button>
<div id="pad" style="height:320px;background:#222;color:#ddd">pad</div><div id="opts">opciones</div></div>`;

const VIEWPORTS = [
  { width: 360, height: 640, mobile: true, label: '360×640 (shell)', install: '.zd-pwa-banner .zd-pwa-go' },
  { width: 1440, height: 900, mobile: false, label: '1440×900 (escritorio)', install: '#zd-pwa-desktop-btn' },
];

let srv, browser;
test.before(async () => {
  srv = await serveRoot(ROOT, {
    [PAGE]: { body: blockPage({ blocks: ['zd-ui', 'zd-mobile', 'zd-pwa'], zdm: ZDM, body: BODY, title: 'ZD Test',
      head: '<meta name="apple-mobile-web-app-title" content="ZD Test">' }) },
  });
  const { chromium } = await loadPlaywright();
  browser = await chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function open(v) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: v.mobile, isMobile: v.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.origin + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}
/* beforeinstallprompt sintético; userChoice resuelve con `outcome` */
const fire = (page, outcome) => page.evaluate((outcome) => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  window.__prompts = window.__prompts || 0;
  e.prompt = () => { window.__prompts++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome, platform: 'web' });
  window.dispatchEvent(e);
}, outcome).then(() => page.waitForTimeout(150));
const snap = (page) => page.evaluate(() => {
  const ts = Number(localStorage.getItem('zd:pwa:dismissed'));
  const m = document.getElementById('zd-install-btn');
  return {
    shell: !!(window.ZD && ZD.mobile && ZD.mobile.active),
    prompts: window.__prompts || 0,
    banner: !!document.querySelector('.zd-pwa-banner'),
    topIcon: !!document.getElementById('zd-pwa-topbtn'),
    desktopBtn: !!document.getElementById('zd-pwa-desktop-btn'),
    menuItem: !!m && !m.hidden,
    dismissed: ts ? (Math.abs(Date.now() - ts) < 60000 ? 'ahora' : 'otra fecha') : null,
    installedToasts: Array.from(document.querySelectorAll('.zd-toast .zd-tmsg')).filter((t) => t.textContent === 'App instalada').length,
    otherToasts: Array.from(document.querySelectorAll('.zd-toast .zd-tmsg')).map((t) => t.textContent).filter((t) => t !== 'App instalada'),
  };
});
const fmt = (o) => Object.entries(o).filter(([k]) => k !== 'shell').map(([k, x]) => `${k}=${Array.isArray(x) ? JSON.stringify(x) : x}`).join(' ');

for (const v of VIEWPORTS) {
  test(`zd-pwa v${V} · ${v.label} · rechazar el diálogo nativo cuenta como "Ahora no"`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      await fire(page, 'dismissed');
      const before = await snap(page);
      assert.equal(before.shell, v.mobile);
      assert.deepEqual({ banner: before.banner, desktopBtn: before.desktopBtn, menuItem: before.menuItem },
        { banner: v.mobile, desktopBtn: !v.mobile, menuItem: v.mobile }, 'con el evento: banner e ítem del menú en el shell, botón fijo en escritorio');
      await page.click(v.install);
      await page.waitForTimeout(300);
      const after = await snap(page);
      console.log(`  ${v.label} · rechazado → ${fmt(after)}`);
      assert.deepEqual(
        { prompts: after.prompts, banner: after.banner, topIcon: after.topIcon, desktopBtn: after.desktopBtn, menuItem: after.menuItem, dismissed: after.dismissed, otherToasts: after.otherToasts },
        { prompts: 1, banner: false, topIcon: false, desktopBtn: false, menuItem: false, dismissed: 'ahora', otherToasts: [] },
        'rechazado: sin banner ni botones que ya no instalan, y zd:pwa:dismissed guardado');
      // el navegador vuelve a ofrecer: el ↓ / botón vuelve, el banner no (14 días)
      await fire(page, 'dismissed');
      const again = await snap(page);
      assert.deepEqual({ banner: again.banner, offer: v.mobile ? again.topIcon : again.desktopBtn, menuItem: again.menuItem },
        { banner: false, offer: true, menuItem: v.mobile }, 'un evento nuevo: vuelve el ↓ (o el botón), no el banner');
      await page.reload(); await page.waitForTimeout(150);
      await fire(page, 'dismissed');
      assert.equal((await snap(page)).banner, false, 'tras recargar, el banner sigue descartado');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`zd-pwa v${V} · ${v.label} · aceptar y appinstalled desmontan todo, con un solo "App instalada"`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      await fire(page, 'accepted');
      await page.click(v.install);
      await page.waitForTimeout(300);
      const acc = await snap(page);
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));   // Chrome manda los dos
      await page.waitForTimeout(200);
      const both = await snap(page);
      console.log(`  ${v.label} · aceptado → ${fmt(acc)} · + appinstalled → toasts ${both.installedToasts}`);
      assert.deepEqual(
        { prompts: acc.prompts, banner: acc.banner, topIcon: acc.topIcon, desktopBtn: acc.desktopBtn, menuItem: acc.menuItem, dismissed: acc.dismissed },
        { prompts: 1, banner: false, topIcon: false, desktopBtn: false, menuItem: false, dismissed: null }, 'aceptado: sin nada de instalar y sin marcar "Ahora no"');
      assert.equal(both.installedToasts, 1, 'userChoice accepted + appinstalled: un solo toast "App instalada"');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });

  test(`zd-pwa v${V} · ${v.label} · appinstalled sin pasar por el prompt desmonta el banner y el ↓`, async () => {
    const { ctx, page, errors } = await open(v);
    try {
      await fire(page, 'dismissed');
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));   // instalada desde el menú del navegador
      await page.waitForTimeout(200);
      const s = await snap(page);
      console.log(`  ${v.label} · appinstalled → ${fmt(s)}`);
      assert.deepEqual(
        { prompts: s.prompts, banner: s.banner, topIcon: s.topIcon, desktopBtn: s.desktopBtn, menuItem: s.menuItem, dismissed: s.dismissed, installedToasts: s.installedToasts },
        { prompts: 0, banner: false, topIcon: false, desktopBtn: false, menuItem: false, dismissed: null, installedToasts: 1 });
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}
