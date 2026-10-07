# MONOMOON'70 — reporte de la sesión C

Rama `c-monomoon` · 2026-10-04 · archivo: `descargables/MonoMoon70.html`
(slug `monomoon`). Base: `main` en `8bef265`.

R1 a R7 quedaron hechos. Los 8 bloques ZD están pegados byte a byte desde
`tools/blocks/` (zd-mobile v4, zd-midi v2: los dos bugs conocidos ya venían
arreglados, no hizo falta ningún workaround para ellos). El adaptador C2 no
cambió. Todo se verificó en **Chromium (Playwright 1.63)**. Nada se probó en un
dispositivo real ni en WebKit o Firefox (sección 6). Lighthouse no corrió.

| Test | Resultado |
| --- | --- |
| `node tools/tests/monomoon-verify.test.mjs` (propio, 23 casos) | 23 de 23 |
| `node tools/tests/zd-mobile-cycle.test.mjs --file descargables/MonoMoon70.html --cycles 4` | 7 de 7 |
| `node tools/tests/run.mjs` (zd-midi-order, zd-mobile-cycle y acid-verify sobre Acid) | 3 de 3 archivos |
| `node tools/check-blocks.mjs` / `node tools/sync-blocks.mjs --check` | sin diferencias / MonoMoon al día |

Hay dos pedidos de cambio a bloques, ninguno bloqueante:
[`monomoon-block-request.md`](monomoon-block-request.md).

---

## 1 · Flags para el sitio (los aplica D en `data/instrumentos.json`)

```json
"exporta": ["WAV", "MIDI", "JSON"],
"guarda": true,
"app": true
```

| Flag | Valor | Mecanismo |
| --- | --- | --- |
| `exporta` | WAV, MIDI, JSON | **WAV**: `● REC` graba la salida en vivo (zd-rec), PCM 16-bit estéreo a la frecuencia real del contexto, tope de 10 min, tarjeta con escuchar y `↓ DESCARGAR WAV`. **MIDI**: la performance de la misma toma (notas, pitch bend de la rueda, CC1 de la rueda Mod, CC74/CC71 de corte y énfasis). **JSON**: patch en edición + biblioteca, `{app:'monomoon-70', version:1, savedAt, data}`, import validado (también lee el JSON de un patch de la versión anterior). |
| `guarda` | sí | zd-store, IndexedDB `zd-sessions` con fallback a `localStorage`. `zd:monomoon:session` = patch en edición (debounce de 1,5 s + `visibilitychange`/`pagehide`); `zd:monomoon-lib:session` = biblioteca. Restaura sin arrancar el audio. La biblioteca de la DB vieja `hackwave-minimoog` se migra sola la primera vez y la vieja queda intacta. |
| `app` | sí | `<link rel="manifest" href="../manifests/monomoon.webmanifest">`, `theme-color #f2a63c` (igual al manifest), apple-touch-icon, `apple-mobile-web-app-title` "MonoMoon", canonical y zd-pwa v2. Se instala **desde la web**; en `file://` solo aparece el aviso con el link a la versión web. |

Para D:

- **Copy del MIDI**: igual que en Nebularp, el MIDI sale de lo que se graba
  con REC (no es un patrón). Sugiero "MIDI de lo que tocás".
- **Copy de la marca**: "MonoMoon'70", con "estilo Minimoog" solo como
  descripción (así quedó la `<meta name="description">`).
- **`sw.js`**: MonoMoon ya está en la lista de precache, pero el HTML cambió:
  hay que subir `VERSION` al publicar.
- El ZIP y `data/instrumentos.json` no los toqué.

---

## 2 · Mapa (Paso 0)

- **Motor (`SynthEngine`).** 3 osciladores band-limited (`PeriodicWave` por
  rango de armónicos) + 6 voces de unison → mezclador (con ruido blanco/rosa)
  → filtro escalera de 4 polos en AudioWorklet (`tanh` a la salida; fallback de
  2 biquads) → VCA → `master` (volumen) → WaveShaper `tanh` suave → DC-block
  (highpass de 16 Hz) → `analyser` → `C2_OUT || destination`. Dos contornos
  ADSR (amplitud y filtro, este por un `ConstantSource` sumado al corte en
  cents). Bend: `ConstantSource` → `detune` (±200 ¢).
- **`engine.state`.** `osc[3]{wave,foot,detune,level,on,kbd}`,
  `noise{type,level,on}`, `filter{cutoff,res,track}`, `env`, `filtEnv`,
  `contour`, `mod{mix,osc,filt,wheel}`, `voiceMode`, `unison.detune`,
  `master{vol,tune}`, `glide{on,time}`, `trigger`. La octava del teclado
  (`baseOctave`) vive afuera del estado.
- **Matriz de modulación.** Osc3 (1−mix) + ruido (mix) → `modWheelGain` (la
  rueda Mod) → pitch de osc1/2 (400 ¢) y corte del filtro (4200 ¢).
- **Teclado y ruedas.** Teclas absolutas en %, `kbd` multi-fuente (puntero,
  teclado de PC, MIDI) con contador por nota, glissando por `elementFromPoint`
  con captura del puntero. `Wheel` para Pitch (vuelve al centro) y Mod.
- **Biblioteca.** IndexedDB `hackwave-minimoog`, store `patches` (keyPath
  `name`), registros `{name, data:{app,version:4,name,octave,state}, ts}`.
  7 presets en código.
- **MIDI de entrada.** `requestMIDIAccess` → `onMIDI` (note on/off, bend,
  CC1, CC123). Dentro del hub: "MIDI ← C2" y el hub reenvía a `onMIDI`.
- **Shell.** v1 landscape con `#zd-rotate` y `window.ZD_M` v1.

**Riesgos que salieron del mapa** (los resultados, en la sección 4):

- Sin limitador.
- Migración de la DB con datos de usuario.
- Teclado de 340 px contra las ruedas a 360 px.
- El `keydown` global tocaría notas mientras se escribe en un modal.
- El overlay de encendido queda por encima del shell.
- `startAudioThen` descartaba lo que pedía audio mientras el motor
  arrancaba.
- El visualizador dibujaba a 60 fps aunque no se viera.

---

## 3 · Commits y decisiones

| Commit | Qué |
| --- | --- |
| `f9f0838` | Bloques ZD pegados idénticos, `window.ZD_M` v2 y fuera el shell v1 con `#zd-rotate` |
| `6d6896c` | R1: layout portrait-first |
| `5e4bcdc` | R3: autoguardado del patch y de la biblioteca, con migración |
| `0720bef` | R4: JSON completo, MIDI de performance y REC → resultado → WAV |
| `517faa9` | R5: zd-audio, arranque dentro del gesto, wake lock e indicador de clip |
| `ee5b279` | R6: diálogos a zd-ui, accesibilidad y robustez |
| `2761297` | R2: manifest estático, canonical, theme-color y zd-pwa v2 |
| `a0ec227` | R7: copy y nombres |
| siguiente | `reports/` (este reporte, el pedido a bloques y `monomoon-verify.test.mjs`) |

El HTML pasó de 190 KB a 314 KB. ~90 KB son los 8 bloques; el resto es la
piel portrait y el código nuevo. ~80 KB del total siguen siendo el logo JPEG
en base64, que está **dos veces** (overlay y header); no lo toqué.

**Corrección al mensaje de `517faa9` (R5).** Dice que la salida llega a
1,27 FS con "Bajo gordo" a volumen 100. Esa medición se hizo cambiando de
patch con la cola del anterior sonando. Medido en limpio (página nueva, 3
repeticiones), "Bajo gordo" a volumen 100 da 0,79–0,93 FS y no recorta. Lo que
sí recorta es lo de la sección 4.1 (pulso angosto en registro grave). No
reescribí la historia.

### Decisiones

**`window.ZD_M`.** Conserva el nombre (SPEC 3.1.3) y pasó a la forma v2 del
piloto: `transport`, `keep`, `tabs`, `menu`. Las claves de la v1 (`title`,
`slots`, `place`, `menus`) las reemplazó la v2, igual que en Acid y Nebularp:
la v1 la leía solo el shell v1, que se fue. Solo hay selectores por id. La
carcasa lleva la clase `.wrap`, que es lo que esconde el shell.

**Layout (R1)**

- **Zona de tocar** (`keep`): `#macroPanel` → `#xyPanel` → `#kbPanel`.
  - Las macros no se encogen; el pad se queda con lo que sobra (mínimo 72 px).
  - El teclado toma `clamp(196px, 44%, 340px)` del alto (32 % en tablets).
  - El banner de zd-pwa va arriba y achica el pad, no lo tapa.
- **6 macros**: Cutoff, Reso, Env Amt, A/R, Glide, Volumen.
  - No agregan parámetros: manejan los mismos valores de los knobs de las
    secciones y se sincronizan en las dos direcciones.
  - **A/R** mueve juntos ataque y relajación de los **dos** contornos, de
    forma relativa: arrastrar suma el mismo desplazamiento a los 4 y conserva
    la relación entre ellos. Muestra los de amplitud ("6/400" en ms).
  - **Glide** en 0 = OFF (apaga el interruptor); arriba de 0 lo prende con
    ese tiempo.
- **Pad XY**: X = corte, Y = énfasis. Es lo mismo que mueven Cutoff/Reso y lo
  que graba el MIDI como CC74/CC71.
- **Teclado: decisión.** Dos octavas (24 semitonos), posicionadas solo por
  CSS: buildKeyboard pone `--i/--ri/--row` y nada más.
  - En escritorio y tablet, una fila de 14 blancas.
  - En el shell, cuando el teclado mide menos de 640 px de ancho (container
    query sobre `.keys`, acotada con `html.zd-m` adentro de `@container`),
    pasa a **dos filas de una octava, la grave abajo**.
  - Las ruedas Pitch/Mod quedan **verticales al costado**, como pide la SPEC.
  - El glissando funciona entre filas: `elementFromPoint` ya era genérico.
  - No elegí scroll horizontal: con `touch-action:none` en las teclas
    (necesario para el glissando) el scroll tendría que ir por botones, y
    eso ya lo hace la octava. Tampoco puse las ruedas sobre el teclado: la
    SPEC las pide al costado.
  - Medidas:

    | Viewport | Blancas | Ruedas |
    | --- | --- | --- |
    | 360×640 | 37×82 | 30×156 |
    | 390×844 | 41×127 | |
    | 430×932 | 47×137 | |
    | 768×1024 | 47×228 (una fila) | |
    | 844×390 | 53×110 (una fila) | |

  - A 360 px las blancas quedan en 37–38 px de ancho: es el caso que la SPEC
    acepta para la grilla de 8 pasos (38–40 px si el alto es ≥48). Las ruedas
    quedan en 30 px de ancho: es la concesión para que las teclas no bajen
    más. Ver riesgos.
- **Sheets** [Osc | Filtro | Mod | Voz | Patches].
  - Los 4 de sonido van en *peek*: el stage se achica por encima del sheet,
    se esconden macros y pad, y queda el teclado para tocar mientras se
    ajusta.
  - En landscape, el peek ocupa la mitad izquierda y el teclado sigue a la
    derecha.
  - Mod = Modulación + Controladores (glide, disparo): en el Minimoog el
    mix de modulación vive en "Controllers".
  - Voz = modo de voz + amplitud/salida + osciloscopio.
  - Patches = presets, biblioteca, JSON, la última toma de REC, MIDI de
    entrada y la ayuda del teclado de PC.
- **REC en la barra superior**, con su tiempo y el LED de CLIP. La tarjeta de
  la toma aparece en Patches y, en el shell, ese sheet se abre solo al cortar.
- **Knobs.**
  - Arrastre vertical, valor visible en todo momento.
  - Doble tap = valor de fábrica.
  - Long-press (o Enter/Espacio) = valor numérico en la unidad que se ve:
    "1.2k", "250" (ms) o "1.5s", "16'", "LO", %, ¢.
  - En los sheets, cada knob es una fila: knob · nombre · slider alternativo
    · valor.
- **Overlay "Pulsá para encender": se quedó.**
  - Es la identidad del instrumento y su primer toque es un `click`, o sea,
    un gesto que destraba el audio en iOS de forma confiable.
  - Ahora se opera con teclado.
  - Con zd-audio, cualquier gesto también lo enciende.
- **Tipografía.** Las 31 declaraciones de 8,5–10,5 px subieron a 11 px
  (etiquetas), 12 px (valores) y 13 px (notas en escritorio). Dentro de los
  sheets, el texto corrido va a 14 px. El test de viewports no encuentra
  ningún texto visible por debajo de 11 px.

**Estado y exportación (R3 y R4)**

- **Dos stores.** El patch en edición se apaga dentro del hub C2, como en el
  piloto (el host es el dueño del estado). La **biblioteca no**:
  - Hoy, dentro del hub, la biblioteca persiste (la DB vieja es del mismo
    origen) y el host no la maneja (`api.setState` está vacío).
  - Meterla en la sesión la habría vuelto volátil en C2.
  - Por eso va en `zd:monomoon-lib:session`, siempre activo.
- **Migración.** Es el hook `migrate` de zd-store sobre la biblioteca.
  - Abre `hackwave-minimoog` **sin versión**: si dispara `onupgradeneeded`
    es que no existía, y se aborta, así que no queda creada.
  - Lee `patches`, normaliza cada registro y lo guarda en el store nuevo.
  - Deja una marca en `localStorage` para que "borrar todo" no la vuelva a
    importar.
  - La DB vieja no se escribe nunca más y queda intacta esta versión. En la
    próxima se puede borrar.
- **Todo lo que entra de afuera** (sesión, DB vieja, JSON) pasa por
  `sanitizeState`/`normPatch`: rangos de los knobs, enums válidos, nombres
  en texto plano de 48 caracteres.
- **"Empezar de cero"** (toast de restauración, menú y panel de patches)
  abre un modal con dos niveles: SOLO EL PATCH (la biblioteca sigue) o BORRAR
  TAMBIÉN LA BIBLIOTECA. Perder la biblioteca por un toque era demasiado.
- **JSON.**
  - Exporta patch en edición + biblioteca.
  - El import exige el envoltorio y valida app y versión, con el error en un
    modal.
  - Acepta además el patch suelto de la versión anterior
    (`app:'hackwave-minimoog'`): la gente tiene esos archivos. La biblioteca
    importada se suma por nombre.
- **MIDI de performance.**
  - Notas on/off con la velocity del MIDI de entrada (100 en pantalla y en
    el teclado de PC).
  - Bend de la rueda (±2 st, igual que el motor), CC1 de la rueda Mod y
    CC74/CC71 de corte y énfasis (pad, macros o knobs).
  - Al empezar la toma se escriben los valores de arranque. Las notas que
    siguen apretadas cierran al cortar y el pánico cierra las abiertas.
  - **Tempo fijo de 120 bpm**: MonoMoon no tiene reloj, así que los tiempos
    son exactos en segundos y no caen en una grilla.
  - **El glide no se codifica como bend**: ±2 semitonos no alcanzan.
- **REC.**
  - Una sola toma da el WAV y el MIDI.
  - El grabador viejo (Float32 mono, `encodeWAV` propio, el processor
    `recorder` dentro del worklet del filtro) se fue: lo reemplaza el tap de
    zd-rec. Sacarlo del módulo del worklet no cambia el filtro.

**Audio (R5)**

- **Arranque.** `ensureAudio()` es una promesa compartida. El
  `AudioContext` se crea de forma sincrónica al principio de
  `engine.init()`, dentro del gesto. `latencyHint:'interactive'` ya estaba en
  la línea del ctx del adaptador C2, así que no la toqué.
- **zd-audio solo fuera del hub.**
- **"Sonando"**, para el wake lock y el overlay de reanudar: MonoMoon no tiene
  transporte. Cuenta mientras hay notas o REC y hasta 60 s después de la
  última nota. Así la pantalla no se apaga mientras se toca, pero tampoco
  queda prendida para siempre.
- **CLIP** (solo mide).
  - Se enciende si la salida que se escucha llega a 0,999 FS o si la entrada
    del WaveShaper pasa de ±1 (en el fallback biquad, que no tiene `tanh`).
  - El tap es un `AnalyserNode` colgado en paralelo de `master`: no cambia
    el sonido.
- **Visualizador.**
  - Medidor y osciloscopio no se dibujan si no se ven (en el shell viven en
    el sheet Voz), y los buffers se reutilizan.
  - Con `prefers-reduced-motion`, en vivo, el osciloscopio queda quieto.
- **MIDI.** "MIDI no disponible en este navegador" sale de
  `ZD.midi.support()`: se detecta, no se supone.

**Accesibilidad (R6)**

- Los 4 diálogos nativos pasaron a `ZD.modal`/`ZD.toast`. El prompt del
  nombre es un modal con input, avisa si reemplaza y no acepta nombres
  vacíos.
- **35 sliders** (knobs, macros, ruedas) con `ZD.ui.a11ySlider` sobre la
  fracción 0..1 (los logarítmicos avanzan parejo y los escalonados de a un
  paso).
  - Nombre único con la sección ("Amplitud · Ataque" / "Contorno de filtro
    · Ataque") y valor en su unidad.
  - La rueda de pitch vuelve al centro al soltar la tecla.
- **Teclas**: `role=button` con nombre de nota ("Do sostenido 4") y
  `aria-pressed`.
- **Interruptores**: `role=switch`.
- **Segmentos y botones de onda**: `aria-pressed`.
- **El teclado de PC** no toca notas mientras se escribe o con un modal
  abierto, y Espacio sobre un botón aprieta el botón (en el resto de la
  página sigue siendo pánico).
- **`innerHTML`**: quedan 5 (puntero del knob, ruedas, SVG de las ondas,
  plantillas de oscilador y mezclador) y todos llevan literales o enums. Los
  nombres de patch, de archivo y los datos importados van siempre por
  `textContent`: se probó con `<script>` y `<img onerror>` en los nombres.

**PWA y marca (R2, R7)**

- El `<head>` lleva:
  - manifest estático (afuera el `data:` con "HACKWAVE Minimoog" y
    `orientation: landscape`);
  - apple-touch-icon;
  - canonical;
  - `theme-color #f2a63c` (antes `#070b06`, distinto del manifest);
  - `apple-mobile-web-app-title` "MonoMoon" y `status-bar-style` "black",
    como el piloto.
- El `beforeinstallprompt` propio y su `#btnInstall` se fueron: la oferta la
  hace zd-pwa.
- Marca:
  - "Synthetizer" pasó a "Synthesizer", y ↓/↑ reemplazan a ⭳/⭱, que salían
    como tofu.
  - "hackwave-minimoog" queda solo como nombre de la DB vieja y del formato
    de JSON viejo.

---

## 4 · Riesgos

### 4.1 Clipping y propuesta de limitador (NO aplicada: cambia el sonido)

Medido en Chromium, página nueva por caso, frase de 3 notas, 3 repeticiones:

| Patch | Entrada del WaveShaper | Salida | CLIP |
| --- | --- | --- | --- |
| fábrica, volumen 30 (por defecto) | 0,21 | 0,33 | no |
| fábrica, volumen 100 | 0,70 | 0,87 | no |
| "Bajo gordo", volumen 100, octava 1 | 0,48–0,55 | 0,79–0,93 | no |
| "Resonante zumbón" + unison, énfasis 100, volumen 100 | 0,81–0,92 | 0,94–0,97 | no |
| pulso angosto ×3 + unison + ruido, corte 18k, volumen 100, oct. 1 | 0,96–0,99 | **1,60–1,63** | sí |
| pulso angosto en 32', corte 18k, volumen 100, oct. 0 | 0,62–0,63 | **1,65–1,72** | sí |
| el mismo, volumen 30 | 0,19 | 0,56 | no |

**De dónde sale.** Con el worklet, la cadena hasta el WaveShaper está acotada:
el filtro termina en `tanh`, y VCA y volumen son ≤1. El WaveShaper es otra
`tanh` acotada a ±1. Lo que recorta es el **DC-block que va después**: un
highpass de 16 Hz con el Q por defecto. En notas graves y formas muy
asimétricas (pulso angosto) su desfase infla el pico de una onda que ya
venía saturada, hasta 1,7 FS. Ese exceso se recorta en la salida del sistema y
en el WAV (zd-rec acota a ±1). También hay transitorios si se cambia de patch
con una cola sonando (medí 1,23 FS). En el fallback biquad no hay `tanh`: el
énfasis alto puede pasar de ±1 antes del WaveShaper, que lo recorta duro. El
LED de CLIP mide los dos puntos.

**Propuesta: "ceiling" transparente invirtiendo el orden de las dos últimas
etapas.** Hoy es `master → shaper → dcBlock → analyser`; pasaría a
`master → dcBlock → shaper → analyser`.

- El `tanh` suave pasa a ser la última etapa y su salida nunca supera ±1, así
  que el clipping digital se vuelve imposible.
- No suma latencia ni nodos.
- Con señal chica la `tanh` es casi lineal y el orden casi no se nota. A
  volumen 30 (por defecto) los picos quedan muy por debajo de la zona curva,
  así que el cambio solo se oye en los extremos, que es justo donde hoy
  recorta.
- Costo: a drive extremo la `tanh` sobre una onda asimétrica puede dejar algo
  de DC residual (chico; se puede medir antes de aprobar).
- Es un cambio de una línea en `engine.init()`:
  `this.master.connect(this.dcBlock); this.dcBlock.connect(this.shaper); this.shaper.connect(this.analyser);`.
  La línea que menciona `C2_OUT` (`this.analyser.connect(C2_OUT || ctx.destination)`)
  no se toca.

**Por qué no un `DynamicsCompressorNode` como limitador**, que es lo que
propuso Nebularp:

- No es transparente: el nodo aplica *makeup gain* automática (con
  threshold −1 dB y ratio 20, ≈ +0,6 dB a todo) y puede volver a pasar de 0
  dBFS.
- No es un brickwall.
- En Chromium tiene ~6 ms de lookahead, que se suman a la latencia de un
  instrumento que se toca en vivo.

Si se prefiere no tocar el orden, la alternativa es un brickwall en
AudioWorklet al final. Es más código y otra etapa nueva en el motor, para
llegar a lo mismo.

### 4.2 Otros riesgos

- **Teclado a 360 px.** Las blancas miden ~37,5 px de ancho y las ruedas 30
  px, debajo de los 44 px de SPEC R1 en el eje corto. Es el compromiso de
  tener 2 octavas, ruedas al costado y teclas de ≥80 px de alto. A partir de
  390 px las blancas miden 41 px y desde 430 px, 47 px. Si en el dispositivo
  se sienten chicas, la palanca más barata es esconder la rueda Mod en
  pantallas <380 px (queda en el MIDI CC1 y en el sheet Mod como knob de
  "Osc3 · Ruido"). No lo hice porque la SPEC pide las dos ruedas.
- **Primer toque en iOS.** El overlay de encendido se toca con `click`, que
  sí destraba. Pero si alguien toca una tecla antes, por un camino que no
  pase por el overlay (MIDI, por ejemplo), en táctil el `pointerdown` no
  cuenta como gesto y el contexto queda suspendido hasta el `pointerup`/`touchend`
  (bindGesture). La primera nota puede salir muda o empezar tarde.
- **Biblioteca en dos pestañas.** Si el instrumento está abierto a la vez
  standalone y dentro del hub, gana el último que guarda la biblioteca entera.
  Antes se escribía registro por registro. Es un caso borde; si molesta, se
  puede releer y fusionar antes de cada `saveNow()`.
- **Migración sin `localStorage`.** La marca que evita reimportar la DB vieja
  después de "borrar todo" vive en `localStorage`. Si no hay `localStorage`
  (algunos modos privados), "borrar todo" + recargar vuelve a traer los
  patches viejos. No se pierde nada, pero puede sorprender.
- **MIDI sin grilla.** Las tomas llevan 120 bpm fijos: en un DAW con otro
  tempo hay que cuantizar o conformar el tempo.
- **Tamaño.** 314 KB; ~80 KB son el logo en base64 duplicado.
- **Wake lock de 60 s.** Si se deja el instrumento sonando con una nota
  sostenida por un controlador MIDI que se cuelga, la pantalla queda prendida
  (hay notas abiertas). Pánico con Espacio o el CC123 la sueltan.
- **NaN en el filtro con Mod → Filtro** (encontrado y arreglado el 2026-10-06,
  [`F2d-monomoon.md`](F2d-monomoon.md)). Con Mod → Filtro y el Osc3 a
  frecuencia de audio, el estado del `moog-ladder` crecía hasta NaN y MonoMoon
  quedaba mudo hasta recargar: era el «colapsa y se reinicia». Ahora el filtro
  se reinicia si su estado deja de ser finito. El crecimiento previo (la salida
  saturada, el «colapso») sigue, sin arreglar.

---

## 5 · Hallazgos que aplican a los otros instrumentos

1. **`zd-rec` y el tope** (pedido 1): si `onLimit` solo avisa, la toma de 10
   min se pierde. Hasta que se arregle el bloque, Nebularp y J4 tienen que
   llamar a `rec.stop()` *dentro* de `onLimit`, como hace MonoMoon.
2. **`zd-pwa`** (pedido 2): después de `prompt()` el banner sigue visible.
   Pasa en los 5.
3. **Medir el pico después del último nodo.** En MonoMoon, lo que recorta es
   un highpass (DC-block) que va *después* del saturador, no el saturador. Si
   otro instrumento tiene un filtro después de su `tanh`/WaveShaper, el
   indicador de clip tiene que mirar la salida real.
4. **`DynamicsCompressorNode` no es un limitador transparente** (makeup gain
   automática y lookahead). Para un ceiling, mejor que la última etapa sea una
   no linealidad acotada.
5. **Leer una IndexedDB vieja sin crearla.** Hay que abrirla sin versión y
   abortar `onupgradeneeded`. Sirve para cualquier migración.
6. **Datos de usuario que no son "la sesión"** (bibliotecas, bancos) conviene
   guardarlos en un store aparte que siga activo dentro del hub C2, si el host
   no los maneja.
7. **Nombres accesibles únicos.** Con `a11ySlider`, las etiquetas cortas se
   repiten ("Ataque" ×2, "Nivel" ×4): conviene prefijar la sección.
8. **Teclado de PC global.** Hay que ignorarlo si hay un `.zd-scrim` (modal
   de zd-ui) o el foco está en un input, y respetar `defaultPrevented`
   (CronBeat también escucha `keydown` en `window`).
9. **Container query solo en el shell.** Las reglas adentro de `@container`
   aceptan ancestros: `@container keys (max-width:639px){ html.zd-m .key{…} }`
   evita que un escritorio angosto (820–1024 px sin shell) herede el layout
   móvil.
10. **Overlay de encendido + `bindGesture`.** Cualquier gesto destraba y
    enciende. Si un instrumento usa el overlay como "puerta", la pierde (no es
    un problema, pero hay que saberlo).
11. **Para testear con Playwright:**
    - `page.evaluate(() => ZD.modal.x(...))` espera la promesa del modal y
      cuelga el test: hay que usar llaves (`() => { ZD.modal.x(...); }`).
    - Con un solo mouse no se puede "mantener una tecla y mover una rueda":
      la tecla se mantiene con el teclado de PC o con toques por CDP.
    - Un instrumento con overlay a pantalla completa necesita encenderse
      antes de cualquier `page.click`.
12. **Este disco.** `sed -i` falla al preservar permisos (dueño `root`) y deja
    el archivo bien, pero el aviso confunde. Edité con scripts de Node. git
    anduvo sin `safe.directory`.

---

## 6 · A verificar en dispositivo

Nada de esta lista se probó en hardware real. Playwright solo tenía
Chromium, así que tampoco se probó en WebKit ni en Firefox. Lighthouse no
corrió.

### iPhone · Safari y PWA instalada

- [ ] Primer toque: "Pulsá para encender" destraba y la primera tecla suena.
      Probar también tocar una tecla directo, sin pasar por el overlay.
- [ ] Con el switch de silencio activado suena (`audioSession.type =
      'playback'` en Safari 16.4+, `<audio>` silencioso antes).
- [ ] Bloqueo de pantalla con una nota sonando, llamada entrante, Siri,
      segundo plano y volver: aparece "Tocá para reanudar" y un toque reanuda.
- [ ] Wake lock: la pantalla no se apaga mientras se toca y sí ~60 s después
      de la última nota (iOS 16.4+).
- [ ] Teclado en dos filas a 375/390 px: que las blancas de ~38–41 px sean
      tocables; glissando entre filas; acordes en Duo con dos dedos; que no se
      cuelguen notas al salir del teclado con el dedo.
- [ ] Ruedas de 30 px: arrastre cómodo; la de pitch vuelve al centro.
- [ ] Knobs: arrastre, doble tap y long-press sin que iOS abra la lupa o el
      menú contextual (`-webkit-touch-callout:none` en el stage).
- [ ] Sheets en peek: tocar el teclado con el sheet abierto; swipe para
      cerrar; que el scroll del sheet no robe el gesto de los sliders.
- [ ] Container queries y `dvh` (iOS 16+), con la barra de Safari visible y
      oculta.
- [ ] Rotación: landscape con el sheet a la mitad izquierda; sin perder la
      sesión ni cortar la nota.
- [ ] REC en Safari (AudioWorklet o fallback MediaRecorder): WAV a 44,1 o 48
      kHz según el equipo, y que se escuche en la tarjeta.
- [ ] Descargas (WAV, MIDI, JSON) por Web Share con archivo; "Guardar en
      Archivos". Import de JSON desde Archivos.
- [ ] LED de CLIP: el `AnalyserNode` en paralelo no va al destino. En Chromium
      se procesa igual; falta confirmar que WebKit también.
- [ ] Migración: un iPhone que ya tenía patches en la versión anterior
      (`hackwave-minimoog`) los ve en la biblioteca al abrir la nueva, una vez.
- [ ] Instalación: hint "Compartir → Agregar a inicio", ícono, nombre
      "MonoMoon", standalone sin barra y sin banner, ↓ ni ítem de menú.
- [ ] Safari puede vaciar el almacenamiento de sitios no instalados tras ~7
      días: la nota del menú lo dice; confirmar que instalada persiste.

### iPad

- [ ] Vertical 768×1024: una fila de 14 blancas, pad grande, sheets en dos
      columnas.
- [ ] Teclado físico: A–Ñ / W–P, Z/X, Espacio; que no toque notas mientras se
      escribe en el modal del nombre del patch.
- [ ] Rotar con una nota sonando (en Chromium, 1180×820 ↔ 820×1180: 8
      rotaciones sin corte).

### Android · Chrome

- [ ] `beforeinstallprompt` real: banner en el stage, diálogo nativo; aceptar
      → toast "App instalada" y no vuelve. Cerrar el diálogo: el banner queda
      visible (pedido 2).
- [ ] Web MIDI con un controlador USB: notas, bend, CC1; que la toma de REC
      los registre con la velocity.
- [ ] Gesto "atrás" del sistema con un sheet abierto (no está manejado: sale
      de la página).
- [ ] REC de varios minutos: memoria y tamaño del WAV.

### Escritorio

- [ ] Safari y Firefox: audio, REC, MIDI, JSON, sesión y migración.
- [ ] Botón "↓ Instalar" de Chrome/Edge sobre el borde de la carcasa.
- [ ] Ventana que cruza 820 px de ancho, a mano.

### Service worker y archivo local

- [ ] Instalado + modo avión → abre desde la cache.
- [ ] Subir `VERSION` de `sw.js` → toast "Nueva versión".
- [ ] Doble clic en el HTML descargado: solo el aviso del archivo local, sin
      errores.

### Música

- [ ] Abrir un `.mid` de una toma en un DAW (notas, bend, CC1, CC74/71; tempo
      120). Se validó con el parser de `tools/tests/lib/smf.mjs`, no en un DAW.
- [ ] Abrir el WAV en un reproductor y en un DAW.
- [ ] Escuchar, si se aprueba, la propuesta del limitador (4.1) contra la
      cadena actual con los patches de la tabla.

---

## Anexo · Qué se verificó y cómo

Playwright 1.63 (Chromium) contra `tools/tests/lib/serve.mjs`, que sirve el
worktree bajo `/` como GitHub Pages. El script es
[`monomoon-verify.test.mjs`](../tools/tests/monomoon-verify.test.mjs) (23 casos); las capturas se
miraron a mano y no van en el repo.

- **Viewports** 360×640, 390×844, 430×932, 768×1024 y 844×390 (táctil) y
  1440×900:
  - Shell donde corresponde y stage `[macroPanel, xyPanel, kbPanel]`.
  - Sin scroll horizontal, sin `#zd-rotate`, viewport sin `maximum-scale` ni
    `user-scalable` y 0 `AudioContext` antes del primer gesto.
  - Ningún texto visible por debajo de 11 px, controles de la barra de ≥44 px
    y 0 errores o warnings de consola.
- **Toque** (CDP) a 360×640:
  - Glissando C4→E4→C5 (cruza a la fila de arriba) y dos dedos (G4 + C5).
  - La rueda de pitch sube y vuelve a 0; macro Cutoff ↔ knob de la sección
    ↔ pad XY.
  - Doble tap = 340 Hz de fábrica; long-press → modal → "1.5k" = 1500 Hz.
  - Con un modal abierto, la tecla A no toca.
- **Banner de zd-pwa** (`beforeinstallprompt` sintético):
  - A 360×640 y 390×844 mide 82 px, es el primer hijo del stage y no se
    superpone con REC, la barra, las macros, el pad, el teclado ni las tabs.
  - Las teclas siguen arriba de las tabs.
  - `prompt()` se llama una vez (un segundo clic no vuelve a llamarlo).
  - "Ahora no" lo silencia: no está el día 13 y vuelve el 15.
  - Standalone: nada.
- **Autoguardado:**
  - 9 cambios por la UI (knobs, macro Glide, modo Duo, onda, interruptor,
    octava, rueda Mod) → recargar → `engine.state` idéntico, 0
    `AudioContext` y toast "Sesión restaurada".
  - Modal "Empezar de cero" con sus 3 botones; "solo el patch" conserva la
    biblioteca.
  - Sin IndexedDB guarda y restaura desde `localStorage`.
- **Migración:**
  - DB vieja sembrada como la escribía la versión anterior (3 registros, uno
    roto) → 2 patches en `zd:monomoon-lib:session` (app
    `monomoon-70-lib`) y toast. La DB vieja queda **byte a byte igual**.
  - Un patch migrado carga con su octava; la segunda carga no vuelve a
    migrar; "borrar todo" no la reimporta.
  - En un perfil limpio no se crea `hackwave-minimoog`.
- **JSON:**
  - `monomoon-YYYYMMDD-HHmm.json` con el envoltorio. La ida y vuelta devuelve
    corte, octava y biblioteca.
  - Rechazos en modal: JSON roto, array, otra app, versión 9, sin versión,
    sin datos, sin `app` y nombre de archivo con HTML (se ve como texto).
  - Patch `hackwave-minimoog` con corte 999999 → carga acotado a 18000.
- **REC** (escritorio, toma de ~2,5 s):
  - WAV RIFF PCM 16-bit estéreo a 44,1 kHz (la del contexto), con audio.
  - MIDI formato 0, 96 ppq, 120 bpm, track `ZERO DAY MONOMOON'70`: 9 notas
    (incluido un glissando), 14–15 bends según la corrida (hasta +1,8 st y vuelta al centro), 7
    CC1, 10 CC74 y 10 CC71.
  - **0 defectos** según `tools/tests/lib/smf.mjs`: sin solapes, colgadas,
    duración cero ni off fuera de orden.
  - Con el tope forzado a 1 s, la toma aparece en la tarjeta y sale el aviso.
- **Audio:**
  - 1 contexto con `latencyHint:'interactive'`, `running` después del toque,
    `<audio>` silencioso.
  - `suspend()` con una nota → overlay → toque → `running`.
  - `suspend()` + `visibilitychange` → `running`.
  - CLIP se enciende con el pulso angosto en 32' a volumen 100 y se apaga
    solo.
  - Osciloscopio: 0 dibujos si no se ve, ~60/s visible, 0 con reduced-motion.
- **Rotación de tablet 1180×820 ↔ 820×1180** con Do4 sonando, 8 rotaciones:
  contexto `running`, la nota sigue apretada y el VCA arriba. Shell solo a
  820, stage armado en cada entrada y vacío afuera, teclado visible, sin
  scroll horizontal ni errores.
- **Accesibilidad:**
  - 0 `alert/confirm/prompt` en el código fuera de los bloques.
  - 35 sliders con nombre único, valor y foco; Inicio/Fin del corte = 20 y
    18000.
  - Interruptores con `role=switch`; teclas con nombre y `aria-pressed`.
  - El overlay se enciende con Enter.
- **`file://`:** zd-pwa inactivo, aviso local → canonical, **0 pedidos de
  red**, 0 errores.
- **Hosted:** SW registrado, `../manifests/monomoon.webmanifest` (sin `blob:`
  ni `data:`), `theme-color` = `theme_color` del manifest y
  `apple-mobile-web-app-title` = `short_name`.
- **iframe** de 360 px: zd-pwa inerte (sin banner, sin CSS, sin pedidos al SW
  ni al manifest), shell activo, audio `running` al encender, 0 errores.
- **Hub C2 falso** (mismo origen, `window.name = 'c2slot:slotA'`):
  - Registra `slotA` / "MonoMoon 70" con las mismas capabilities. El motor
    usa el ctx del host y el título queda "MonoMoon 70 · C2".
  - "MIDI ← C2"; `midiMessage` toca y `onTransport('stop')` suelta;
    `getState()` devuelve el estado.
  - El probe da `worklet: blob`.
  - Sin sesión del patch y con biblioteca.
- **El adaptador C2 no cambió:** `git diff -U0 8bef265 -- descargables/MonoMoon70.html`
  filtrado por `HOST|zeroday_sync|registerInstrument|C2_OUT|C2_CHANNEL|SLOT_ID`
  da **0 líneas quitadas** y 3 agregadas, que solo leen `HOST`:
  `if(!HOST) Session=…`, `if(!HOST && window.ZD && ZD.audio){` y
  `function activityOn(){ if(HOST || …`. El bloque del adaptador, la
  detección del hub, la línea del ctx, "MIDI ← C2" y el `zeroday_sync` están
  idénticos.
- **Bloques:** `check-blocks` sin diferencias (8 bloques, MonoMoon 2/5
  idéntico con Acid) y `sync-blocks --check` al día.
