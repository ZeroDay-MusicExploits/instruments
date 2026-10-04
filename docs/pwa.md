# PWA: integración `zd-pwa`

Qué hay en el repo y qué tiene que pegar cada instrumento en su propio
HTML (`descargables/<Instrumento>.html`) para cumplir SPEC R2 y 3.2.
Nada de esto se aplicó a los instrumentos: lo integra la sesión que está
trabajando esos archivos, pegando el bloque `zd-pwa` **idéntico** en los
5 (SPEC 3.1.2 — luego verificable con `tools/check-blocks.mjs`).

## Dónde vive cada cosa

| Qué | Dónde | Generado por |
|---|---|---|
| Manifest por instrumento | `manifests/<slug>.webmanifest` | estático, a mano |
| Íconos (192, 512, 512 maskable, apple-touch 180) | `icons/<slug>-*.png` | `tools/make-icons.mjs` |
| Service worker único | `sw.js` (raíz) | estático, a mano |

Slugs: `cronbeat`, `monomoon`, `nebularp`, `j4-sirens`, `acid-bass`.

Todas las rutas de `zd-pwa` son relativas **desde `descargables/`**, que
es donde vive cada instrumento (SPEC 3.2: ese HTML es a la vez lo que se
sirve y lo que se descarga).

## 1 · Qué agregar al `<head>`

Por instrumento (ejemplo con `cronbeat`; reemplazar `<slug>` y
`<ShortName>` según la tabla de arriba y el manifest correspondiente):

```html
<link rel="manifest" href="../manifests/cronbeat.webmanifest">
<link rel="apple-touch-icon" href="../icons/cronbeat-apple-touch-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CronBeat">
```

`<meta name="theme-color">` ya existe en los 5 instrumentos — no hace
falta tocarlo, solo confirmar que coincide con el `theme_color` del
manifest.

`short_name` / `apple-mobile-web-app-title` por instrumento (SPEC R7 —
nunca "Minimoog" ni "Ritmos"):

| Slug | apple-mobile-web-app-title |
|---|---|
| cronbeat | `CronBeat` |
| monomoon | `MonoMoon` |
| nebularp | `Nebularp` |
| j4-sirens | `J4-Sirens` |
| acid-bass | `Acid Bass` |

**CronBeat y MonoMoon** arman hoy su manifest a mano con
`URL.createObjectURL(new Blob(...))` / `data:application/json,...`. Eso
hay que sacarlo: con el `<link rel="manifest">` estático de arriba ya
sobra (SPEC R2, "Quitar el manifest armado con `blob:`").

## 2 · El bloque `zd-pwa`

> **Actualización (v2).** El síntoma "no me ofrece instalar" no era un bug de
> instalabilidad: probado por HTTP bajo `/instruments/`,
> `Page.getInstallabilityErrors` da `[]`, el manifest valida (nombre, íconos
> 192/512/512-maskable en 200, `start_url` dentro de `scope`, `display`), el
> SW queda activo y controlando, y la consola queda limpia — ver el reporte
> completo al pie de esta sección. Lo que faltaba era una **oferta
> proactiva**: v1 solo ofrecía instalar desde un ítem dentro del menú ☰ del
> shell móvil, y en escritorio ancho (donde el shell no se activa) no había
> ningún botón. v2 agrega un banner propio al abrir (independiente del menú y
> del shell), un botón "↓ Instalar" en escritorio, hint real de iOS, aviso de
> navegador embebido y aviso de `file://`. La API y el comportamiento
> completo están en [`docs/zd-blocks.md`](zd-blocks.md#zd-pwa-v2--service-worker-instalar-y-la-oferta-proactiva);
> el código tal como quedó pegado en los instrumentos vive en
> [`tools/blocks/zd-pwa.html`](../tools/blocks/zd-pwa.html). El borrador de
> abajo (de la v1) se mantiene porque documenta las condiciones de activación
> y el contrato con `sw.js`, que no cambiaron.
>
> **Reporte de instalabilidad (Chromium, servido en `/instruments/`):**
>
> ```text
> Page.getInstallabilityErrors → { "installabilityErrors": [] }
> manifest: 200 · name "ACID BASS-303" · short_name "Acid Bass" · display "standalone"
> start_url resuelto dentro de scope: true
> íconos 192/512/512-maskable: 200, 200, 200
> service worker: registrado, activo, controlando la pagina (controller: true)
> consola: sin mensajes
> ```
>
> `beforeinstallprompt` **no** se pudo disparar de forma nativa en una sola
> carga automatizada con un perfil limpio de Chromium (headless, un solo
> `goto` + un click) — es la heurística de engagement de Chrome (visitas /
> tiempo en el sitio), no algo que dependa de esta página: con
> `getInstallabilityErrors` en `[]` la página ya cumple los requisitos. Para
> el resto de las pruebas (Paso 3) se sintetiza el evento con
> `prompt()`/`userChoice` propios, como pide la consigna.


Va antes de `</body>`, **después** de `zd-ui` (usa `ZD.toast`, definido
ahí). Es el mismo bloque, byte a byte, en los 5 instrumentos — solo
cambia `SLUG` en la primera línea de configuración.

```html
<!-- ZD-BLOCK:zd-pwa v1 -->
<script>
/* ZD-BLOCK:zd-pwa v1 */
(function () {
  'use strict';
  var SLUG = 'cronbeat'; // <- único valor que cambia por instrumento
  var MANIFEST_URL = '../manifests/' + SLUG + '.webmanifest';
  var SW_URL = '../sw.js';

  function isSecureContext() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }
  function isTopWindow() {
    try { return window.top === window; } catch (e) { return false; }
  }

  // file:// o dentro de un iframe: no hacemos nada, sin errores de consola.
  if (!isSecureContext() || !isTopWindow()) return;
  if (!('serviceWorker' in navigator)) return;

  // Si ya había un SW controlando esta página, un próximo 'zd-sw-updated'
  // es una actualización real (no el primer install) y ahí sí mostramos el toast.
  var hadController = !!navigator.serviceWorker.controller;

  fetch(MANIFEST_URL, { method: 'HEAD' }).then(function (res) {
    if (!res.ok) return; // manifest caído: no registramos el SW
    return navigator.serviceWorker.register(SW_URL, { scope: '../' });
  }).then(function () {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'zd-sw-updated' && hadController) {
        showUpdateToast();
      }
    });
  }).catch(function () { /* sin red: silencioso, no rompe el instrumento */ });

  function showUpdateToast() {
    if (window.ZD && ZD.toast) {
      ZD.toast('Nueva versión · Recargar', {
        action: { label: 'Recargar', onClick: function () { location.reload(); } }
      });
    }
  }

  // Botón "Instalar" unificado. Busca #zd-install-btn en el shell; si no
  // existe en este instrumento todavía, no hace nada (no es un error).
  var deferredPrompt = null;
  var installBtn = document.getElementById('zd-install-btn');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  function updateInstallButton() {
    if (!installBtn) return;
    installBtn.hidden = isStandalone() || !isTopWindow();
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallButton();
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () {
          deferredPrompt = null;
          updateInstallButton();
        });
        return;
      }
      var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS && window.ZD && ZD.toast) {
        ZD.toast('Para instalar: Compartir → Agregar a inicio');
      }
    });
  }

  updateInstallButton();
  window.addEventListener('appinstalled', updateInstallButton);
})();
/* /ZD-BLOCK:zd-pwa */
</script>
<!-- /ZD-BLOCK:zd-pwa -->
```

## 3 · Condiciones de activación (SPEC 3.2)

El bloque entero es un no-op silencioso salvo que se cumplan las tres:

1. **`http:`/`https:`** — en `file://` `location.protocol` es `"file:"`,
   así que el bloque corta en la primera línea. No se puede registrar
   manifest ni service worker desde un HTML abierto con doble clic; por
   eso la copy del sitio/README dice "Instalá desde la web, o bajá el
   HTML para usarlo local".
2. **No en iframe** (`window.top === window`) — el sitio abre cada
   instrumento embebido (iframe + "pantalla completa"); el `zd-pwa` de
   ese iframe no debe registrar nada, solo la copia que corre top-level
   cuando se abre el HTML directo.
3. **El manifest responde** — `HEAD` a `../manifests/<slug>.webmanifest`
   antes de registrar el service worker. Si el manifest no está (404,
   sin red), no se registra nada.

En cualquier otro caso (no cumple 1 o 2, o el `HEAD` falla) el bloque
simplemente retorna: cero `console.error`, cero service worker
registrado.

## 4 · Service worker y "nueva versión"

`sw.js` (raíz, cache `zd-v2`) precachea los 5 instrumentos + manifests +
íconos y sirve HTML con *stale-while-revalidate*. Al activar una versión
nueva manda `postMessage({type:'zd-sw-updated', version:'zd-v2'})` a las
pestañas abiertas; `zd-pwa` lo escucha y solo muestra el toast si
`hadController` era `true` (evita mostrar "Nueva versión" en el primer
install, cuando técnicamente no había nada previo que actualizar).

Para forzar una nueva versión: subir `VERSION` en `sw.js` (`zd-v2` →
`zd-v3`). El `activate` del SW nuevo borra los `zd-cache-*` viejos.
Subió a `zd-v2` con el hotfix de `zd-mobile` v3 y `zd-midi` v2 (2026-10-03):
es lo que hace que las copias cacheadas del instrumento se reemplacen.

## 5 · A verificar en dispositivo

Todo lo de abajo se verificó con Chromium + Playwright (manifest, SW,
`getInstallabilityErrors`, el banner con `beforeinstallprompt` sintético, los
breakpoints, `file://`, iframe, UA de iOS y de Instagram — ver
`docs/SPEC.md` 3.5 y el reporte de la sección 2). Nada de esto se probó en un
dispositivo físico ni en Safari/Firefox real: queda pendiente.

### iOS Safari y standalone

- [ ] Banner con el hint de Compartir real (no el emulado): que el ícono de
      iOS y el texto "Agregar a inicio" coincidan con lo que Safari muestra.
- [ ] "Compartir → Agregar a inicio", ícono apple-touch correcto, abre en
      `standalone` sin barra de Safari.
- [ ] En standalone real (no `navigator.standalone` emulado): ni el banner
      ni el ícono "↓" ni el ítem del menú aparecen.
- [ ] CriOS y FxiOS (Chrome/Firefox en iOS) en iOS 16.4+: confirmar que el
      banner de iOS aparece igual (son WebKit por debajo) y que "Agregar a
      inicio" desde su Compartir funciona.
- [ ] Instagram/Facebook/TikTok en iOS: confirmar que el navegador embebido
      real dispara el aviso "Abrí este link en Safari o Chrome" (la detección
      es por user-agent; algunas apps cambian su UA entre versiones).

### Android Chrome

- [ ] `beforeinstallprompt` real (no sintético): el banner aparece solo tras
      el gesto/engagement que pide Chrome, y el ícono + nombre corto en el
      diálogo nativo son los correctos.
- [ ] Aceptar la instalación real: toast "App instalada", banner no vuelve,
      ícono "↓" e ítem de menú se esconden (ya en standalone).
- [ ] "Ahora no" en un dispositivo real: confirmar que el banner no vuelve
      durante 14 días de uso normal (no solo con el reloj adelantado).

### Edge/Chrome de escritorio

- [ ] Instalar desde el botón propio "↓ Instalar" del header (no el ícono de
      la barra de direcciones) y confirmar que dispara el mismo flujo nativo.
- [ ] Instalar desde el ícono de la barra de direcciones directamente: que el
      botón del header se esconda después (via el evento `appinstalled`).
- [ ] Safari/Firefox de escritorio: confirmar que no aparece ningún botón ni
      banner (no hay `beforeinstallprompt` en ninguno de los dos).

### Service worker y actualizaciones

- [ ] Abrir instalado, pasar a modo avión, recargar: debe abrir desde
      cache (sin pantalla de "sin conexión" del navegador). Ya verificado
      con `context.setOffline(true)` en Playwright; falta el modo avión real.
- [ ] Subir `VERSION` en `sw.js`, volver a abrir con conexión: aparece
      el toast "Nueva versión · Recargar" (y **no** aparece en un
      install limpio).
- [ ] Abrir el instrumento en `file://` desde el Finder/Explorador (doble
      clic real, no `file://` tipeado en la barra): mismo aviso discreto,
      sin errores en consola, sin intento de registrar SW.
- [ ] Abrir el instrumento embebido en un iframe (como lo sirve el
      sitio): sin intento de registrar SW en esa instancia, sin banner.
