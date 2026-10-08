# Tests · `tools/tests/`

Todo corre con `node:test` (formato TAP). Los que abren un navegador necesitan
Playwright + Chromium:

```
npm i -D playwright && npx playwright install chromium
```

## Cómo correrlos

```
node tools/tests/run.mjs                    # todo, un archivo por vez; exit 1 si alguno falla
node tools/tests/run.mjs --quick            # modo corto: sin los *-verify (alias: --corto)
node tools/tests/run.mjs --only cronbeat    # solo los archivos cuyo nombre contiene el texto
node tools/tests/<archivo>.test.mjs         # uno solo
node tools/tests/cronbeat-verify.test.mjs --shots <carpeta>   # además guarda capturas (cronbeat y j4)
```

Orden de uso:

- **Después de tocar un bloque o sincronizarlo:** `--quick` (unos segundos a
  pocos minutos) y `node tools/check-blocks.mjs`.
- **Antes de entregar o de subir `sw.js`:** la corrida completa. Cada
  `*-verify` tarda alrededor de un minuto (CronBeat: ~50 s); la completa, unos
  10 minutos.
- Un solo instrumento: `node tools/tests/run.mjs --only nebularp` corre su
  `*-verify` (el nombre del archivo lleva el slug).

## Qué hay

| Archivo | Alcance | Navegador |
|---|---|---|
| `zd-midi-order.test.mjs` | Orden de eventos a igual tick en `ZD.midi.write()` y `recorder()`; MIDI del patrón de Acid parseado como SMF. | no |
| `zd-rec-limit.test.mjs` | Corte por `maxSec` de `zd-rec` sobre la copia canónica del bloque. | sí |
| `zd-rec-instruments.test.mjs` | El mismo tope en Nebularp, J4 y MonoMoon publicados. | sí |
| `zd-ui-prompt.test.mjs` | `ZD.modal.prompt` con valor inicial, en el bloque y en los 5. | sí |
| `zd-audio-resumed.test.mjs` | Cuántas veces corre `onResumed` de `zd-audio`. | sí |
| `zd-pwa-choice.test.mjs` | Banner, ↓ y menú tras `userChoice` / `appinstalled` (`zd-pwa` v3). | sí |
| `zd-mobile-cycle.test.mjs` | Conformidad de `zd-mobile` para cualquier instrumento (`--file`, `--cycles`): ciclo salir/entrar, eventos, foco, scroll, banner, controles de la barra superior ≥44 px y el ✕ de la cabecera de los sheets de 44×44 (v6). | sí |
| `zd-mobile-rail.test.mjs` | Carril de scroll lateral de `zd-mobile` v5 en los sheets de los 5 (`--file` para uno): ≥32 px sin controles, indicador, swipe vertical real (CDP) que scrollea sin cambiar ningún valor, también en *peek*; y, contra la geometría de v4, ningún control pierde alto ni una grilla columnas, sin scroll horizontal nuevo, a 360×640, 390×844, 768×1024 y 844×390. | sí |
| `acid-first-key.test.mjs` | Acid: el primer toque de una tecla no deja una nota colgada y arma un solo `AudioContext` (E1). | sí |
| `first-hit.test.mjs` | CB, NB, MM, J4: con el audio sin destrabar o suspendido el golpe espera al destrabe; corriendo, sale en el `pointerdown` (iOS emulado, E1). | sí |
| `pc-keys.test.mjs` | Los 5: los atajos del teclado de PC no le roban teclas a knobs, botones ni modales (E1). | sí |
| `logo-once.test.mjs` | El logo en base64 va una sola vez y se ve en todos sus lugares, en http y `file://` (E1). | sí |
| `zd-rec-comments.test.mjs` | Ningún instrumento dice que `zd-rec` descarta la toma del tope (E1). | no |
| `favicon.test.mjs` | Favicon inline (PNG 32×32, color de acento) en los 5, en http y `file://` (E1). | sí |
| `monomoon-midi.test.mjs` | MonoMoon pide Web MIDI con el botón «Conectar MIDI», no al cargar; sin Web MIDI y con hub C2 (E1). | sí |
| `monomoon-xypad-a11y.test.mjs` | MonoMoon: el pad XY sin `aria-valuetext`, con el valor descrito y anunciado (E1). | sí |
| `landing-probar.test.mjs` | Las 5 landings: «▶ Probar ahora» → archivo de `descargables/` (misma pestaña); «DESCARGAR GRATIS» y «Probar ahora» visibles sin scroll y ≥44 px a 360×640 y 1440×900; header sticky en una fila; «Probalo acá» intacto; sin `<a>` anidados. | sí |
| `index-cards.test.mjs` | Índice: cada card con «▶ Probar» (HTML) y el link al manual (landing), sin `<a>` anidados en las 8 páginas del sitio; 44 px; clics y Tab; el hero no cambia. | sí |
| `install-info.test.mjs` | «Instalar en la computadora y en el teléfono»: tabla del índice, resumen en las 5 landings, FAQ; los textos «↓ Instalar» y «Compartir → Agregar a inicio» existen en `zd-pwa` y en los 5 instrumentos; header en una fila de 320 a 1440 px. | sí |
| `pwa-scopes.test.mjs` | Los 5 manifests se instalan por separado (Node puro): `id` distintos, `scope` declarado y propio (su archivo), `start_url` dentro de su scope y fuera de los otros 4, ningún scope prefijo de otro, y el `theme_color` igual al `<meta name="theme-color">` de su HTML. Las URLs se resuelven contra `manifests/` como lo hace el navegador. Falla si vuelve el `"scope": "../"` compartido (lo comprueba con manifests armados a mano). | no |
| `acid-verify.test.mjs` | Verificación completa de Acid Bass-303 (el piloto). | sí |
| `acid-svf.test.mjs` | Acid: el SVF acota el corte a 0,45 × sampleRate (F2e). En Node, el código de antes y el de ahora en la grilla del barrido de F2d (945 tomas): idénticos muestra a muestra a 44,1, 48, 88,2 y 96 kHz; a 32 kHz cambian solo las tomas con el corte sobre 14,4 kHz; a 22,05 y 32 kHz, finitos. En el navegador, los dos SVF lado a lado en el instrumento con el secuenciador sonando (0 muestras distintas a 44,1 y 48 kHz) y la grilla a 22,05 y 32 kHz sin NaN. 3 casos (~1 min). | sí |
| `cronbeat-verify.test.mjs` | Verificación completa de CronBeat-8:08: 24 casos (R1–R5, C2 simulado, extras). | sí |
| `cronbeat-sheet-sliders.test.mjs` | CronBeat: sliders de los sheets en el teléfono, con toques reales por CDP. En PADS, SEQ, FX, SAMPLE y CANCIÓN un swipe vertical que arranca en la pista o en la perilla scrollea sin cambiar nada; tocar la pista no salta el valor y lo enfoca; arrastre horizontal relativo y proporcional (perilla, pista, <10 px no mueve, matriz con recorrido mínimo de 160 px) que llega al estado, al JSON y al autoguardado; ← → Inicio Fin después del toque; doble toque en el PAN de la mezcla = 0; controles ≥44 px y sin scroll horizontal a 360×640, 390×844, 768×1024 y 844×390. 6 casos. | sí |
| `zd-sheet-input.test.mjs` | Bloque `zd-sheet-input` (sliders de los sheets) en Acid, Nebularp, MonoMoon y J4, con toques reales por CDP a 360×640: en cada sheet con sliders (primero, del medio y último) un swipe vertical que arranca en la pista o en la perilla scrollea y no cambia ningún valor del documento; tocar la pista no salta el valor y lo enfoca; arrastre horizontal relativo y proporcional desde la perilla y desde la pista (<10 px desde la pista no mueve), que el knob de la fila sigue; ← → después del toque; el valor arrastrado sobrevive a recargar. Además: los 5 tienen el bloque, CronBeat sin `bindSheetSliders()` y, en todos los sheets, cada slider sin punteros con su contenedor `pan-y`. `--file` para uno. 9 casos (~4 min). | sí |
| `sheet-knobs.test.mjs` | Knobs de los sheets en Acid, Nebularp, MonoMoon y J4 (F3, decisión A), con toques reales por CDP a 360×640: en cada sheet con knobs (primero, del medio y último) un swipe vertical que arranca sobre el knob scrollea y no cambia ningún valor; un toque no cambia nada; en diagonal o scrollea o ajusta, nunca las dos cosas, y si arranca de costado y sigue en vertical el valor vuelve; arrastre horizontal relativo con la sensibilidad de cada uno (Acid y Nebularp 180 px, MonoMoon 240, J4 200) que el slider de la fila sigue y que se autoguarda; doble toque = valor por defecto, long-press = entrada numérica, `role="slider"` y teclado (Fin, Inicio, → ←, Enter) sin cambios. Fuera de los sheets (macros de MonoMoon, BPM de Nebularp) y en el escritorio (mouse), arrastre vertical como antes. `--file` para uno. 17 casos (~3 min). | sí |
| `sheets-layout.test.mjs` | Los sheets de los 5 a 360×640, 390×844, 768×1024 y 844×390: sin scroll horizontal (en el sheet ni en la página) y ningún control <44 px adentro de los panes (acepta la grilla de 8 de SPEC R1). Lo que ya medía menos antes de F3 está listado en `KNOWN` por pestaña y nombre: se imprime y no falla; una entrada de `KNOWN` que ya no aparece hace fallar el test. `--file` para uno. 5 casos (~1 min). | sí |
| `monomoon-verify.test.mjs` | Verificación completa de MonoMoon'70: 23 casos. | sí |
| `monomoon-ladder.test.mjs` | MonoMoon: el filtro `moog-ladder` no da NaN (F2d) y, con la realimentación saturada (F2e), su estado queda acotado. Con Mod → Filtro y el Osc3 a frecuencia de audio (24 configuraciones de RESO, Osc3, rueda Mod y sampleRate) y en un fuzz determinista de 60 s: salida y filtro finitos y después «Bajo gordo» suena; el ladder de antes de F2d y el de ahora lado a lado dentro del worklet en los 7 presets, la condición dirigida de F2d y el fuzz: la guarda se activa 0 veces y \|out4\| queda bajo la cota demostrable; en Node, 1500 tomas: lo mismo, y con RESO 0 la misma salida bit a bit que con el de F2d. 4 casos (~3 min). | sí |
| `nebularp-verify.test.mjs` | Verificación completa de Nebularp 2035: 17 casos (incluye la rotación de tablet). | sí |
| `j4-verify.test.mjs` | Verificación completa de J4-Sirens Station: 18 casos. | sí |
| `j4-mute.test.mjs` | J4: MUTE (silencia la salida mientras se mantiene y deja las colas) y BURNOUT (silencio total; vacía el eco y la reverb): nivel de salida medido por bloque con un AudioWorklet, nada deja un MUTE colgado, REC, hub C2 falso, botones en 4 viewports y, con el mute apagado, la misma salida que el commit base. 15 casos. | sí |
| `j4-reposo.test.mjs` | J4 en reposo: patch de fábrica, encender y 30 s sin tocar nada da < −80 dBFS RMS (antes el VCA quedaba en 0,0001, la fuga cebaba el lazo del eco y subía a −14). El release sin clics: una sonda repite la automatización de `vca.gain` y la graba muestra a muestra (mayor escalón < −120 dB, 0 exacto al final; en la salida < −100 dBFS con DRIVE 8), con el commit base de control (el salto de Chromium a las 10 τ); una nota durante el release no queda cortada; con una nota suena igual que el commit base, seco y con eco + reverb (render repetible: semilla, fuentes alineadas a un frame y la nota en frames fijos; RMS del sostenido y del release Δ ≤ 0,05 dB y la forma de onda muestra a muestra). 6 casos. | sí |
| `j4-cola.test.mjs` | J4: el eco se calla solo (F2c, techo de la ganancia del lazo del eco). El patch de fábrica y los 6 presets, tal cual, con la perilla FEEDBACK al máximo y con la perilla al máximo y TIME 2 s: SIREN 1 s y soltar baja de −60 dBFS RMS antes de los 30 s y sin crecer; el techo en el grafo (12 posiciones de la perilla, extremos de SAT, TONE y TIME) y medido con una semilla como en F2b; más perilla = cola más larga; ∞ como en el commit base; con feedback bajo las repeticiones no cambian (±0,5 dB); los valores guardados mantienen el formato y se leen con la escala nueva. 7 casos (~8 min). | sí |
| `j4-ladder.test.mjs` | J4: el filtro ladder no da NaN (F2d). Acid Scream, 52 tomas de SIREN a 44,1 kHz: salida finita, cada toma suena y después Police Alarm suena; la guarda medida desde afuera (activaciones, el filtro vuelve en < 50 ms); barrido determinista de CUTOFF, RESO y DRIVE en los 7 patches a 44,1 y 48 kHz; el ladder de antes y el de ahora lado a lado dentro del worklet (iguales bit a bit hasta la primera activación, que solo cae donde el de antes divergía) y lo mismo en Node con 1200 tomas como las de J4. 5 casos (~4 min). | sí |

Los `*-verify` comparten el molde de `acid-verify`: viewports de SPEC R1
(360×640, 390×844, 430×932, 768×1024, 844×390, desktop), banner de instalación
con `beforeinstallprompt` sintético, standalone, iframe, `file://` y registro
del service worker sobre http, autoguardado y migración, exportación
JSON/MIDI/WAV (MIDI parseado con `lib/smf.mjs`), audio con wake lock y
suspend/resume, rotación de tablet sonando y un hub C2 simulado con el diff del
adaptador C2. Cada instrumento suma lo propio (ver el encabezado de su archivo).

Los helpers están en `tools/tests/lib/` (`serve.mjs`: servidor estático bajo
`/instruments/` como GitHub Pages; `load-block.mjs`, `block-page.mjs`, `smf.mjs`,
`acid-midi.mjs`, `anchors.mjs`: cuenta `<a>` anidados sobre el HTML generado;
`sheet.mjs`: abrir un instrumento con toques, pasar la pantalla de encendido,
abrir una pestaña y la huella de todos los valores del documento;
`touch.mjs`: swipes, arrastres y toques de verdad por CDP
—`Input.dispatchTouchEvent`—, que pasan por `touch-action`, el scroll nativo y
el `pointercancel` de Chromium; `page.touchscreen.tap()` no sirve para medir si
un swipe scrollea).

## Notas

- Los `*-verify` de CronBeat y J4 comparan el adaptador C2 contra el commit
  `8bef265` con `git diff`, así que necesitan el historial completo (no sirven
  con un clon superficial).
- `j4-mute` compara el adaptador C2 y el nivel de salida contra `3aceb34`
  (main antes del mute) con `git show`; sin ese commit se saltean esas dos
  comparaciones y el resto corre igual.
- `j4-reposo` usa `224763d` (main antes del VCA en 0) de control, con
  `git show`; sin ese commit se saltea el control y el resto corre igual.
- `j4-cola` compara ∞, el feedback bajo y el formato de lo que se guarda contra
  `27707d5` (main antes del techo del eco); sin ese commit se saltean esas partes.
- `j4-ladder` y `monomoon-ladder` toman el ladder de antes de `22fb1d2` (main
  antes de las guardas) con `git show`, y `monomoon-ladder` además el de
  `70a916a` (con la guarda de F2d, antes de la realimentación saturada); sin
  esos commits se saltean los casos 3 y 4.
- Chromium headless arranca todo `AudioContext` en `running`: lo que depende de
  la política de gestos de iOS se **emula** y **no reemplaza** la prueba en un
  iPhone (ver `docs/QA-dispositivos.md`). `first-hit` envuelve el
  `AudioContext` para que nazca suspendido y solo reanude con activación
  transitoria (pointerup táctil, touchend, click, keydown, mousedown).
- `reports/D1-barrido-verify.mjs` no es un test: mide (no falla) los puntos b y
  c de `reports/D1-barrido.md`, cuyos números de línea son de un commit
  concreto. Por eso sigue en `reports/`.
- Un test de la corrida completa puede fallar por carga de la máquina sin que
  haya un bug (por ejemplo la rotación de Nebularp: ver `reports/D1-logs/LEEME.md`).
  Antes de culpar al código, correrlo solo con `--only`.
- Los casos de rotación de tablet esperan, tras cambiar el viewport, un tiempo
  fijo (`waitForTimeout`) en `acid-verify` (220 ms), `monomoon-verify` (220),
  `cronbeat-verify` (240) y `nebularp-verify` (350): son los candidatos a
  fallar por carga. `j4-verify` ya no: espera a que `ZD.mobile.active` llegue al
  estado pedido (más dos rAF), como `settle()` de `zd-mobile-cycle`. Se
  corrobora corriendo el caso solo, 10 veces seguidas
  (`node --test --test-name-pattern="rotación de tablet" tools/tests/j4-verify.test.mjs`).
- `acid-svf` toma el worklet de antes de `70a916a` (main antes del tope) con
  `git show`; sin ese commit se saltean los casos 1 y 2.
