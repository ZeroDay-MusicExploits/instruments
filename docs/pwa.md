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

> **Actualización (v1 final).** El bloque que quedó en los instrumentos ya no
> lleva `var SLUG` adentro: una línea distinta por archivo rompe la
> verificación byte a byte de SPEC 3.1.2. El slug sale del
> `<link rel="manifest">` del `<head>` (el de la sección 1), así que el bloque
> es idéntico en los 5 sin configuración. La API final y el código tal como
> quedó están en [`docs/zd-blocks.md`](zd-blocks.md). El borrador de abajo se
> mantiene porque documenta las condiciones de activación y el contrato con
> `sw.js`, que no cambiaron.


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

`sw.js` (raíz, cache `zd-v1`) precachea los 5 instrumentos + manifests +
íconos y sirve HTML con *stale-while-revalidate*. Al activar una versión
nueva manda `postMessage({type:'zd-sw-updated', version:'zd-v1'})` a las
pestañas abiertas; `zd-pwa` lo escucha y solo muestra el toast si
`hadController` era `true` (evita mostrar "Nueva versión" en el primer
install, cuando técnicamente no había nada previo que actualizar).

Para forzar una nueva versión: subir `VERSION` en `sw.js` (`zd-v1` →
`zd-v2`). El `activate` del SW nuevo borra los `zd-cache-*` viejos.

## 5 · A verificar en dispositivo

- [ ] Instalar desde Chrome/Edge Android (`beforeinstallprompt`) y
      confirmar que el ícono y el nombre corto son los correctos.
- [ ] iOS Safari: "Compartir → Agregar a inicio", ícono apple-touch
      correcto, abre en `standalone` sin barra de Safari.
- [ ] Desktop (Chrome/Edge): instalar desde el ícono de la barra de
      direcciones.
- [ ] Abrir instalado, pasar a modo avión, recargar: debe abrir desde
      cache (sin pantalla de "sin conexión" del navegador).
- [ ] Subir `VERSION` en `sw.js`, volver a abrir con conexión: aparece
      el toast "Nueva versión · Recargar" (y **no** aparece en un
      install limpio).
- [ ] Abrir el instrumento en `file://`: sin errores en consola, sin
      intento de registrar SW.
- [ ] Abrir el instrumento embebido en un iframe (como lo sirve el
      sitio): sin intento de registrar SW en esa instancia.
