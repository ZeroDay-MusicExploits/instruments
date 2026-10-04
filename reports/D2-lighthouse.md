# D2 · Lighthouse móvil

2026-10-04 · `main` después de `sw` zd-v3 y `theme-color` #070b06 · Lighthouse 13.5.0
sobre Chromium 153 (headless), emulación móvil por defecto (Moto G Power,
3G rápido simulado, CPU ×4). Una corrida por página, sin promediar: la
varianza entre corridas es de unos pocos puntos en Performance.

Las 12 páginas se sirvieron bajo el prefijo `/instruments/`, como GitHub Pages
(con `404.html` para rutas inexistentes). Se reproduce con
`node tools/lighthouse.mjs` (todas) o `node tools/lighthouse.mjs --only monomoon`.

| Página | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `index.html` | 99 | 100 | 96 | 100 | 0,9 s | 1,5 s | 140 ms | 0 |
| `landing-cronbeat.html` | 99 | 100 | 100 | 100 | 0,9 s | 1,5 s | 130 ms | 0 |
| `landing-monomoon.html` | 99 | 100 | 100 | 100 | 0,9 s | 1,5 s | 140 ms | 0 |
| `landing-nebularp.html` | 100 | 100 | 100 | 100 | 0,9 s | 1,5 s | 60 ms | 0 |
| `landing-sirens.html` | 99 | 100 | 100 | 100 | 0,9 s | 1,5 s | 110 ms | 0 |
| `landing-acid.html` | 99 | 100 | 100 | 100 | 0,9 s | 1,5 s | 110 ms | 0 |
| `privacidad.html` | 100 | 100 | 100 | 100 | 0,9 s | 1,2 s | 90 ms | 0 |
| `descargables/CronBeat-808.html` | 90 | 100 | 96 | 100 | 2,1 s | 2,7 s | 160 ms | 0,093 |
| `descargables/MonoMoon70.html` | 95 | **94** | **77** | 100 | 2,3 s | 2,3 s | 100 ms | 0,051 |
| `descargables/Nebularp_2035.html` | 91 | 100 | 96 | 100 | 2,0 s | 2,5 s | 170 ms | 0,084 |
| `descargables/J4-Sirens_Station.html` | 94 | 100 | 96 | 100 | 2,2 s | 2,3 s | 110 ms | 0,064 |
| `descargables/Acid_Bass-303.html` | 92 | 100 | 96 | 100 | 1,8 s | 2,4 s | 180 ms | 0,092 |

**Criterios de la SPEC.** Sitio (3.5): ≥95 en las 4 categorías. Instrumentos
(3.5, hosted): Accesibilidad ≥90 y Best Practices ≥90.

## Qué queda bajo el umbral

### Instrumentos · Best Practices

- **MonoMoon'70 · BP 77 (< 90).** Dos auditorías en 0:
  1. `deprecations` — "Web MIDI will ask a permission to use even if the sysex is
     not specified": `initMIDI()` llama a `navigator.requestMIDIAccess()` al
     cargar la página, sin un gesto (`MonoMoon70.html:3894`). En Chrome eso
     dispara el pedido de permiso de MIDI apenas se abre el instrumento. Es
     también una cuestión de producto (pedir el permiso al tocar un botón
     «Conectar MIDI» sería menos invasivo).
  2. `errors-in-console` — `GET /favicon.ico` 404 (ver abajo).
- **Los otros 4 · BP 96 (≥ 90).** Una sola auditoría en 0: `errors-in-console`
  por `GET /favicon.ico` → 404. **Ningún descargable declara `<link rel="icon">`**,
  así que el navegador pide `/favicon.ico` a la raíz del host. En GitHub Pages
  (`zeroday-musicexploits.github.io/instruments/`) esa ruta cae fuera del sitio
  del proyecto y también da 404. Arreglo de una línea por instrumento
  (`<link rel="icon" href="../icons/<slug>-192.png">`); no se aplicó porque
  `descargables/*.html` no se toca en esta sesión.

### Instrumentos · Accesibilidad

- **MonoMoon'70 · A11y 94 (≥ 90, pero no 100).** `aria-allowed-attr`: el pad XY
  (`div#xypad`, `role="group"`) lleva `aria-valuetext`, que no está permitido en
  ese rol (`MonoMoon70.html`, `xypad`). Opciones: `role="slider"` (con valores
  min/max/now) o sacar `aria-valuetext` y poner el estado en el `aria-label`.

### Instrumentos · Performance (no es criterio de la SPEC)

CronBeat 90, Nebularp 91, Acid 92, J4 94, MonoMoon 95. Salen de lo mismo en los
5: FCP/LCP de 1,8–2,7 s en móvil lento simulado (HTML de 243–310 KB con ~90 KB de
bloques `ZD` y un logo en base64) y un CLS de 0,05–0,09 por el armado del shell
`zd-mobile` en `DOMContentLoaded`. El peso del logo duplicado en J4 y MonoMoon
está en `reports/D1-barrido.md`, e.

### Sitio

- **`index.html` · BP 96.** `image-size-responsive`: `assets/logo-badge.webp`
  (404×314 de origen) se muestra a 364×… en un viewport angosto, y Lighthouse
  pide una imagen con al menos el tamaño mostrado × DPR. Ya cumple el umbral
  (≥ 90); para llegar a 100 haría falta una versión más grande del logo.
- Las 6 páginas restantes: 99–100 en todo.

## Lo que Lighthouse 13 no mide

Lighthouse ya no tiene la categoría PWA. "Instalable" se comprobó aparte con
`Page.getInstallabilityErrors` (devuelve `[]`) en `tools/tests/*-verify.test.mjs`
sobre Chromium. No hay medición en Safari ni en un dispositivo real
(`docs/QA-dispositivos.md`).
