# NEBULARP 2035 — reporte de la sesión C

Rama `c-nebularp` · 2026-10-03 · archivo: `descargables/Nebularp_2035.html`
(slug `nebularp`).

Quedaron hechos R1 a R7 y el extra (autoplay generativo). Los 8 bloques ZD
están pegados byte a byte desde `tools/blocks/`. El adaptador C2 no cambió. Todo
se verificó en **Chromium (Playwright)**; nada se probó en un dispositivo real
ni en WebKit o Firefox (sección 6). Los dos bugs de bloques que encontré
([`nebularp-block-request.md`](nebularp-block-request.md)) ya están arreglados
en `main` (`zd-midi` v2, `zd-mobile` v3/v4) y Nebularp tiene esas versiones
(sección 0).

---

## 0 · Actualización 2026-10-04: bloques corregidos

`main` trajo `zd-midi` v2, `zd-mobile` v4, `tools/sync-blocks.mjs` y los tests
genéricos. El merge (`a12efa9`) entró sin conflictos.

**Qué cambió en Nebularp**

- **Bloques.** `node tools/sync-blocks.mjs` repegó `zd-mobile` v2→v4 y
  `zd-midi` v1→v2. El diff del HTML en esas dos regiones es idéntico al de
  `tools/blocks/`. `check-blocks` y `sync-blocks --check` dan verde.
- **Skin de la barra superior.** `html.zd-m #zd-top .play` y `.recbtn` fijaban
  `min-height:40px` con especificidad (1,2,1), más alta que la del piso de 44 px
  del bloque (1,0,1). Ganaba el skin, así que PLAY y REC medían 40 px. Pasaron a
  44 (lo detectó el caso 7 del test). Medido con el ícono de instalar visible
  a 360×640, 390×844, 640×360, 820×1180 y 844×390: barra de 48 px, PLAY de
  45×44 (solo el glifo, por debajo de 430 px) o 104×44, REC de 63×44, ↓ y ⋯ de
  44×44, sin recortes en `.zd-ttr` y sin scroll horizontal.
- **`ZD_M`, pestaña Teclado.** `'.wrap > .note'` y `'.wrap > .credits'`
  pasaron a `#usageNote` y `#credits` (los dos nodos tienen ids nuevos). Un
  selector que depende de la posición deja de matchear en cuanto el bloque
  mueve el nodo. El test lee `ZD_M` con el shell activo, así que esperaba solo
  `[ioPanel, pcPanel]` y fallaban los casos 1 a 4. No cambia nada visible: son
  los mismos 4 nodos, en el mismo orden.
- **El hueco de 1,5 ticks de `endTake()` quedó como estaba.** Con v2 ya no
  hace falta, pero no molesta: el hueco mínimo medido entre dos notas de la
  misma altura es de 1 tick.

**Tests**

| Test | Resultado |
| --- | --- |
| `zd-mobile-cycle --file descargables/Nebularp_2035.html --cycles 4` | 6 de 7. Falla el caso 5 (foco) por un supuesto del test que no cumple este layout; el bloque está bien (ver abajo) |
| `zd-midi-order` | 6 de 6 |
| Re-verificación de Nebularp (Playwright) | 17 de 17 (detalle en el anexo) |

**Caso 5 de `zd-mobile-cycle`: pedido para quien mantenga `tools/tests/`.**
No lo toqué. El test enfoca el propio nodo de `keep[0]` con `tabindex="-1"`.
En Nebularp `keep[0]` es `.hero`, que en el shell pasa a `display:contents`
para que el orbit y la columna de transporte sean celdas de la grilla del stage.
Un elemento sin caja no puede tener el foco: Chromium no lo enfoca ni con
`focus()` directo dentro del shell, así que el foco cae en `BODY`. El bloque
hace lo correcto:

- Con una copia del test que enfoca el primer `button` de `keep[0]` (`#play`,
  que además viaja a la barra), el caso 5 pasa entero:
  `keep0 → keep0 → keep0 · scrollY 320 → (reflow 311) → 0 → 311`.
- `#latch`, `#tap` y `#octDown` también conservan el foco al entrar y al salir.

Propuesta: que el test elija el primer nodo de `keep` cuyo `display` dentro
del shell no sea `contents`, o un descendiente enfocable. No cambié el layout
para que pase. Sacar el `display:contents` obliga a rehacer la grilla del stage,
y reordenar `keep` cambia el orden de foco y de lectura.

---

## 1 · Flags para el sitio (los aplica D en `data/instrumentos.json`)

```json
"exporta": ["WAV", "MIDI", "JSON"],
"guarda": true,
"app": true
```

| Flag | Valor | Mecanismo |
| --- | --- | --- |
| `exporta` | WAV, MIDI, JSON | **WAV**: REC graba en vivo la salida master (zd-rec), PCM 16-bit estéreo a la frecuencia real del contexto, con un tope de 10 min. **MIDI**: las notas de cada toma de REC (zd-midi), con el tempo de la toma. **JSON**: la sesión completa con el envoltorio `{app, version, savedAt, data}` e import validado. |
| `guarda` | sí | zd-store: IndexedDB `zd-sessions/sessions`, fallback a `localStorage`, clave `zd:nebularp:session`, app `nebularp-2035` v1, debounce de 1,5 s + `visibilitychange`/`pagehide`. Restaura sin arrancar el audio. Dentro del hub C2 no guarda (el host es el dueño del estado). |
| `app` | sí | `<link rel="manifest" href="../manifests/nebularp.webmanifest">`, `theme-color #9a8cff` (igual que el manifest), apple-touch-icon y zd-pwa v2. Se instala **desde la web**; en `file://` solo aparece el aviso con el link al canonical. |

Para D:

- **Copy del MIDI**: el MIDI sale de lo que se graba con REC. No es un
  "export del patrón" como en Acid Bass. Sugiero "MIDI de lo que grabás".
- **`sw.js`**: Nebularp ya está en `PRECACHE_URLS`. Como el HTML cambió,
  hay que subir `VERSION` para que las instalaciones reciban la actualización.
  Hoy `main` está en `zd-v2` (hotfix de Acid), así que al publicar Nebularp
  pasa a `zd-v3`.
- El ZIP no lo toqué. Hay que regenerarlo con este HTML.

---

## 2 · Commits y decisiones

| Commit | Qué |
| --- | --- |
| `38b08c8` | Bloques ZD: los 8 pegados idénticos, `window.ZD_M` v2 y fuera el shell v1 con `#zd-rotate` |
| `4285dc3` | R1: layout portrait-first |
| `cc2e458` | R3: autoguardado completo, restauración sin audio |
| `50b6530` | R4: JSON completo, MIDI de las notas del arpegio y REC → WAV |
| `0de6243` | Pedido de cambio a zd-midi v1 y zd-mobile v2 (`reports/`) |
| `77a255d` | R5: zd-audio, latencyHint, clip y visualizador liviano |
| `9809d4e` | R6: accesibilidad, contraste y robustez |
| `188a19d` | R2: manifest, canonical, theme-color y zd-pwa v2 |
| `412c06b` | R7: copy y nombres |
| `fe812b0` | Extra: autoplay generativo (después de verificar el core) |
| `81f7105` | Este reporte |
| `a12efa9` | Merge de `main` (`zd-midi` v2, `zd-mobile` v4, sync-blocks, tests) |
| siguiente | Bloques repegados, skin de la barra a 44 px, ids en `ZD_M` y la actualización de este reporte (sección 0) |

El HTML pasó de 132 KB a 256 KB: ~88 KB son los 8 bloques y el resto es el
código nuevo y la piel.

### Decisiones

**Layout (R1)**

- **Zona de tocar.** El orbit queda arriba, con una columna de transporte
  (BPM, tap, latch) y la octava. El piano multitáctil va abajo. `.hero`
  pasa a `display:contents` y `#zd-stage` es una grilla. El banner de
  zd-pwa tiene su propia fila (`grid-area: banner`), así que achica el resto
  pero no lo tapa. No se mueve ningún nodo fuera de lo que mueve el bloque.
- **Piano en dos filas.** Cuando el piano tiene menos de 640 px de ancho
  útil, pasa a dos filas de una octava (la grave abajo). Se resuelve por
  container query sobre `.kbwrap` y variables `--o/--b` que pone
  `renderPiano`. A 360 px las teclas quedan de ~50 px de ancho en vez de
  ~25 px. El multitáctil y el glissando no cambiaron; también funcionan
  entre filas. En escritorio sigue la fila única de 14 blancas.
- **Sheets en modo peek** (Escala, Arp, Sonido, Espacio). En vertical, el
  stage se achica por encima del sheet y quedan el piano, el latch y la
  octava, así se puede tocar mientras se ajusta (SPEC R1). En landscape el
  sheet ocupa la mitad izquierda y el piano sigue libre a la derecha.
- **Tabs.** Son las de la SPEC: `[Escala | Arp | Sonido | Espacio |
  Teclado]`. Como son 5 fijas, el panel nuevo **Sesión** (última toma, JSON,
  Empezar de cero, modo liviano) va en la pestaña **Teclado**, con el
  título de sheet "SESIÓN · TECLADO DE PC". Guardar y Abrir JSON y Empezar
  de cero también están en el menú ⋯. **REC está en la barra superior**,
  al lado de PLAY.
- **Knobs.** Doble tap = reset. Long-press o Enter = valor numérico en la
  unidad que se ve (%, ms, Hz, ¢). Slider alternativo en los sheets.
  Teclado completo con `ZD.ui.a11ySlider`, que opera sobre la fracción
  0..1 para que los knobs logarítmicos avancen parejo.

**Estado y exportación (R3 y R4)**

- **Un solo `SCHEMA`.** La sesión y el JSON comparten el mismo `SCHEMA`
  (37 claves con rango o valores válidos). Se usa para restaurar y para
  importar: acota rangos e ignora lo desconocido. `applyState()` sincroniza
  toda la UI y no crea el `AudioContext`: `initAudio()` lee `state` al
  armarse. `api.setState()` del adaptador quedó vacío, como estaba.
- **Detune y Spread** escriben el mismo `state.detune` (Detune va de 0 a
  25, Spread de 0 a 40). Ahora se muestran sincronizados y se restauran en
  orden de creación para que el valor final sea el guardado.
- **Se guarda también el acorde latcheado.** Con latch, al recargar el
  acorde vuelve y suena al darle PLAY.
- **El MIDI viene de la misma toma de REC.** Se capturan las notas que
  programa el scheduler (swing, ratchet, chord, prob) y las del pad
  sostenido con el transporte parado. El archivo se ancla al primer paso de
  la grilla, así cae en la grilla del DAW, y lleva el tempo que había al
  arrancar la toma. Cada altura suena de a una nota por vez, con 1,5 ticks
  entre repeticiones (era el workaround del bug de zd-midi de la sección 3;
  con v2 sobra, pero queda).
- **El JSON solo acepta el envoltorio completo.** Sin envoltorio, de otra
  app, de una versión más nueva, sin versión, sin datos o sin ninguna clave
  reconocible: cada caso sale en un modal con un mensaje humano.

**Audio y visualizador (R5)**

- **`latencyHint`** en la línea `HOST ? HOST.ctx : new AudioContext(...)`.
  Es el único cambio en una línea que menciona HOST.
- **zd-audio solo fuera del hub C2.** Dentro del hub el contexto es del host.
- **`setPlaying()`** se activa mientras suena el transporte **o el drone**:
  el drone suena con el transporte parado y también necesita wake lock y el
  overlay de reanudar.
- **Visualizador.** `sizeCanvas` dejaba que el canvas se realocara en cada
  cuadro (asignaba `width/height` siempre); ahora solo lo hace si cambia el
  tamaño. El **modo liviano** deja las estrellas quietas, redibuja la órbita
  solo cuando cambia el paso, a ~20 fps como máximo y sin glow. Se activa a
  mano o lo fuerza `prefers-reduced-motion` (en vivo). Se guarda en la
  sesión pero no en el JSON, porque es una preferencia del dispositivo.

**Accesibilidad y teclado (R6)**

- **El teclado global** no toca notas mientras se escribe ni con un modal
  abierto, y respeta lo que ya resolvió un control (Espacio en un knob = valor
  numérico).
- **Espacio sobre un botón.** Si el foco llegó por teclado (Tab), Espacio
  aprieta el botón. Si llegó por mouse, Espacio sigue siendo play/stop.
  `:focus-visible` no sirve para esto: Chrome lo activa al apretar
  cualquier tecla.

**Autoplay (extra)**

- No se guarda en la sesión, porque restaurarlo obligaría a arrancar el
  audio. Tocar una tecla o detener el transporte lo apaga.

---

## 3 · Pedidos de cambio a bloques

Detalle, reproducción y arreglo propuesto en
[`nebularp-block-request.md`](nebularp-block-request.md). No toqué ningún
bloque. **Los dos están arreglados en `main` y verificados en Nebularp
(sección 0).**

1. **zd-midi v1** → **arreglado en v2**: con off y on en el mismo tick,
   `write()` escribía el note-off **después** del note-on, porque
   `ORDER.off` valía `0` y `(ORDER[x] || 9)` lo convertía en 9. La segunda
   nota quedaba de largo 0 o cerrada mal. Afectaba al piloto (Acid Bass,
   `0 ~ 0`). En Nebularp lo esquivé con el hueco de 1,5 ticks, que sigue ahí.
   El caso de prueba de la doc da `00 90 3c 64 · 30 80 3c 00 · 00 90 3c 64 ·
   30 80 3c 00` con el bloque embebido en Nebularp.
2. **zd-mobile v2** → **arreglado en v3**: después de `exit()`, volver a
   `enter()` dejaba barra, stage y tabs vacíos, porque `moveNodes` vivía
   dentro de `build()`, que corre una sola vez. Pasaba al redimensionar una
   ventana de escritorio de un lado al otro de 820 px y al rotar una tablet
   cuyo ancho cruza 1024 px (iPad Pro de 12,9"). Con v4, los tres pares de
   viewport del test dan 4 ciclos con el DOM idéntico, y la rotación
   1180×820 ↔ 820×1180 con el arpegio sonando no corta nada.

---

## 4 · Riesgos

- **El instrumento puede clipear con controles extremos.** Con todo al
  máximo (Level, 7 voces, 4 octavas, Chord de 5 notas, drone, reverb, delay
  con feedback 85 %, chorus) el master llega a **2,48 FS**: el LED de CLIP
  se enciende y el WAV queda recortado. Con el patch por defecto no pasa
  (pico 0,24 con Up y 0,67 con Chord de 10 notas). **Propuesta (no
  implementada, necesita aprobación porque cambia el sonido):** un limitador
  al final, por ejemplo un segundo `DynamicsCompressor` con threshold -1 dB,
  ratio 20, knee 0 y attack 1 ms entre `masterGain` y la salida. Esa línea
  menciona `C2_OUT`, así que hay que decidirlo junto con C2.
- **Tempo del MIDI.** Si se cambia el BPM durante una toma, el MIDI sigue
  exacto en segundos, pero desde ese punto deja de caer en la grilla (lleva
  un solo tempo, el del arranque).
- **Primer toque en iOS.** En pantallas táctiles, el `pointerdown` del
  piano no cuenta como gesto que habilita el audio: lo destraba el
  `touchend` (bindGesture). Es probable que la primera nota no suene.
  Pasaba igual antes.
- **Navegadores viejos.** Sin container queries (iOS < 16) el piano queda
  en una fila de teclas de ~25 px. Sin `dvh` se usa `vh`.
- **Memoria de REC.** La captura guarda Int16 en memoria: ~115 MB en
  10 minutos. Hay tope y aviso.
- **REC dentro del hub C2.** El tap cuelga de `masterGain` y debería
  funcionar, pero lo probé solo con un hub falso (registro, tempo,
  onTransport y onTick) y sin grabar.
- **Teclado.** Cambió el comportamiento de Espacio sobre botones con foco de
  teclado (ver decisiones). Es una mejora de accesibilidad, pero quien
  navega con Tab y espera play/stop tiene que sacar el foco del botón.
- **Offline.** Al abrir sin red, Chrome loguea un "Failed to load resource"
  por el `HEAD` al manifest que hace zd-pwa (sw.js no atiende HEAD). No es
  un error de JS y la app abre bien (sección 5).

---

## 5 · Hallazgos que aplican a los otros instrumentos

1. **zd-midi** (sección 3): arreglado en v2. MonoMoon y J4 tienen que pegar
   v2 antes de usar el recorder.
2. **zd-mobile** (sección 3): arreglado en v3; v4 suma el piso de 44 px en
   la barra. Lo que sigue aplica a las sesiones C que todavía no lo pegaron.
   **Revisar el skin:** cualquier `min-height` menor a 44 sobre un control
   de `#zd-top` con más especificidad que `#zd-top button` le gana al piso
   del bloque. En Nebularp pasaba con PLAY y REC.
3. **Selectores de `ZD_M` que no dependan de la posición.** Un selector como
   `.wrap > .note` deja de matchear en cuanto el bloque mueve el nodo. Hoy el
   bloque solo resuelve los selectores fuera del shell, así que funciona, pero
   el test genérico los resuelve con el shell activo y falla. Mejor usar ids.
4. **`display:contents` en un nodo de `keep`.** Si el skin hace eso (en
   Nebularp, `.hero`), ese nodo no puede tener el foco y el caso 5 de
   `zd-mobile-cycle` falla aunque el bloque esté bien (sección 0).
5. **Peek y superficie de tocar abajo.** El sheet en modo peek tapa la
   superficie de tocar cuando está abajo. En el piloto, a 360×640, el sheet
   peek de 45dvh también tapa el pad XY. La receta de Nebularp es solo CSS
   y se puede reusar en J4 y MonoMoon:
   `html.zd-m.zd-sheet-open:not(.zd-sheet-full) #zd-stage{height:calc(var(--zd-stage-h) - 45dvh)}`
   y esconder lo que no hace falta mientras se ajusta. En landscape, sheet
   peek a media pantalla.
6. **Banner de zd-pwa con un stage en grilla.** Si un instrumento pone
   `#zd-stage` en grid, tiene que darle fila propia al banner
   (`.zd-pwa-banner, .zd-pwa-local { grid-area: banner }`).
7. **Teclados en pantalla.** La container query de dos filas sirve para el
   teclado de MonoMoon.
8. **Teclado global.** Si un instrumento escucha `keydown` en `window`
   (MonoMoon, CronBeat), tiene que ignorar inputs y modales abiertos:
   `ZD.modal.prompt` deja escribir y cada letra tocaría una nota. También
   tiene que mirar `e.defaultPrevented`: `ZD.ui.a11ySlider` usa Espacio y
   Enter para `onEnter`.
9. **Knobs logarítmicos.** Con `a11ySlider` conviene operar sobre la
   fracción 0..1: el paso lineal en el dominio del valor queda muy grueso en
   la parte baja.
10. **Canvas por cuadro.** Asignar `canvas.width/height` en cada cuadro
   realoca el buffer. Conviene revisarlo en el visualizador de J4.
11. **zd-pwa offline.** Sin red, el `HEAD` al manifest falla y Chrome lo
   loguea en consola. Opciones: que sw.js responda HEAD desde la cache o que
   zd-pwa lo saltee con `navigator.onLine === false`. Lo decide D, porque
   toca sw.js o el bloque.
12. **Contraste.** `--zd-phosphor-dim` como texto da 3,4:1. El token AA
    `--zd-phosphor-txt` del piloto conviene llevarlo a los 5 skins.
13. **Para testear:**
    - **Multitáctil por CDP.** En `Input.dispatchTouchEvent`, `touchEnd`
      suelta **los puntos que se le pasan**; mandar `touchMove` sin un punto
      no lo suelta.
    - **Standalone.** `Emulation.setEmulatedMedia` con `display-mode` no
      tuvo efecto en esta versión de Chromium. Sirven un `matchMedia` falso
      o `navigator.standalone`.
    - **Playwright en un worktree.** Los tests de `tools/tests/` importan
      `playwright` y el worktree no tiene `node_modules/`. Sin instalar
      nada: un `node_modules/` con symlinks a `playwright` y
      `playwright-core` del checkout principal. Como es un directorio, lo
      cubre el `.gitignore`.
    - **Un instrumento sin globales.** Para saber si suena, un
      `addInitScript` que envuelve `AudioContext` (guarda las instancias) y
      cuenta los `start()` de `AudioScheduledSourceNode`. Si el contador
      sube, el arpegio está programando voces.
14. **Git en este disco.** El worktree está en un disco montado con dueño
    `root`, así que git pide `safe.directory`. Usé
    `git -c safe.directory=<ruta>` por comando, sin tocar la config global.

---

## 6 · A verificar en dispositivo

Nada de esta lista se probó en hardware real. Playwright solo tenía
Chromium instalado, así que tampoco se probó en WebKit ni en Firefox.
Lighthouse no corrió (no estaba disponible).

### iPhone · Safari y PWA instalada

- [ ] Primer toque: la primera tecla del piano destraba el audio y la
      siguiente suena (el primer toque puede salir mudo, ver riesgos).
- [ ] Con el switch de silencio activado suena (`audioSession.type =
      'playback'` en Safari 16.4+, `<audio>` silencioso antes).
- [ ] Bloqueo de pantalla con el arpegio sonando, llamada entrante, Siri,
      segundo plano y volver: aparece "Tocá para reanudar" y un toque
      reanuda.
- [ ] Wake lock: la pantalla no se apaga mientras suena el transporte o el
      drone (iOS 16.4+), y se apaga al parar.
- [ ] Multitáctil real: acordes de 3 a 5 dedos, glissando entre las dos
      filas, que no se cuelguen notas al apoyar la palma o al salir con el
      dedo por fuera del piano.
- [ ] Sheets en peek: tocar el piano con el sheet abierto; swipe hacia
      abajo para cerrar; que el scroll del sheet no robe gestos del slider.
- [ ] Rotación vertical ↔ horizontal: layout correcto, sin mover nodos de
      nuevo y sin perder la sesión.
- [ ] REC en Safari: AudioWorklet o fallback MediaRecorder; que el WAV salga
      a 44,1 o 48 kHz según el equipo y se escuche en la tarjeta.
- [ ] Descargas en iOS (Safari y standalone): WAV, MIDI y JSON salen por
      Web Share con archivo; probar "Guardar en Archivos".
- [ ] Import de JSON desde Archivos (`<input type=file>` del bloque).
- [ ] LED de CLIP: el analizador del medidor no está conectado al destino;
      en Chromium igual procesa (se probó). Falta confirmar que WebKit
      también lo procese.
- [ ] Rendimiento del orbit en modo completo frente a liviano en un iPhone
      de gama media (batería y temperatura con 10 minutos sonando).
- [ ] Container queries y `dvh` (iOS 16+): piano en dos filas y alto
      correcto con la barra de Safari visible y oculta.
- [ ] Instalación: banner con el hint "Compartir → Agregar a inicio" real,
      ícono apple-touch, nombre "Nebularp", abre standalone sin barra, y en
      standalone no aparecen ni el banner, ni el ícono ↓, ni el ítem de menú.
- [ ] Autoguardado: Safari puede vaciar el storage de sitios no instalados
      tras ~7 días sin uso. Confirmar que la nota del menú se lee y que
      instalada persiste.

### iPad

- [ ] Vertical 768×1024: piano en una fila (54 px por tecla) y sheets de
      dos columnas.
- [ ] iPad Pro 12,9": rotar vertical ↔ horizontal con el arpegio sonando.
      Con zd-mobile v4 el stage ya no queda vacío: en Chromium, 1180×820 ↔
      820×1180 da 8 rotaciones sin corte. Falta confirmarlo en el
      dispositivo.
- [ ] Teclado físico: mapeo A–;, Z/X y Espacio; que no toque notas mientras
      se escribe en un modal.

### Android · Chrome

- [ ] `beforeinstallprompt` real: banner dentro del stage, diálogo nativo
      con el ícono y el nombre correctos; aceptar → toast "App instalada" y
      no vuelve.
- [ ] "Ahora no" en uso normal: no vuelve durante 14 días.
- [ ] Primer toque, segundo plano, llamada y bloqueo: overlay y reanudar.
- [ ] Multitáctil real y gesto de "atrás" del sistema con un sheet abierto
      (no está manejado: sale de la página).
- [ ] REC de varios minutos: memoria y tamaño del WAV.

### Escritorio

- [ ] Safari y Firefox (no se probaron): audio, REC (en Firefox el
      AudioWorklet debería estar), MIDI, JSON, sesión y modo liviano.
- [ ] Botón "↓ Instalar" de escritorio en Chrome/Edge real, y que
      desaparezca al instalar desde la barra de direcciones.
- [ ] Ventana que cruza 820 px de ancho, arrastrando el borde a mano en
      Chrome, Safari y Firefox. Con zd-mobile v4 el shell se vuelve a armar
      bien (lo cubre `zd-mobile-cycle` con 1440×900 ↔ 390×844).

### Service worker y archivo local

- [ ] Instalado + modo avión real → abre desde la cache (probado con
      `setOffline` en Playwright).
- [ ] Subir `VERSION` de sw.js → toast "Nueva versión disponible" (no en
      una instalación limpia).
- [ ] Doble clic en el HTML descargado (file:// real del Finder/Explorador):
      solo el aviso "Estás usando el archivo local…", sin errores.

### Música

- [ ] Abrir un `.mid` de una toma en un DAW (Ableton, Reaper o
      GarageBand): tempo, notas sobre la grilla y ninguna nota colgada. En
      Python se validó la estructura, no en un DAW.
- [ ] Abrir el WAV en un reproductor y en un DAW.

---

## Anexo · Qué se verificó y cómo

Todo con Playwright 1.63 (Chromium) contra un servidor local que sirve el
worktree bajo `/instruments/`, como GitHub Pages.

- **Viewports** 360×640, 390×844, 430×932, 768×1024 y 844×390 (táctil) y
  1440×900: sin scroll horizontal, sin errores ni warnings de consola, sin
  `#zd-rotate`. También 844×390 con puntero fino (sin shell) y el
  instrumento en un iframe de 360 px.
- **Multitáctil** por CDP: 3 dedos simultáneos, glissando de un dedo
  mientras los otros siguen apretados, paso a la fila de arriba y suelta
  dedo por dedo. Las teclas activas siguen a cada dedo.
- **Knobs:** slider, doble tap (reset), long-press (modal con la unidad
  visible), Home/End/PgUp y Detune/Spread sincronizados.
- **Persistencia:** 26 cambios (19 knobs, 5 selectores, latch con acorde,
  Euclid, octava) → recargar → DOM idéntico. Ningún `AudioContext` creado
  al restaurar, PLAY en false, toast "Sesión restaurada". Con
  `indexedDB = undefined` cae a `localStorage` y restaura igual. "Empezar de
  cero" desde el menú: modal, valores de fábrica y la recarga siguiente sale
  limpia.
- **Export:**
  - **JSON:** sale con el envoltorio `{app,version,savedAt,data}`. Se
    probaron 9 rechazos con mensaje (JSON roto, array, sin envoltorio, otra
    app, versión 9, sin versión, sin datos, sin claves válidas y un nombre
    de archivo con HTML, que se muestra como texto). El import válido
    acota (Voces 99 → 7).
  - **WAV:** PCM 16-bit estéreo a 44,1 kHz (la frecuencia del contexto);
    abre con el módulo `wave` de Python y no está en silencio.
  - **MIDI:** formato 0, 96 ppq, con el tempo de la toma, inicios sobre la
    grilla, **0 notas colgadas y 0 solapadas**. Casos probados: una nota con
    gate 150 % y ratchet, Chord, pad con una tecla apretada al cortar, y
    autoplay.
- **Audio:**
  - Antes del primer toque hay 0 contextos. Al tocar: `running`, con
    `latencyHint:'interactive'` y el `<audio>` silencioso.
  - `suspend()` → overlay → toque → `running`. Con el transporte parado no
    aparece el overlay.
  - CLIP se enciende con una fuente forzada y se apaga solo.
  - Visualizador: completo 120 `clearRect`/s, liviano 3/s; con
    reduced-motion el liviano queda forzado y el toggle deshabilitado.
- **zd-pwa** (con `beforeinstallprompt` sintético):
  - El banner entra en `#zd-stage` sin superponerse con PLAY, REC,
    transporte, orbit, octava, piano ni tabs a 360×640 y 390×844; las
    teclas siguen en 87 px de alto a 360×640.
  - `prompt()` se llama una sola vez. "Ahora no" lo silencia 14 días y a
    los 15 vuelve.
  - Standalone (display-mode y `navigator.standalone`): nada.
  - iframe: inerte, sin CSS, sin pedidos al SW.
  - `file://`: solo el aviso, 0 pedidos de red.
  - Escritorio: botón fijo sin tapar el status.
  - iOS Safari (UA): hint de Compartir.
  - SW registrado y controlando; abre offline.
- **C2:**
  - Las líneas quitadas del diff que mencionan HOST, `zeroday_sync` o
    `registerInstrument` se reducen a la del `ctx` (latencyHint).
  - Son idénticos byte a byte con la base `c6ca6c2`: la detección del hub,
    el adaptador completo, el script vacío de `zeroday_sync`, el
    `if(!HOST) setInterval`, la salida a `C2_OUT` y `api.setState` vacío.
  - Hub falso de mismo origen: registra con el id del slot, toma el tempo,
    el probe da `worklet: blob`, `onTransport` y `onTick` mueven el
    arpegio, sin zd-audio, sin sesión guardada y con zd-pwa inerte.
- **Bloques:** `node tools/check-blocks.mjs` → 8 bloques, 2/5 idénticos,
  sin diferencias con `tools/blocks/`.

### Re-verificación 2026-10-04 (zd-mobile v4 y zd-midi v2)

Playwright 1.63 (Chromium), mismo servidor de `tools/tests/lib/serve.mjs`.
El script es una copia adaptada de `tools/tests/acid-verify.test.mjs`. Estuvo en
`reports/nebularp-verify.mjs`; la sesión D lo promovió a
`tools/tests/nebularp-verify.test.mjs` (`node tools/tests/nebularp-verify.test.mjs`
o `node tools/tests/run.mjs --only nebularp`; ver `docs/tests.md`). Los 17 casos pasan:

- **Viewports** 360×640, 390×844, 430×932, 768×1024 y 844×390 (táctil) y
  1440×900:
  - Shell donde corresponde, stage `[.hero, .octctl, .kbwrap]` y 5 tabs de
    54 px.
  - Barra de 48 px con todos sus controles de 44 px o más y sin recortes.
  - Teclas blancas de 49×128 px a 360×640 y de 53×201 px a 390×844.
  - Sin scroll horizontal, sin `#zd-rotate`, 0 `AudioContext` antes del
    primer gesto y 0 errores o warnings de consola.
- **Banner de zd-pwa** (`beforeinstallprompt` sintético) a 360×640 y
  390×844:
  - Mide 82 px y es el primer hijo del stage.
  - No se superpone con PLAY, REC, latch, tap, orbit, octava, piano, tabs
    ni barra.
  - Ninguna tecla queda debajo de las tabs: miden 87 px a 360×640 y 176 px a
    390×844.
  - "Ahora no" lo descarta.
- **Autoguardado** a 390×844, desde los sheets:
  - 5 knobs (Gate, Ratchet, Swing, Cutoff y Detune, que también mueve
    Spread) + patrón Chord + octava + latch con acorde → recargar → los
    mismos valores de los knobs, `aria-pressed`, octava y acorde (`C5 E5`).
  - Envoltorio `nebularp-2035` v1, toast "Sesión restaurada", 0
    `AudioContext` al restaurar y PLAY en false.
- **JSON** (escritorio):
  - `nebularp-YYYYMMDD-HHmm.json` con el envoltorio, `gate: 1.5` y
    `ratchet: 1`.
  - Ida y vuelta: con Gate y Ratchet en el mínimo, abrir ese JSON los devuelve
    a 150 % y 100 %.
  - Un JSON de `acid-bass-303` sale en un modal: "Ese JSON es de otro
    instrumento".
- **MIDI** (parseado como SMF con `tools/tests/lib/smf.mjs`, 0 defectos en
  todos los casos: ningún off después de un on del mismo tick, sin solapes,
  sin notas colgadas, sin duración cero y sin off huérfanos):
  - **Gate 150 % y ratchet 100 %**, acorde de 3 notas, toma de 4 s: formato
    0, 96 ppq, 92 bpm (el del knob), track `ZERO DAY NEBULARP 2035`. Salen
    37 notas con 31 repeticiones de la misma altura y el hueco mínimo entre
    ellas es de 1 tick (los 1,5 ticks de `endTake()`, redondeados).
  - **Chord** con gate 150 %: 42 notas.
  - **Pad** con el transporte parado: 2 notas. La tecla que sigue apretada
    al cortar cierra justo en el End of Track (tick 164 de 164).
  - **Autoplay**: 10 notas.
  - **`ZD.midi.write` embebido** con el caso de prueba de la doc de v2:
    `00 90 3c 64 · 30 80 3c 00 · 00 90 3c 64 · 30 80 3c 00`.
- **REC → WAV**, la misma toma de 4 s: RIFF/WAVE, PCM de 16 bits, estéreo, a
  44,1 kHz (igual que el contexto), 4,05 s y pico de 0,344 (no está en
  silencio).
- **Audio** a 390×844:
  - 1 contexto con `latencyHint: 'interactive'`, `running` después del
    primer toque y `ZD.audio.unlocked`.
  - El arpegio programa voces (12 → 20 → 28 `start()`).
  - `suspend()` → overlay "Tocá para reanudar" → toque → `running`, y el
    arpegio sigue.
  - `suspend()` + `visibilitychange` → `running`.
  - Con el transporte parado, `suspend()` no muestra el overlay.
- **Rotación de tablet con el arpegio sonando:** 1180×820 ↔ 820×1180, 4
  vueltas (8 rotaciones):
  - El contexto sigue en `running` (`currentTime` 0,86 → 3,74 s), el
    transporte en play y el contador de voces sube en cada rotación (64 en
    total).
  - La órbita recorre G4, C5, E5, G5 y E4, y el acorde del latch
    (`C4 E4 G4`) sobrevive.
  - Shell solo a 820 de ancho, con el stage armado en cada entrada y vacío
    afuera; PLAY ≥44 y piano visibles; sin scroll horizontal ni errores.
- **`file://`:** sin SW, aviso local con link al canonical, 0 pedidos de
  red, el aviso no tapa PLAY, piano ni octava, 0 errores.
- **Hosted:** un solo SW (`/sw.js`, scope de la raíz),
  `manifests/nebularp.webmanifest`, `theme-color #9a8cff` y canonical
  absoluto.
- **iframe de 360 px:** zd-pwa inerte (sin banner, sin CSS, sin SW), shell
  activo, el audio llega a `running` al tocar PLAY y 0 errores.
