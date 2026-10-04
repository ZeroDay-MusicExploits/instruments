# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

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
  precache versionado (`zd-v3`) y aviso de nueva versión; oferta de instalación
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
