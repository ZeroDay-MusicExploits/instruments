# F2d · MonoMoon'70: "colapsa y se resetea o reinicia"

Fecha: 2026-10-06 · rama `main` · archivo `descargables/MonoMoon70.html`.
Parte 2 de F2d (la 1 es J4, [`F2d.md`](F2d.md)). Descripción del usuario: a
veces el instrumento "colapsa" y "se resetea o reinicia", sin saber si era (a)
el audio que muere, (b) los parámetros que vuelven a fábrica o (c) la página
que se recarga.

Todo medido en Chromium (Playwright, headless). Nada se escuchó en un
dispositivo (sección 8).

Commits: `d1f12c3` (test que falla antes) · `ea5fbaf` (la guarda) · el de este
reporte (con `reports/F2d-monomoon.mjs`, la sonda y el fuzz).

---

## 0 · Resumen

**Causa encontrada: es (a), el audio muere por un NaN en el filtro
`moog-ladder`.** Con **Mod → Filtro** activo y la fuente de modulación (el
Osc3) a frecuencia de audio, el estado del filtro crece sin límite. Mientras
crece, la salida del filtro (`tanh(out4)`) queda clavada en ±1: un zumbido
saturado y fuerte, el "colapso". Cuando el estado desborda aparece NaN, que no
se va nunca: MonoMoon queda **mudo hasta recargar la página**. Y al recargar,
la sesión se restaura igual (mismo patch, con Mod → Filtro), así que vuelve a
pasar en cuanto se toca: de ahí el "se reinicia".

En el fuzz de 10 minutos pasó en las **4 condiciones** que podían activar
Mod → Filtro (escritorio, teléfono 360×640 táctil, teléfono con la CPU
limitada 4× y una corrida dirigida) y en **ninguna** sin Mod → Filtro.

**Arreglo aplicado** (una línea en el worklet, `ea5fbaf`): si `out4` deja de
ser finito, el filtro vuelve a 0. De un estado no finito este filtro no vuelve
nunca, así que la guarda solo se activa en tomas que hoy terminan en NaN: el
resto queda **idéntico bit a bit por construcción**. Con el arreglo: 0 muestras
no finitas en las 5 condiciones de 10 minutos y MonoMoon sigue sonando.

**Lo que no se arregló:** el colapso previo (la salida saturada mientras el
estado crece) sigue: con Mod → Filtro a frecuencia de audio puede durar desde
milisegundos hasta varios segundos antes de cada reinicio (sección 5). Cambiar
eso cambia el sonido y queda para decidir.

**Descartado con datos** (sección 3): recargas de la página (0), parámetros que
vuelven a fábrica sin que nadie los toque (0 en ~27 800 acciones),
`processorerror` (0), cambios de estado del AudioContext (0), errores de
almacenamiento o cuota (0), pérdidas de memoria (plana), en tres corridas de
5 condiciones × 10 minutos (una sin el arreglo y dos con él). Hay dos caminos que
**sí** reinician algo y pueden confundirse con el bug: el doble toque en una
perilla o macro (vuelve ese valor a fábrica, por diseño, SPEC R1) y una
recarga de verdad (si el teléfono descarta la pestaña en segundo plano).

## 1 · Cómo se midió

`node reports/F2d-monomoon.mjs` instrumenta el instrumento real antes de que
cargue la página:

- **Sondas de audio:** muestras no finitas, pico y RMS en la salida (todo lo que
  va al destino) y en la salida del filtro (`engine.filter.output`), por bloque.
  Dentro del worklet, una copia que solo lee: en qué variable aparece el primer
  no finito, con qué parámetros, y cuándo el estado pasa de 1,5, 10, 1e3 y 1e10.
- **Eventos:** `processorerror` de todo AudioWorkletNode (en este Chromium llega
  como evento `error`; `onprocessorerror` es un alias), cambios de estado del
  AudioContext, errores de consola, excepciones y promesas rechazadas, `blur`,
  `pagehide`, `visibilitychange`.
- **Recargas:** contador de cargas en `sessionStorage`, `framenavigated` y
  `crash` de Playwright, toasts («Sesión restaurada», «Nueva versión»…), el
  overlay de encendido y el de «Tocá para reanudar».
- **Almacenamiento:** cada `put` de IndexedDB y `setItem` de localStorage, con
  sus errores (cuota).
- **Reinicios de estado:** llamadas a `loadPatch`, `resetAll`,
  `restoreSession`, `clearAllKeys`, `engine.panic`, `engine.loadState` y
  `Knob.reset`, con quién llamó; y, después de cada acción del fuzz y en la
  pausa siguiente, qué rutas de `engine.state` cambiaron que la acción no
  explica.
- **Memoria:** `Performance.getMetrics` por CDP cada minuto (heap, nodos DOM,
  listeners).

**El fuzz** (semilla fija por condición, 10 minutos reales cada una, en
paralelo): notas sueltas y acordes, glissandos reales sobre el teclado (mouse o
toques por CDP), ruedas Pitch y Mod (por valor y arrastrando), las 6 macros con
peso a los extremos, el pad XY (por valor y arrastrando), los 7 presets, voz
mono/unison/duo, los interruptores de modulación, la mezcla Osc3/Ruido, el
rango y la onda del Osc3, octava, y "extremos" (RESO y volumen al máximo). Unas
1 700–2 200 acciones por condición. Condiciones: escritorio 1280×860;
teléfono 360×640 táctil; teléfono 360×640 táctil con `Emulation.setCPUThrottlingRate`
4×; escritorio con Mod → Filtro y el Osc3 a frecuencia de audio desde el
principio; escritorio **sin** Mod → Filtro (control).

## 2 · La causa: NaN en el `moog-ladder`

### 2.1 · Reproducción

En la UI: hoja **MOD** → **Mod → Filtro** encendido; **Osc3 → teclado**
encendido (viene así) y el **Rango** del Osc3 en 8', 4' o 2' (o el Osc3 fijo en
C4 con «Osc3 → teclado» apagado); **Osc3 · Ruido** hacia Osc3; **rueda Mod**
arriba de la mitad. Tocar. En segundos el sonido pasa a un zumbido saturado
y después a silencio; desde ahí no suena ninguna nota, con ningún preset, hasta
recargar.

La reproducción más corta (`monomoon-ladder` 1, y la condición dirigida del
fuzz): patch de fábrica + Mod → Filtro + rueda Mod 1 + Osc3 en 2' → **NaN a los
0,5 s del primer acorde**. `monomoon-ladder` 1 lo prueba en 24 combinaciones
(RESO 0,32 · 0,6 · 0,9; Osc3 en 2' y 8'; rueda 0,7 y 1; 44,1 y 48 kHz): sin el
arreglo, **24 de 24** dan NaN y el control posterior («Bajo gordo», una nota)
da −∞.

### 2.2 · Lo que midió el fuzz (sin el arreglo)

| Condición | Primer NaN | Estado en ese momento |
| --- | --- | --- |
| escritorio 1280×860 | 33,1 s | unison, acorde de 4 notas, corte 123 Hz, RESO 0,91, contorno 0,45, Mod → Filtro y → Osc, rueda 0,99, mezcla 0,43, Osc3 pulso ancho fijo en C4 (8', teclado apagado) |
| teléfono 360×640 táctil | 17,8 s | duo, **sin notas**, corte 215 Hz, RESO 1,0, contorno −0,58, Mod → Filtro y → Osc, rueda 0,75, Osc3 cuadrada 4' |
| teléfono · CPU 4× | 146,6 s | mono, **sin notas**, corte 700 Hz, RESO 0,85 (preset «Resonante zumbón»), Mod → Filtro recién encendido, rueda 0,96, Osc3 sierra 8' |
| dirigida (Mod → Filtro desde el inicio) | 0,54 s | patch de fábrica, rueda 1, Osc3 sierra 2' |
| **sin Mod → Filtro (control)** | **nunca (10 min)** | — |

En las cuatro, al final: la nota de control da −∞ (silencio permanente) y
Chromium avisa `BiquadFilterNode: state is bad` (el DC-block recibió NaN).
sampleRate 44,1 kHz (el de esta máquina); `monomoon-ladder` cubre 48 kHz.

### 2.3 · Dónde aparece el primer no finito

- **Variable: `x`**, la entrada del filtro después de restarle la
  realimentación (`x −= out4·fb`): `out4` ya está en el orden del máximo de un
  double (~1e308) y `out4·fb` desborda.
  En la misma muestra `out1`…`out4` pasan a ±Infinity/NaN, y desde ahí todo
  queda en NaN. Los parámetros (corte, `cutoffMod`, resonancia) y la entrada son
  finitos: es un problema del **estado**.
- **Antes del NaN, el colapso:** en la condición dirigida, el estado pasa de 1,5
  a los 0,166 s, de 10 a los 0,172 s, de 1e3 a los 0,181 s, de 1e10 a los
  0,204 s y desborda a los 0,544 s. En el teléfono, de 10 a los 11,5 s a NaN a
  los 17,8 s. Durante ese tiempo la salida del filtro es ±1 (la `tanh`
  saturada): lo que se oye es un zumbido fuerte con forma de onda cuadrada.

### 2.4 · Por qué

El filtro (Stilson/Smith, "Moog VCF variation") es **lineal en su estado**: la
`tanh` está solo en la salida, no dentro del lazo. Sin modulación es estable
para toda la resonancia del instrumento (en Node con el código real, rueda en
0: el estado no pasa de 10 con el corte de 100 Hz a 18 kHz y RESO 0, 0,5 y 1).
Pero `cutoffMod` es una entrada
**a frecuencia de audio**: Osc3 → mezcla → rueda Mod → 4 200 cents. Con el
corte cambiando dentro de cada ciclo, el sistema lineal variable en el tiempo
gana energía (los estados no se reescalan cuando cambia `f`) y crece
exponencialmente desde cualquier entrada distinta de 0. Mapa en Node con el
worklet de antes (`node reports/F2d-monomoon.mjs --only mapa`; Osc3 en sierra,
las 3 sierras del patch de fábrica en C4 a la entrada; "✕" = NaN):

| RESO \ Osc3 | 2–30 Hz | 65 Hz | 131 Hz | 262 Hz | 523 Hz | 1–4 kHz |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | pasa de 10 y vuelve | ídem | ídem | ídem | ídem | ídem |
| 0,32 | pasa de 10 y vuelve | ídem | ídem | ✕ 0,97 s | ✕ 0,44 s | ✕ 0,30–0,51 s |
| 0,6 | pasa de 10 y vuelve | ídem | ✕ 1,76 s | ✕ 0,76 s | ✕ 0,40 s | ✕ 0,23–0,38 s |
| 0,9–1 | pasa de 10 y vuelve | ✕ 2,46 s (0,9) | ✕ 1,1–1,3 s | ✕ 1,1 s | ✕ 0,4 s | ✕ 0,2–0,3 s |

(Rueda 1, corte base 340 Hz.) Con el Osc3 a 1 046 Hz y RESO 0,32: rueda 0,1–0,2
nunca; 0,3 pasa de 10 y vuelve; desde 0,5 diverge con corte base 340 Hz–1 kHz.
Con el Osc3 en seno o triangular, desde 523 Hz. Con modulación lenta (el preset
«Auto-wah»: triangular en LO, ~2 Hz) no pasa nada. Sin entrada (osciladores
apagados), tampoco.

**Sin tocar notas también pasa.** Los osciladores entran al filtro siempre (el
VCA está después), así que el estado puede crecer y desbordar en silencio: dos
de las cuatro corridas tenían 0 notas apretadas en el momento del NaN. El
usuario se entera recién en la próxima nota, que ya no suena.

**Sin Mod → Filtro no lo vi en 10 minutos,** pero el contorno de filtro (±4 800
cents con ataque de 1 ms) también mueve el corte rápido: en esa corrida el
estado pasó de 1 000 y volvió solo. Por eso la guarda no puede ser un umbral
finito (sección 4).

## 3 · Lo descartado

| Camino | Qué se midió | Resultado |
| --- | --- | --- |
| (c) Recarga de la página | Contador de cargas en `sessionStorage`, `framenavigated`, `crash`, en 5 condiciones × 10 min, tres corridas | **0 recargas**, 0 crashes |
| «Nueva versión» | Código de `zd-pwa` y `sw.js` | Solo recarga si el usuario toca «Recargar» (`location.reload()` en el `onClick`). `sw.js` hace `skipWaiting` + `clients.claim` y avisa por `postMessage`; no tiene `client.navigate`. En las corridas no hubo toast (no cambió la versión) |
| Restauración de sesión | Recarga real: estado antes y después | Vuelve **idéntico** (`engine.state`, octava, nombre) con el overlay de encendido y el toast «Sesión restaurada». No se dispara sola: solo al cargar la página |
| (b) Parámetros que vuelven a fábrica | Rutas de `engine.state` que cambian sin que la acción lo explique, después de cada acción y en la pausa siguiente | **0** en 27 824 acciones (5 condiciones × 10 min, tres corridas) |
| `resetAll` («Empezar de cero») | Llamadas y UI | 0 llamadas en el fuzz; abre un modal con CANCELAR / SOLO EL PATCH / BORRAR TAMBIÉN LA BIBLIOTECA |
| **Doble toque en una perilla o macro** | Teléfono: dos toques a 180 ms y a 240 ms sobre la macro Cutoff | **Vuelve a fábrica** (6 488 → 340 Hz) las dos veces: la ventana es de 320 ms. Es lo que pide SPEC R1 («doble tap = reset»). En un teléfono, dos toques rápidos sobre una macro la reinician sin aviso: puede ser parte del "se resetea" |
| Panic | Código y medición | Espacio (solo teclado), `blur` de la ventana (con una nota apretada: la nota se corta, los parámetros quedan) y `stop` del hub C2 por `zeroday_sync` (ningún instrumento lo manda; solo el hub, si está abierto en otra pestaña). Cortan notas, no reinician nada |
| Overlay «Tocá para reanudar» | Fuzz y `ctx.suspend()` con notas | 0 veces en el fuzz. Con el contexto suspendido aparece, un toque lo vuelve a `running` y los parámetros quedan iguales |
| Estados del AudioContext | `statechange` | Siempre `running` en las 5 condiciones, también con CPU 4× |
| `processorerror` | Fuzz | **0** |
| Si el worklet falla | Forzado | Si `addModule` falla: entra el biquad de reserva y suena (solo un warning en consola y la etiqueta «motor: biquad (fallback)»). Si `process()` tira una excepción: llega el evento, el nodo queda en silencio y **MonoMoon queda mudo sin aviso** (no hay manejador; la etiqueta sigue diciendo «ladder»). No pasó en el fuzz |
| Almacenamiento / cuota | Cada `put` de IndexedDB y `setItem` | 0 errores, sin `QuotaExceededError` |
| Memoria | CDP cada minuto | Plana: heap 2,4–4,2 MB, 1 400–2 900 nodos DOM, 374–834 listeners (varían con las hojas abiertas), sin tendencia en 10 min |
| Consola | — | Fuera del warning del biquad (consecuencia del NaN), solo `Oscillator.frequency … 56320 outside nominal range` (octava alta + 2': el navegador lo recorta; inofensivo) |
| CPU limitada 4× | Condición del fuzz | Mismo NaN, más tarde (146 s). Ningún efecto propio |

Lo que el fuzz **no puede** reproducir: que el sistema descarte la pestaña en
segundo plano por memoria (iOS y Android lo hacen). Si pasa, al volver la
página se recarga, aparece «TOCÁ PARA ENCENDER» y el toast «Sesión
restaurada»: se ve como un reinicio y no es un bug de MonoMoon. Ver sección 8.

## 4 · El arreglo

```js
this.out4 = this.out3 + 0.3*this.in4 + (1-f)*this.out4;  this.in4 = this.out3;
// el estado es lineal: con el corte modulado a frecuencia de audio (Mod → Filtro)
// puede crecer hasta desbordar, y de Infinity/NaN no vuelve (MonoMoon queda mudo): se reinicia
if(!Number.isFinite(this.out4)){ this.in1=this.in2=this.in3=this.in4=0; this.out1=this.out2=this.out3=this.out4=0; }
out[i] = Math.tanh(this.out4);
```

Un hunk (3 líneas, 2898–2900), fuera de los 8 ZD-BLOCK.

**Por qué alcanza con mirar `out4`:** las cuatro etapas se calculan en orden
dentro de la misma muestra, así que si `x`, `out1`, `out2` u `out3` dejan de ser
finitos, `out4` también, en esa muestra. La muestra de la guarda sale en
`tanh(0) = 0`.

**Por qué es idéntico por construcción donde hoy es estable:** mientras `out4`
sea finito, la guarda no hace nada y las cuentas son las mismas. Y en el código
de antes un estado no finito no vuelve nunca a ser finito: NaN es absorbente,
y si `out4` es ±Infinity, a la muestra siguiente `x = (entrada − ±Inf·fb)·…` es
±Inf (o NaN con RESO 0) y `out4 = … + (1−f)·(±Inf)` da Inf − Inf = NaN. Así que
la guarda se activa exactamente en la primera muestra de una toma que hoy
termina en NaN. Y como la salida es `tanh(out4)`, aguas abajo nunca llega nada
fuera de [−1, 1], ni antes ni después.

Un umbral finito (reiniciar si |out4| > 1 000, por ejemplo) cortaría el colapso
antes, pero **no** es idéntico: el filtro es lineal y vuelve solo de
excursiones grandes (en el control sin Mod → Filtro pasó de 1 000 y volvió).

**Medido** (`node tools/tests/monomoon-ladder.test.mjs`):

| Caso | Antes (`22fb1d2`) | Después |
| --- | --- | --- |
| 1 · Mod → Filtro a frecuencia de audio, 24 configuraciones | **falla**: 24 de 24 con NaN; control −∞ | ok: 0 de 24; control −10 a −26 dBFS |
| 2 · fuzz de 60 s con Mod → Filtro, 44,1 y 48 kHz | **falla**: NaN en los dos; control −∞ | ok: 0 no finitas; control −21 dBFS |
| 3 · lado a lado en el worklet | **falla** (no hay guarda) | ok: en 14 páginas (7 presets con notas, ruedas y macros, a 44,1 y 48 kHz) el de antes queda finito y hay **0 muestras distintas** (123 392 a 138 496 por página). En el fuzz con Mod → Filtro (2 páginas), la primera activación cae en **la misma muestra** en que el estado de antes deja de ser finito (frames 33 851 y 48 402) y todo lo anterior es igual |
| 4 · Node, 1 500 tomas al azar | **falla**: 50 divergían | ok: 1 450 finitas idénticas; las 50 que divergían, finitas |

**El fuzz de 10 minutos con el arreglo** (dos corridas): 0 muestras no
finitas (salida y filtro) en las 5 condiciones; la nota de control suena en
todas; 0 recargas, 0 `processorerror`, 0 cambios de estado inesperados,
memoria igual.

## 5 · Lo que no se arregló: el colapso

La guarda saca el silencio permanente, no el crecimiento. Con Mod → Filtro a
frecuencia de audio el estado sigue creciendo, la salida del filtro queda
clavada en ±1 (un zumbido de onda cuadrada, fuerte) hasta que desborda, la
guarda lo reinicia y vuelve a empezar. Medido en el fuzz con el arreglo (la
sonda cuenta cada activación dentro del worklet):

| Condición (10 min) | Activaciones | Salida saturada (\|out4\| > 10) antes de cada una: mediana · p90 · máx. |
| --- | --- | --- |
| escritorio | 10 | 1,05 s · 4,9 s · 4,9 s |
| teléfono 360×640 táctil | 95 | 124 ms · 1,07 s · 3,5 s |
| teléfono · CPU 4× | 31 | 289 ms · 1,5 s · 2,7 s |
| dirigida (Mod → Filtro, Osc3 a frecuencia de audio) | 1 028 | 67 ms · 300 ms · 10,6 s |
| sin Mod → Filtro | **0** | — |

(La primera corrida con el arreglo contó los reinicios desde afuera y confundió
una vez un decaimiento natural a 0 exacto con una activación; la tabla es la
segunda, que cuenta dentro de la guarda.)

**Opciones, para decidir** (las tres cambian el sonido de Mod → Filtro a
frecuencia de audio, que hoy es justamente el colapso; ninguna se aplicó):

- **(a) Reiniciar antes**, con un umbral finito alto (por ejemplo
  |out4| > 1e4): el colapso duraría milisegundos en vez de segundos. No es
  idéntico por construcción: el filtro vuelve solo de excursiones grandes (en el
  control sin Mod → Filtro pasó de 1 000 y volvió), así que habría que medir
  cuántas tomas cambia cada umbral.
- **(b) Saturar la realimentación** (`x -= tanh(out4)·fb` en lugar de
  `out4·fb`, el arreglo habitual de este modelo): las etapas son estables por
  separado (polo |1−f| < 1), así que con la realimentación acotada el estado
  queda acotado. Cambia un poco el timbre de la resonancia también sin
  modulación. Es un cambio de motor (SPEC 3.1.4).
- **(c) Acotar lo que entra a `cutoffMod`**: suavizar la modulación del corte o
  limitar su profundidad a frecuencias de audio. Cambia el "gruñido" de filtro
  FM con el Osc3 audible.

Si se quiere ir más allá de la guarda, recomiendo (b), con escucha y
aprobación.

## 6 · Verificación

Chromium de Playwright, headless, `--autoplay-policy=no-user-gesture-required`.

| Test | Resultado |
| --- | --- |
| `monomoon-ladder` (4) | **antes de la guarda (`d1f12c3`): falla** 1, 2, 3 y 4. **Después: 4/4** en dos corridas |
| `monomoon-verify` (23) | 23/23 en las tres corridas |
| `zd-mobile-cycle --file descargables/MonoMoon70.html` | 7/7 |
| `check-blocks` · `sync-blocks --check` | OK: ningún bloque modificado, 40 idénticos |
| `reports/F2d-monomoon.mjs`, 5 condiciones × 10 min | antes: NaN en las 4 con Mod → Filtro; después, dos veces: 0 |

**Fuera de las regiones ZD-BLOCK y sin tocar el adaptador C2.** Un hunk
(líneas 2898–2900), fuera de los 8 bloques ZD:

```text
<script> del adaptador C2   antes 2744966c22250d28316128293f95dcce3386e36a · ahora 2744966c22250d28316128293f95dcce3386e36a
detección del hub           antes de4b3347a38d69919c9bb702c81897335f3f327e · ahora de4b3347a38d69919c9bb702c81897335f3f327e
líneas del diff que nombran HOST / C2_OUT / C2_CHANNEL / registerInstrument / zeroday_sync / SLOT_ID / ZD_M: 0
```

**No se tocaron** `tools/blocks/`, `sw.js`, el ZIP, `data/` ni el sitio.

## 7 · Para repetir

```text
node tools/tests/monomoon-ladder.test.mjs              # 4 casos (~3 min)
node reports/F2d-monomoon.mjs                          # fuzz 5 × 10 min en paralelo + worklet + caminos (~12 min)
node reports/F2d-monomoon.mjs --only fuzz --minutes 2  # más corto
node reports/F2d-monomoon.mjs --only mapa              # el mapa de 2.4 (Node, segundos)
```

## 8 · A verificar en dispositivo

Nada de esto se probó en hardware real, ni en WebKit ni en Firefox. También
quedó en [`docs/QA-dispositivos.md`](../docs/QA-dispositivos.md).

- [ ] **MonoMoon 10 minutos con la resonancia alta** (RESO ≥ 80 %), tocando
      normal y moviendo macros, pad y ruedas. Si algo "colapsa" o "se
      reinicia", anotar **exactamente cuál de estas pasó**:
  1. El sonido se vuelve un zumbido saturado y fuerte, y después vuelve solo:
     es el colapso de la sección 5 (¿estaba Mod → Filtro encendido? ¿en qué
     rango estaba el Osc3? ¿la rueda Mod arriba?).
  2. Queda mudo y no vuelve con ninguna nota ni preset: no debería pasar más;
     anotar todo el estado (es un caso nuevo).
  3. Una perilla o macro vuelve a su valor de fábrica: ¿cuál? ¿la habías
     tocado dos veces seguidas? (doble toque = valor de fábrica, sección 3).
  4. Aparece «TOCÁ PARA ENCENDER» y el toast «Sesión restaurada»: la página se
     recargó. ¿Habías salido de la app o bloqueado el teléfono? (el sistema
     descarta pestañas en segundo plano).
  5. Aparece «Tocá para reanudar»: el sistema suspendió el audio (llamada,
     otra app con sonido, bloqueo).
- [ ] **Mod → Filtro con el Osc3 audible** (Osc3 → teclado, rango 8' a 2',
      rueda Mod arriba): el zumbido saturado puede durar segundos antes de
      volver (sección 5). Anotar si se prefiere alguna de las opciones (a), (b)
      o (c).
- [ ] **Doble toque sin querer:** tocar las macros con el pulgar como se toca de
      verdad y anotar si alguna vuelve a fábrica sin intención.
