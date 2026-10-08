# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Íconos y favicons nuevos (2026-10-08)
Diseño nuevo de los íconos, entregado en `src/brand/zeroday-brand-assets/` (con su
`LEEME.txt`). Medido en Chromium; **ninguno se vio todavía en un dispositivo real**
(`docs/QA-dispositivos.md`, apartados 2, 4 y 5).

- **Íconos de los instrumentos.** Reemplazan al «0xD» recortado del logo que tenían
  todos sobre su color de acento: cada uno es ahora una ventana de terminal con el número del instrumento (808, '70, 2035, J4 y
  303) y su nombre abajo, sobre el color de acento. Los 20 PNG (192, 512, 512
  maskable y apple-touch 180) son los del diseño, con los mismos nombres, así que
  los manifests no cambian. Son 100 % opacos, con el fondo igual al acento de
  `data/instrumentos.json` y, en los maskable, todo el contenido a 197 px del
  centro (la zona segura mide 204,8 de 512). `tools/check-icons.mjs`
  (`npm run check-icons`) lo verifica, sale con código 1 si algo no cumple y
  reemplaza a `make-icons.mjs`, que ya no tenía fuente que recortar.
- **Favicon de cada instrumento.** El de 32×32 inline de cada HTML es ahora la
  ventana oscura del ícono (sin el nombre, que no se lee a 32 px) sobre el color de
  acento: PNG con paleta de unos 0,4 KB. `tools/make-favicons.mjs` lo reproduce
  desde `icons/<slug>-512.png` (imagen equivalente, no los mismos bytes). En
  Nebularp el favicon del diseño traía el fondo en `#9a8cfe` y el acento es
  `#9a8cff` (el test exige igualdad): se corrigió ese único byte de la paleta.
  `favicon.test.mjs` exige 32×32, ≤ 2 KB y píxel (0,0) = acento.
- **Favicon del sitio.** «0xD» verde sobre un cuadrado redondeado casi negro.
  `assets/favicon.png` (64×64) es el del diseño, se suman `assets/favicon-32.png` y
  `assets/favicon-180.png` (`apple-touch-icon` del sitio), y las páginas los declaran
  (`sizes` 32×32, 64×64 y 180×180, con rutas relativas que también sirven a la 404
  bajo su `<base>`). Optimizados a PNG con paleta y alfa: de 7–12 KB a 0,6–1,9 KB,
  sin cambiar su aspecto (`tools/make-site-icons.mjs`). `build-og-images.mjs` ya no
  escribe `assets/favicon.png`.
- **Pruebas.** `tools/tests/icons-install.test.mjs`: con el repo servido bajo
  `/instruments/`, los 5 son instalables (`Page.getInstallabilityErrors` = `[]`), los
  íconos del manifest y el apple-touch responden 200 `image/png` con el tamaño que
  declaran, y los íconos del sitio resuelven también desde la 404 en una ruta
  anidada. `serveRoot` suma la opción `prefix`.
- **PWA.** `sw.js` pasa a `zd-v7` y el ZIP se regenera: cambiaron los 20 PNG de
  `icons/` y el favicon inline de los 5 HTML, así que las copias cacheadas tienen
  que reemplazarse. Una app ya instalada puede tardar en actualizar el ícono (en
  Android a veces hay que reinstalarla).

### Ajustes tras las primeras pruebas (2026-10-05 a 2026-10-07)
Lo que salió de usar los instrumentos en el teléfono y de medir los reportes
`reports/F2b.md` a `F3-barrido-scroll.md`. Medido en Chromium (Playwright); en un
dispositivo real, lo único confirmado es que los 5 se instalan en un Android
(lo verificó a mano el usuario el 2026-10-05). Lo que falta oír o tocar está en
`docs/QA-dispositivos.md`.

- **PWA: un scope propio por instrumento.** Antes los 5 manifests compartían
  `scope: "../"` y, en Android, la app instalada de Acid capturaba los links a
  los otros 4 y no dejaba instalarlos. Ahora el `scope` de cada manifest es su
  propio archivo, con `id` distinto, y un test (`pwa-scopes`) falla si dos scopes
  se solapan. `sw.js` pasa a `zd-v5`; su scope sigue siendo `/instruments/`.
- **Sitio.** «▶ Probar ahora» (landing) y «▶ Probar» (cards del índice) abren la
  HTML del instrumento; sección nueva «Instalar en la computadora y en el
  teléfono» (tabla en el índice, resumen en cada landing y FAQ).
  `sitemap.xml` determinista: el `<lastmod>` de cada URL solo cambia cuando
  cambia esa página, no con la fecha del build.
- **J4-Sirens Station.** MUTE (mientras se mantiene) y BURNOUT (silencio total
  hasta otro toque; no se guarda), con las teclas 1, 4, 8, 9 y 0 para ECHO THROW,
  FEEDBACK ∞, KILL, MUTE y BURNOUT. En reposo queda en silencio exacto y el eco
  se apaga solo (techo de la ganancia del lazo según el TIME; FEEDBACK ∞ sigue
  autooscilando a propósito). El final del release ya no tiene un escalón de
  −112 dB. Corregido el manual, el roadmap, el README y la landing: el banco de
  fábrica tiene **6** presets, no 11.
- **Guarda contra NaN en el filtro** de J4 y de MonoMoon: el filtro se reinicia
  solo cuando su estado se dispara (en J4, si pasa de √12; en MonoMoon, si deja
  de ser finito). Antes el audio quedaba mudo hasta recargar.
- **MonoMoon.** Realimentación saturada en el filtro de escalera (cambio de timbre
  mínimo en resonancias altas). Con Mod → Filtro y el Osc3 a frecuencia de audio
  todavía puede sonar un zumbido saturado; para modular el corte, Osc3 en LO.
- **Acid.** El corte del filtro queda acotado a 0,45 × la frecuencia de muestreo:
  con el `AudioContext` a menos de 32 kHz (por ejemplo un auricular Bluetooth en
  modo llamada) el filtro daba NaN y Acid quedaba mudo. A 44,1 kHz o más suena
  igual que antes.
- **Sheets del teléfono.** `zd-mobile` v5: carril lateral de 32 px sin controles,
  con una barra fina que muestra la posición, para scrollear sin cambiar un
  parámetro (en los 5). CronBeat además: los sliders de los sheets ya no saltan al
  tocarlos ni frenan el scroll (el valor cambia con un arrastre horizontal;
  doble toque en el PAN de la mezcla lo vuelve al centro). Para Acid,
  Nebularp, MonoMoon y J4 el barrido (`reports/F3-barrido-scroll.md`) midió que
  un swipe vertical sobre un knob cambiaba el valor y que los sliders saltaban al
  tocarlos; se resolvió en la entrada de abajo.
- **Knobs y sliders de los sheets (Acid, Nebularp, MonoMoon y J4; sliders
  también en CronBeat).** Dentro de los sheets del teléfono, el swipe vertical
  que arranca encima de un knob o de un slider scrollea el sheet y no cambia el
  valor; el ajuste es un arrastre horizontal, relativo (desde donde estaba) y
  sin demora. Tocar la pista de un slider ya no salta el valor. En los knobs
  siguen igual el doble toque (valor por defecto), el long-press (valor
  numérico), el teclado y `role="slider"`. Fuera de los sheets (macros de
  MonoMoon, BPM de Nebularp) y en escritorio con la ventana ancha, el knob sigue
  con arrastre vertical; con el shell activo en una ventana angosta de escritorio,
  el knob del sheet también va de costado. Los sliders pasan a un bloque nuevo,
  `zd-sheet-input` v1 (el manejo de CronBeat, sin cambios de lógica); los knobs
  usan el mismo modelo en el código de cada instrumento. Los knobs del sheet miden
  44×44 (Acid y J4 medían 42, MonoMoon 40) y, en Acid, Swing y Densidad pasan de
  26 a 44 px de alto. `zd-mobile` v6: el ✕ de la cabecera de los sheets mide
  44×44 (antes 44×36). MonoMoon: los 18 botones de onda de OSC miden ≥44 de
  ancho a 360 px, y FILTRO y VOZ ya no tienen scroll horizontal con el teléfono
  acostado. Medido en Chromium con toques reales por CDP (tests `sheet-knobs`,
  `zd-sheet-input`, `sheets-layout`); **sin probar con un pulgar ni en iOS**
  (`docs/QA-dispositivos.md`). `sw.js` pasa a `zd-v6` y el ZIP se regenera con
  los 5 instrumentos de ahora.

### Versión mobile-first (2026-10-04)
Los 5 instrumentos pasan a funcionar **en vertical** (360×640 como mínimo)
y dejan de pedir girar el teléfono: sin `#zd-rotate`, sin `maximum-scale` ni
`user-scalable=no`. Horizontal y escritorio siguen funcionando.

- **Layout portrait-first.** Barra superior de 48 px, zona de tocar, 5 pestañas
  inferiores y *bottom sheets* (con modo *peek* donde se toca mientras se
  ajusta). Pestañas: CronBeat `PADS · SEQ · FX · SAMPLE · CANCIÓN`; MonoMoon
  `OSC · FILTRO · MOD · VOZ · PATCHES`; Nebularp `ESCALA · ARP · SONIDO ·
  ESPACIO · TECLADO` (con el panel Sesión); J4 `SIRENA · ENV·LFO · FX · PAD ·
  SESIÓN`; Acid `SEQ · SONIDO · FILTRO · PATRÓN · EXPORT`. Menú ⋯ con
  «← Sitio», «Instalar app» y «Empezar de cero».
- **REC → WAV en vivo** en MonoMoon, Nebularp y J4 (PCM 16-bit estéreo, tope
  de 10 min), con tarjeta de resultado (escuchar, descargar).
- **MIDI de performance** en MonoMoon, Nebularp y J4 (notas, pitch bend, CC1,
  CC74/CC71 según el instrumento).
- **JSON de estado completo** con envoltorio `{ app, version, savedAt, data }`
  y validación al importar, en los 5.
- **Autoguardado** (IndexedDB con respaldo en `localStorage`, debounce de 1,5 s)
  en los 5; restaura sin arrancar el audio. MonoMoon migra su biblioteca desde
  `hackwave-minimoog` y J4 sus slots desde `dubsiren.preset.*`, sin borrar lo viejo.
- **Descargas** por Web Share con archivo en iOS (`ZD.dl`), con nombre
  `<slug>-YYYYMMDD-HHmm.<ext>`.
- **Audio en iOS**: destrabe dentro del gesto, `audioSession` de reproducción,
  reanudar tras interrupciones («Tocá para reanudar»), Wake Lock mientras
  suena e indicador de CLIP (solo mide).
- **PWA real**: `manifests/*.webmanifest` estáticos, íconos, `sw.js` con
  precache versionado (`zd-v3` en ese momento; la versión vigente está en `sw.js`) y aviso de nueva versión; oferta de instalación
  descartable (`zd-pwa` v3).
- **Extras**: CronBeat con deshacer/rehacer, velocidad por altura del dedo,
  note repeat y choke de hats (opcional); Nebularp con autoplay generativo;
  J4 con visualizador de baja carga.
- **Bloques**: `zd-ui` v2, `zd-audio` v2, `zd-rec` v2 y `zd-pwa` v3 (ver
  `docs/zd-blocks.md`).
- **Sitio**: flags, manuales y roadmap de las 5 landings y el README
  actualizados contra el código; `docs/QA-dispositivos.md` con la lista
  consolidada de pruebas en dispositivo; los scripts de verificación pasan a
  `tools/tests/` (`docs/tests.md`).

Todo se verificó en Chromium (Playwright). Nada se probó todavía en un iPhone,
iPad o Android reales: ver `docs/QA-dispositivos.md`.

### Sitio (`index.html`, `landing-*.html`, `privacidad.html`, `404.html`)
- El sitio pasa de renderizarse en el cliente (React + `support.js` cargados
  desde unpkg) a HTML y CSS estático generado en build time: `data/instrumentos.json`
  + `templates/` + `tools/build-site.mjs`. Mismas URLs, mismo aspecto, visible
  sin JavaScript (verificado con `curl`).
- Estado honesto por instrumento: `exporta`/`guarda`/`app` salen de
  `data/instrumentos.json` y las landings solo muestran lo que el instrumento
  cumple hoy (con la versión mobile-first los 5 exportan WAV · MIDI · JSON,
  autoguardan y son instalables; ver la entrada de abajo).
- SEO: `title`/`description`/canonical/Open Graph/Twitter Card/favicon/
  `theme-color` por página, JSON-LD `SoftwareApplication` en cada landing,
  `sitemap.xml`, `robots.txt`, OG images 1200×630 por instrumento generadas
  con un script propio sin dependencias (`tools/build-og-images.mjs`).
- `404.html` usa `<base href="/instruments/">` y rutas absolutas; probado
  sirviendo el repo bajo `/instruments/` con una ruta anidada de varios
  niveles.
- Gate de mail consolidado en un solo módulo (`assets/mail-gate.js`)
  compartido por `index.html` y las 5 landings — antes vivía duplicado y
  desincronizado (un typo de endpoint de MX distinto en cada copia).
  Comportamiento sin cambios: modo demo, hook `window.ZD_SEND_CODE`, chequeo
  de MX contra `dns.google`, `localStorage` `zd-web-verified`.
- "Descargar los 5" entrega un único `descargables-zeroday.zip`; las
  descargas individuales usan `download="<Nombre>.html"` (sin ruta).
- `privacidad.html`: las secciones sobre qué se pide, para qué se usa y los
  derechos del usuario se reescribieron para describir lo que el código hace
  hoy (modo demo, nada se transmite a un servidor propio), marcadas con
  comentarios `TODO revisar con el titular` donde depende de una decisión de
  producto.
- Mobile-first: tipografía con mínimos de 14px (texto corrido) y 12px
  (labels), contraste AA revisado, header sticky de una sola fila con menú
  `<details>`, índice del manual colapsable en móvil, iframe de "Probalo acá"
  con carga diferida al click en pantallas ≥1024px.
- `assets/logo-badge.webp` reemplaza los PNG/JPG viejos del logo (642KB y
  227KB → ~34KB), sin el fondo "papel" horneado en los píxeles (ahora es un
  `background` de CSS).
- `LICENSE` (CC BY-NC 4.0, a confirmar con el titular) y este changelog.

### Instrumentos (`descargables/`)
- Bloques `ZD` compartidos (`zd-mobile`, `zd-audio`, `zd-store`, `zd-ui`,
  `zd-rec`, `zd-dl`, `zd-midi`, `zd-pwa`) documentados y verificados byte a
  byte entre los 5 archivos (`tools/check-blocks.mjs`).
- Manifests web estáticos y set de íconos PWA por instrumento, service
  worker único (`sw.js`, scope `/instruments/`).
- Stubs de redirect para las 5 URLs viejas de la raíz del repo hacia la
  landing correspondiente.
- Build/check reproducibles del ZIP de descargables
  (`tools/build-zip.mjs` / `tools/check-zip.mjs`).

## Antes de este changelog
El historial previo (`git log`) incluye: primer commit de los 5 instrumentos,
tracking de Google Analytics en las páginas del sitio, un par de reestructuraciones
de carpetas y ajustes sucesivos del README.
