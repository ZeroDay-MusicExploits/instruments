# docs/SPEC.md — contrato común

Zero Day · Music Exploits. Se conserva la numeración 3.x porque los prompts citan las secciones (por ejemplo "SPEC 3.1.4" o "Anexo 3.4").

### 3.1 Reglas duras

1. Sin backend, sin frameworks en runtime, sin build obligatorio para **usar** los instrumentos. Cada instrumento sigue siendo **un HTML autocontenido**.
2. **No** extraer skin/shell a un módulo compartido. Lo compartido se maneja como **bloques copiados idénticos** (3.3), delimitados con `/* ZD-BLOCK:<nombre> v<n> */ … /* /ZD-BLOCK:<nombre> */` y verificados con `tools/check-blocks.mjs`.
3. **No romper C2**: no tocar los bloques "adaptador C2", `window.HOST` ni el canal `zeroday_sync`. `window.ZD_M` se mantiene como nombre del objeto de configuración del shell y **no se renombra**. Las claves de la config del shell v1 (`title`, `slots`, `place`, `menus`) ya no las lee nadie (`zd-mobile` v4 y v5 leen solo `name`, `titleParts`, `logo`, `logoAlt`, `transport`, `keep`, `tabs`, `menuTitle`, `menu`, `menuNotes`, `onEnter`, `onExit`) y se pueden borrar; de ahora en más **solo se agregan claves nuevas** y no se quita ninguna que lea un bloque `ZD` o el hub C2. Si una tarea afecta el adaptador C2, parar y avisar.
   - *Pendiente (anotado por D, sin resolver):* J4-Sirens Station todavía conserva las claves v1 (`J4-Sirens_Station.html`, literal de `window.ZD_M` + `Object.assign` con las v2); Acid, CronBeat, MonoMoon y Nebularp ya las sacaron. No hay `reports/E1.md` ni commits de E1 que las limpien, y `descargables/` no se toca desde la sesión D. Antes de borrarlas en J4, confirmar con quien mantiene el hub C2 (fuera de este repo) que no lee `iframe.contentWindow.ZD_M`. Ver `reports/D1-barrido.md`, f.
4. No reescribir motores de audio ni cambiar el sonido.
5. Nombres de archivo y **URLs actuales no cambian**: `index.html`, `landing-*.html`, `privacidad.html`, `404.html`, `descargables/<Instrumento>.html`.
6. URLs **siempre relativas** o con `<base>` (GitHub Pages sirve bajo `/instruments/`).
7. Cambios quirúrgicos: leer antes de editar, un commit por requisito, diff resumido.
8. No afirmar que algo "funciona en iOS" sin haberlo probado; listarlo en "A verificar en dispositivo".
9. **Los claims del sitio deben coincidir con el código.** Los textos de estado (`exporta`, `guarda`, `app`) salen de `data/instrumentos.json` y solo se activan cuando el instrumento lo cumple.
10. **Sesiones C (instrumentos):** trabajar en un worktree propio; commits con `git commit -- <rutas>`; no tocar archivos compartidos (ZIP, `data/instrumentos.json`, `sw.js`, `docs/`, `tools/`, otros instrumentos); entregar `reports/<slug>.md`. El ZIP, `data/instrumentos.json` y `sw.js` los resuelve la sesión de integración (D).
    - *Alcance de la regla:* lo de no tocar archivos compartidos (incluida `docs/`) vale para sesiones que corren **en paralelo** en ramas o worktrees distintos, donde dos sesiones editando el mismo archivo se pisan al fusionar. Una sesión **secuencial sobre `main`** (la anterior ya terminó y se fusionó) **sí puede** actualizar `docs/tests.md` y `docs/QA-dispositivos.md` (en el mismo commit que el cambio o en uno aparte), por ejemplo al agregar un test o al dejar algo por probar en un dispositivo. El ZIP, `data/instrumentos.json` y `sw.js` siguen siendo de la sesión de integración.

### 3.2 Un solo archivo, dos usos

- Fuente de verdad: `descargables/<Instrumento>.html`. Es el archivo que se sirve en la web (iframe y "abrir en pantalla completa"), el que se descarga y el que va al ZIP.
- **GA nunca va en los instrumentos.** Sí va en las páginas del sitio.
- **Instalable solo desde la web.** Un HTML abierto en `file://` no puede registrar service worker ni manifest (los navegadores exigen https o localhost). La copy del sitio y del README tiene que decirlo: "Instalá desde la web, o bajá el HTML para usarlo local".
- El bloque `zd-pwa` (v3) solo registra el service worker si `location.protocol` es `http:`/`https:`, la página **no** está en un iframe (`window.top === window`) y el manifest responde OK (`HEAD`). **En un iframe**: inerte y sin errores en consola. **En `file://`**: sin SW, sin manifest y sin pedidos de red; solo muestra un aviso discreto y descartable ("Estás usando el archivo local. Para instalarlo como app, abrí la versión web") con un botón que abre el `<link rel="canonical">`.
- El ZIP se genera con `tools/build-zip.mjs` desde `descargables/` (no se edita a mano). `tools/check-zip.mjs` falla si el ZIP no coincide byte a byte con la carpeta.

### 3.3 Requisitos

#### R1 · Layout portrait-first

- Diseñar con **360×640** como mínimo. Verificar en 390×844, 430×932, iPad vertical 768×1024, landscape 844×390 y desktop ≥1024.
- Estructura vertical: **barra superior 48 px** (logo compacto, nombre, transporte mínimo, menú) → **zona de tocar** (flexible, ≥45 % del alto útil en `dvh`) → **tabs inferiores 56 px + `env(safe-area-inset-bottom)`** (máximo 5) → **bottom sheets** (máx. 70dvh, handle, scrim; cierra por swipe, tap afuera o Escape).
- En instrumentos que se tocan mientras se ajustan: el sheet tiene modo *peek* (≤45dvh) y la zona de tocar sigue usable.
- **Eliminar `#zd-rotate`** y la media query `orientation:portrait` que lo dispara. Landscape pasa a ser mejora progresiva.
- Preferir CSS (grid, `clamp()`, container queries) antes que mover nodos del DOM. Si se reubican, una sola vez y no en cada cambio de orientación. Evitar depender de `:has()` para el layout principal.
- Targets táctiles ≥44 px en el eje corto. En grillas de 8 columnas (steps) se acepta 38–40 px de ancho si el alto es ≥48 px (a 360 px de ancho salen ~39 px por columna).
- Tipografía: labels ≥11 px, valores ≥12 px, texto corrido ≥14 px. Hoy hay 8–32 declaraciones ≤10,5 px por archivo.
- Viewport: `width=device-width, initial-scale=1, viewport-fit=cover`. **Quitar** `maximum-scale` y `user-scalable=no`. Gestos por `touch-action`.
- `100vh` → `100dvh` con fallback. `overscroll-behavior:none` en la zona de tocar. `-webkit-touch-callout:none` y `user-select:none` **solo** en superficies de tocar.
- Knobs: arrastre vertical, valor visible mientras se arrastra, doble tap = reset, long-press = entrada numérica; slider alternativo en móvil.
- **Volver al sitio**: entrada "← Sitio" en el menú móvil (hoy el footer se oculta en el shell horizontal). El link lleva `rel="noopener"`.

#### R2 · PWA real

- `manifests/<slug>.webmanifest` **estático** por instrumento. Ojo: las URLs del manifest son relativas **al manifest**, así que `start_url: "../descargables/<Archivo>.html"` y `scope: "../"`. Además `name`, `short_name`, `id`, `display: "standalone"`, `orientation: "any"`, colores e íconos.
- Íconos PNG por instrumento (color de acento) en `icons/`: 192, 512, 512 maskable y `apple-touch-icon` 180.
- **Un único `sw.js` en la raíz** (scope `/instruments/`): precache versionado (`zd-v<n>`; hoy `zd-v3`) de los 5 instrumentos + manifests + íconos; *stale-while-revalidate* para HTML; al haber versión nueva, `postMessage` → toast "Nueva versión · Recargar". No precachear el ZIP.
- El instrumento lo registra con `register('../sw.js', { scope: '../' })` desde `zd-pwa` (ver 3.2 para las condiciones).
- Quitar el manifest armado con `blob:` en CronBeat y MonoMoon.
- Botón **Instalar** unificado: `beforeinstallprompt` donde exista; en iOS, hint "Compartir → Agregar a inicio". Oculto si ya corre en `display-mode: standalone` o dentro de un iframe.
- `apple-mobile-web-app-capable` y `apple-mobile-web-app-title` (marca, ver R7).
- El `<meta name="theme-color">` de cada HTML coincide con el `theme_color` de su manifest. El `SLUG` de `zd-pwa` sale del `<link rel="manifest">`.
- Cada HTML lleva `<link rel="canonical" href="https://zeroday-musicexploits.github.io/instruments/descargables/<Archivo>.html">` (URL absoluta): `zd-pwa` lo usa para el aviso del archivo local.
- **Oferta de instalación (`zd-pwa` v3)**: banner descartable dentro de `#zd-stage` al abrir (no puede tapar PLAY, el transporte ni la superficie principal), ícono "↓" en la barra superior, botón en el header en escritorio sin shell, hint de iOS (Safari, Chrome y Firefox) con ícono de Compartir, y aviso "abrí este link en Safari o Chrome" en navegadores embebidos (Instagram, Facebook, TikTok…). "Ahora no" guarda 14 días en `localStorage`. Ver `docs/pwa.md`.
- Probar: instalar, abrir offline (modo avión), actualizar versión.

#### R3 · Autoguardado (fundamental)

- **IndexedDB** (fallback `localStorage`), clave `zd:<slug>:session`, formato `{ app, version, savedAt, data }`.
- Dispara con **debounce de 1,5 s** ante cambios + `visibilitychange` (hidden) + `pagehide`. No depender solo de `pagehide` (poco confiable en iOS).
- Al abrir: restaurar **sin arrancar el audio**, toast "Sesión restaurada" + "Empezar de cero" (con modal de confirmación).
- `navigator.storage.persist()`. Safari puede vaciar el storage de sitios no instalados tras ~7 días sin uso: la ayuda recomienda exportar JSON como backup.
- MonoMoon: migrar la DB `hackwave-minimoog` a un nombre nuevo **sin perder los patches** (leer, copiar, dejar la vieja intacta una versión).
- Qué se guarda por instrumento: ver 3.4.

#### R4 · Exportación: JSON completo + MIDI + WAV en los 5

| Instrumento | JSON | MIDI | WAV |
|---|---|---|---|
| CronBeat | ✔ mantener | ✔ mantener | ✔ mantener |
| Acid Bass | ✔ mantener | ✔ mantener | ✔ mantener |
| MonoMoon | ✔ ampliar a estado completo | **nuevo**: captura de performance | ✔ mantener (unificar UX con REC) |
| Nebularp | **nuevo**: estado completo | **nuevo**: notas del arpegio | **nuevo: REC posta** |
| J4 | ✔ ampliar a estado completo | **nuevo**: captura de performance | **nuevo: REC posta** |

- **REC posta** (los que suenan sin cortarse): `● REC` → graba la salida master → `■` → resultado con duración y tamaño + reproducir + `⭳ Descargar WAV`. PCM 16-bit estéreo a la frecuencia real del `AudioContext`. Captura por AudioWorklet (reutilizar el de MonoMoon), fallback `MediaStreamDestination` + `MediaRecorder` + `decodeAudioData`. Chunks Int16; tope de 10 min con aviso (≈115 MB).
- **MIDI de performance** (valores por defecto, ver sección 5): notas on/off con timestamps y tempo; pitch bend para glide/barridos; CC1 para mod; CC74 (cutoff) para X y CC71 (resonancia) para Y donde exista pad XY. Reutilizar el escritor SMF de CronBeat/Acid.
- JSON: `{ app, version, savedAt, data }`, validación al importar (app y versión) con el error en un modal.
- Descarga: `ZD.download(blob, nombre)` → `<a download>` y, en iOS standalone o si `navigator.canShare({files})`, **Web Share con archivo**. Nombre: `<slug>-YYYYMMDD-HHmm.<ext>`.

#### R5 · Audio e iOS (fundamental que funcione en iOS)

- `navigator.audioSession.type = 'playback'` donde exista (Safari 16.4+); fallback: `<audio>` silencioso en loop (data URI) iniciado en el primer gesto. Objetivo: que suene con el switch de silencio activado.
- Desbloqueo: crear/`resume()` el `AudioContext` **dentro** del handler del gesto (`pointerup`, `click` o `keydown`) vía `ZD.audio.unlock()`.
- Manejar **`interrupted`** (iOS: llamadas, Siri, segundo plano) y `suspended`: reanudar en `visibilitychange`, `pageshow` y `focus`; si no se puede sin gesto, overlay "Tocá para reanudar".
- `latencyHint:'interactive'` en los 5. No asumir sample rate (iOS alterna 44,1/48 kHz). `decodeAudioData` en forma Promise con fallback a callback.
- **Screen Wake Lock** mientras suena: pedir al play, soltar al stop, re-pedir en `visibilitychange`; degradar en silencio si no hay soporte.
- **Web MIDI no existe en Safari ni en ningún navegador de iOS**: mostrar "MIDI no disponible en este navegador". Verificar el soporte actual en MDN/caniuse, no asumir.
- Indicador de clip (solo mide). No agregar limitador ni compresor sin aprobación; si el instrumento queda expuesto a clipping, proponerlo en el reporte. Modo "baja carga" para visualizadores (J4, Nebularp).
- Probar en iPhone: Safari **y** PWA instalada: primer toque, switch de silencio, bloqueo de pantalla, llamada entrante, segundo plano y volver, rotación, rendimiento.

#### R6 · UX, accesibilidad y robustez

- Reemplazar `alert`, `confirm` y `prompt` (7: MonoMoon 4, Acid 2, CronBeat 1) por `ZD.modal.*` (Promises) y `ZD.toast`. El `prompt('Nombre del patch')` de MonoMoon pasa a modal con input.
- Knobs: `role="slider"`, `aria-valuemin/max/now/valuetext`, `aria-label`; teclado ←→↑↓, PgUp/PgDn, Home/End. Pads y steps: `aria-pressed`. `:focus-visible`. Contraste AA.
- `prefers-reduced-motion` ya existe: que también apague los visualizadores pesados.
- Auditar `innerHTML` (≈39 usos): todo dato de un JSON importado, de un nombre de archivo o del usuario va con `textContent` o escapado.
- Errores de import/decode/export en modal, con mensaje humano.
- `deferred.prompt()` (beforeinstallprompt) no es un diálogo nativo: no se reemplaza como `prompt()`.

#### R7 · Marca y copy

- "Synthetizer" → "Synthesizer".
- Marca: **CronBeat-8:08** (archivo `CronBeat-808.html`), unificada en títulos, manifest y README.
- `apple-mobile-web-app-title` y manifest: "MonoMoon" y "CronBeat", no "Minimoog" ni "Ritmos". "Minimoog" es marca de Moog: dejar "estilo Minimoog" solo como descripción. (No es asesoramiento legal.)

#### R8 · Sitio

- **Estático generado**: mismas páginas y URLs, sin `support.js`, sin React, sin unpkg, sin CDN (salvo GA en las páginas del sitio). Datos en `data/instrumentos.json`, plantillas en `templates/`, generador `tools/build-site.mjs`.
- Cada página con `lang="es"`, `title`, `description`, `canonical`, Open Graph, Twitter Card, favicon y `theme-color`. Las landings con JSON-LD `SoftwareApplication`. `sitemap.xml`, `robots.txt`.
- `404.html` con `<base href="/instruments/">`. Stubs de redirect (meta refresh + JS) en las 5 URLs viejas de la raíz hacia la landing del instrumento.
- Budget: HTML de cada página <60 KB sin imágenes, sin JS bloqueante; Lighthouse móvil ≥95 en Performance, Accesibilidad, Best Practices y SEO.

### 3.4 Anexo por instrumento

**Bloques `ZD` compartidos** (los produce la sesión B y se pegan idénticos en los demás): `zd-mobile` v5 (shell portrait, con carril de scroll en los sheets), `zd-audio` v2, `zd-store` v1, `zd-ui` v2, `zd-rec` v2, `zd-dl` v1, `zd-midi` v2, `zd-pwa` v3. Versiones y changelog: `docs/zd-blocks.md`.

**ACID BASS-303** (piloto)
- Portrait: steps 2×8 arriba; editor del paso (nota / accent / slide / gate) debajo; pad XY cutoff/resonance siempre visible; tabs [Seq | Sonido | Filtro | Patrón | Export].
- Autoguardar: patrón, parámetros, banco de usuario, tempo, swing.
- Extras (después del core): undo de un nivel para RANDOM/MUTAR; curar el banco de fábrica por estilo.

**NEBULARP 2035**
- Portrait: orbit arriba, pad multitáctil abajo; tabs [Escala | Arp | Sonido | Espacio | Teclado].
- Autoguardar: escala, tónica, latch, patrón, subdivisión, octavas, Euclid, todos los paneles.
- Nuevo: REC posta → WAV; MIDI de las notas del arpegio; JSON completo; manifest.
- Extras: modo autoplay generativo.

**J4-Sirens Station**
- **Bug**: `body{touch-action:none}` (línea ~27). Aplicarlo solo al pad XY, al visualizador y al botón SIREN; el resto `manipulation`.
- Portrait: pad XY como protagonista (≥60 % del alto útil), botón SIREN grande con hold/latch, kill switches y echo throw al alcance del pulgar; ajustes en sheets.
- Autoguardar el estado actual (hoy solo slots manuales en `localStorage`) y mantener los slots.
- Nuevo: REC posta → WAV; MIDI de performance; manifest. Visualizador opcional / baja carga.

**MonoMoon'70**
- Portrait: 6 macros (Cutoff, Reso, Env Amt, A/R, Glide, Volumen) + pad XY; teclado abajo; ruedas Pitch/Mod verticales al costado; sheets [Osc | Filtro | Mod | Voz | Patches].
- Autoguardar el patch en edición + biblioteca; migrar la DB `hackwave-minimoog`.
- Nuevo: MIDI de performance (notas, pitch bend, CC1); unificar `● Grabar` con REC→descargar; 4 diálogos nativos → modales. Es el que más texto chico tiene (32 declaraciones ≤10,5 px).

**CronBeat-8:08**
- Portrait: pads 4×4 grandes; tabs [Pads | Seq | FX | Sample | Canción]; transporte fijo arriba; secuenciador en 2 filas de 8.
- Ya tiene autoguardado, JSON, MIDI y WAV: mantenerlos. Falta: portrait, manifest estático (quitar `blob:`), `audioSession`, wake lock, modal en vez de `confirm`.
- Extras (después del core): choke groups, note repeat, velocity por posición del dedo, undo/redo.

### 3.5 Criterios de aceptación

**Por instrumento**
- [ ] Usable en portrait 360×640 sin scroll horizontal; landscape y desktop no se rompen.
- [ ] Sin `#zd-rotate`, `maximum-scale` ni `user-scalable=no`.
- [ ] Autoguardado: tocar → recargar → mismo estado.
- [ ] JSON / MIDI / WAV descargan y se abren (MIDI en un DAW, WAV en un reproductor).
- [ ] Hosted: instala, abre offline, actualiza. En `file://` y dentro de un iframe: sin errores de consola.
- [ ] Cero `alert/confirm/prompt`.
- [ ] Lighthouse móvil (hosted): Accesibilidad ≥90, Best Practices ≥90, instalable.
- [ ] `node tools/check-blocks.mjs` sin diferencias.
- [ ] `<link rel="canonical">` presente y el banner de instalar no tapa los controles en 360×640 y 390×844.
- (El ZIP y `data/instrumentos.json` los verifica la sesión D: `node tools/check-zip.mjs` en verde.)
- [ ] Lista "A verificar en dispositivo" completa y honesta.

**Sitio**
- [ ] Cada página muestra contenido sin JS (`curl` de la URL devuelve el manual).
- [ ] Vista previa correcta al compartir cada landing (OG image incluida).
- [ ] 404 correcto en una ruta anidada; las 5 URLs viejas redirigen.
- [ ] "Descargar los 5" entrega el ZIP; las descargas individuales salen con nombre limpio.
- [ ] Lighthouse móvil ≥95 en las 4 categorías.
