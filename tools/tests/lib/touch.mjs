// Gestos táctiles de verdad para los tests de navegador. Van por CDP
// (`Input.dispatchTouchEvent`), así que pasan por el detector de gestos de
// Chromium igual que un dedo: respetan `touch-action`, hacen scroll nativo (con
// inercia) y mandan `pointercancel` cuando el navegador se queda con el gesto.
// `page.touchscreen.tap()` de Playwright solo hace start/end y no sirve para
// medir si un swipe scrollea. El contexto tiene que tener `hasTouch: true`.
// Sin dependencias.

const sessions = new WeakMap();
async function cdp(page) {
  let s = sessions.get(page);
  if (!s) { s = await page.context().newCDPSession(page); sessions.set(page, s); }
  return s;
}
const send = async (page, type, pts) => (await cdp(page)).send('Input.dispatchTouchEvent', {
  type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 })),
});

/** `steps` puntos equiespaciados de `from` a `to` (sin incluir `from`). */
export function line(from, to, steps = 12) {
  const out = [];
  for (let i = 1; i <= steps; i++) out.push({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
  return out;
}

/** Un dedo: touchStart en `points[0]`, touchMove en el resto, touchEnd.
 *  `stepMs` entre movimientos (velocidad del dedo), `holdMs` antes de soltar. */
export async function touchPath(page, points, { stepMs = 16, holdMs = 0 } = {}) {
  const [p0, ...rest] = points;
  await send(page, 'touchStart', [p0]);
  for (const p of rest) {
    await page.waitForTimeout(stepMs);
    await send(page, 'touchMove', [p]);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await send(page, 'touchEnd', []);
}

/** Swipe en línea recta de `from` a `to`. */
export const swipe = (page, from, to, { steps = 12, ...opts } = {}) => touchPath(page, [from, ...line(from, to, steps)], opts);

/** Arrastre lento (sin inercia): muchos pasos y un instante quieto antes de soltar. */
export const drag = (page, from, to, { steps = 16, stepMs = 20, holdMs = 60 } = {}) => touchPath(page, [from, ...line(from, to, steps)], { stepMs, holdMs });

/** Toque corto en un punto. */
export const tap = (page, p, { holdMs = 50 } = {}) => touchPath(page, [p], { holdMs });

/** Doble toque en un punto. */
export async function doubleTap(page, p, { gapMs = 110 } = {}) {
  await tap(page, p);
  await page.waitForTimeout(gapMs);
  await tap(page, p);
}

/** Espera a que el scrollTop de `sel` quede quieto `quietMs` (fin de la inercia). -> scrollTop */
export async function settleScroll(page, sel, { quietMs = 180, timeout = 4000 } = {}) {
  return page.evaluate(({ sel, quietMs, timeout }) => new Promise((resolve) => {
    const el = document.querySelector(sel);
    if (!el) { resolve(null); return; }
    let last = el.scrollTop, since = performance.now();
    const t0 = since;
    (function tick() {
      const now = performance.now();
      if (el.scrollTop !== last) { last = el.scrollTop; since = now; }
      if (now - since >= quietMs || now - t0 >= timeout) resolve(el.scrollTop);
      else requestAnimationFrame(tick);
    })();
  }), { sel, quietMs, timeout });
}
