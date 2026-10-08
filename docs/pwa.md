# PWA: integración `zd-pwa`

Qué hay en el repo y qué lleva cada instrumento en su propio HTML
(`descargables/<Instrumento>.html`) para cumplir SPEC R2 y 3.2.

**Estado:** el bloque `zd-pwa` (hoy v3) está pegado **idéntico** en los 5
instrumentos (SPEC 3.1.2; lo verifica `tools/check-blocks.mjs`), cada uno con su
`<link rel="manifest">` estático, y `sw.js` está en `zd-v6`. Lo que sigue
describe qué lleva cada HTML y por qué; lo que falta probar en un dispositivo
está al final (sección 5) y en [`docs/QA-dispositivos.md`](QA-dispositivos.md).

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

## Scope de cada manifest: su propio archivo

Cada manifest declara como `scope` **el HTML de su instrumento**, y no una
carpeta. Las URLs del manifest son relativas **al manifest** (`manifests/`):

```json
"id":        "../descargables/Acid_Bass-303.html",
"start_url": "../descargables/Acid_Bass-303.html",
"scope":     "../descargables/Acid_Bass-303.html"
```

**Por qué.** Antes los 5 compartían `"scope": "../"`, que es todo
`/instruments/`. En Android, la app instalada de Acid capturaba los links a
los otros 4 y no dejaba instalarlos (así quedó anotado en el commit `6d1f100`;
la causa exacta dentro de Chrome no se investigó). El
`scope` es lo que le dice al navegador qué URLs pertenecen a una app instalada;
si el de un instrumento contiene a los otros cuatro, los cinco quedan
mezclados. Con el scope de un solo archivo, cada instrumento se instala por
separado y se abre en su propia ventana (SPEC R2). Es lo que se hizo en el
commit `6d1f100`, junto con el paso del service worker a `zd-v4`.

**La regla: los scopes no se solapan.**

- Ningún `scope` puede ser prefijo del `scope` ni del `start_url` de otro
  instrumento. Un scope de carpeta (`../`, `../descargables/`) los solapa a
  todos.
- Tampoco se puede omitir: sin `scope`, el navegador usa la carpeta del
  `start_url`, que es la misma para los 5.
- Cada `id` es distinto (es lo que identifica a la app instalada).
- Un instrumento nuevo copia el patrón: `id`, `start_url` y `scope` apuntan a su
  propio HTML.

**Lo que no cambia.** El scope del **service worker** sigue siendo
`/instruments/` (`register('../sw.js', { scope: '../' })`): un único `sw.js`
para los 5, sin importar desde qué instrumento se registre primero. Es otra
cosa que el scope del manifest, y que el del SW contenga a los de los
manifests es correcto (el SW controla el `start_url` de cada uno).

**Cómo se verifica.** `node tools/tests/pwa-scopes.test.mjs` (Node puro): los
`id` son distintos, cada `scope` es su propio archivo, cada `start_url` cae en
su scope y fuera de los otros 4, ningún scope es prefijo de otro y el
`theme_color` coincide con el `<meta name="theme-color">` de su HTML. Falla si
alguien vuelve a poner `"scope": "../"`. Lo que falta probar en el teléfono
está en la sección 5.

## 1 · Qué agregar al `<head>`

Por instrumento (ejemplo con `cronbeat`; reemplazar `<slug>` y
`<ShortName>` según la tabla de arriba y el manifest correspondiente):

```html
<link rel="manifest" href="../manifests/cronbeat.webmanifest">
<link rel="apple-touch-icon" href="../icons/cronbeat-apple-touch-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CronBeat">
```

`<meta name="theme-color">` existe en los 5 instrumentos y coincide con el
`theme_color` de su manifest (hoy `#070b06` en los 5). Si se cambia uno hay
que cambiar el otro: lo comprueba `tools/tests/pwa-scopes.test.mjs`.

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

> **Actualización (v2; hoy los 5 llevan la v3).** El síntoma "no me ofrece instalar" no era un bug de
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
> completo están en [`docs/zd-blocks.md`](zd-blocks.md#zd-pwa-v3--service-worker-instalar-y-la-oferta-proactiva);
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

`sw.js` (raíz, cache `zd-cache-<VERSION>`, hoy `zd-v6`) precachea los 5
instrumentos + manifests + íconos y sirve HTML con *stale-while-revalidate*.
Al activar una versión nueva manda `postMessage({type:'zd-sw-updated',
version:'zd-v6'})` (la `VERSION` vigente) a las pestañas abiertas; `zd-pwa` lo escucha y solo muestra el toast si
`hadController` era `true` (evita mostrar "Nueva versión" en el primer
install, cuando técnicamente no había nada previo que actualizar).

Para forzar una nueva versión: subir `VERSION` en `sw.js` (hoy `zd-v6`; la
próxima, `zd-v7`). El `activate` del SW nuevo borra los `zd-cache-*` viejos.
Subió a `zd-v2` con el hotfix de `zd-mobile` v3 y `zd-midi` v2 (2026-10-03), a
`zd-v3` con la versión mobile-first (`zd-ui` v2, `zd-audio` v2, `zd-rec` v2,
`zd-pwa` v3 y los 5 instrumentos nuevos, 2026-10-04), a `zd-v4` con el scope
propio de cada manifest (2026-10-05), a `zd-v5` con los cambios de los
instrumentos de 2026-10-05 a 2026-10-07 (`zd-mobile` v5, J4, MonoMoon, Acid y
CronBeat; es la publicada) y a `zd-v6` con los knobs y sliders de los sheets
(`zd-mobile` v6, `zd-sheet-input` v1, los 5 instrumentos; 2026-10-07, falta
publicarla; ver `CHANGELOG.md`): es lo que hace que las copias cacheadas del
instrumento se reemplacen. Subirla una sola vez por
publicación, desde la que está publicada.

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

- [x] Los 5 instalados en el mismo teléfono (scope propio de cada manifest):
      se instalaron los 5. Lo verificó el usuario el 2026-10-05 en su Android,
      tras el cambio de scope; dispositivo y versión de Chrome sin anotar.
- [ ] Con los 5 instalados: cada uno abre en su propia ventana, un link de un
      instrumento a otro no se abre dentro de la ventana de la app (sale al
      navegador), y «Abrir en pantalla completa» (Probalo acá) y «▶ Probar»
      abren el instrumento correcto. Lo del 2026-10-05 no lo cubre.
- [ ] Una instalación hecha con el manifest viejo (`scope: "../"`, antes de
      `zd-v4`): ver si Chrome la pasa sola al scope nuevo o hay que
      desinstalarla y volver a instalar. No está probado.
- [ ] `beforeinstallprompt` real (no sintético): el banner aparece solo tras
      el gesto/engagement que pide Chrome, y el ícono + nombre corto en el
      diálogo nativo son los correctos.
- [ ] Aceptar la instalación real: toast "App instalada", banner no vuelve,
      ícono "↓" e ítem de menú se esconden (ya en standalone).
- [ ] "Ahora no" en un dispositivo real: confirmar que el banner no vuelve
      durante 14 días de uso normal (no solo con el reloj adelantado).
- [ ] Cerrar el diálogo nativo real sin instalar (`zd-pwa` v3): el banner se
      va en el acto y no vuelve durante 14 días, como con "Ahora no".

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
