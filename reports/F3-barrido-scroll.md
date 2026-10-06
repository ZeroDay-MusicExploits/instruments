# F3 · Barrido de scroll en los sheets (Acid, Nebularp, MonoMoon, J4)

Auditoría **sin arreglar** de lo que pasa cuando, en el teléfono, se intenta
scrollear un sheet arrancando el dedo sobre un control. Sale del pedido sobre
CronBeat ("en el lateral debe ser más seguro poder scrollear, sin cambiar todo
el tiempo sin querer los parámetros de los efectos"), que se resolvió con el
carril lateral de `zd-mobile` v5 (los 5) y el manejo nuevo de los sliders de
CronBeat. Acá se mide si en los otros 4 alcanza el carril o hace falta algo más.

Fecha: 2026-10-06 · rama `main` con `zd-mobile` v5 sincronizado en los 5.

## Cómo se midió

`node reports/F3-barrido-scroll.mjs` (no es un test: mide y no falla). Para cada
sheet de cada instrumento, a **360×640** (el mínimo de SPEC R1) y de nuevo a
**390×844**, con gestos táctiles reales por CDP (`Input.dispatchTouchEvent`,
helper `tools/tests/lib/touch.mjs`): pasan por `touch-action`, el scroll nativo
con inercia, el `pointercancel` y el ajuste de toque de Chromium, como un dedo.

- **Swipe vertical**: el dedo sube 120 px (baja, si el sheet ya está al final)
  con 4 px de deriva horizontal, arrancando en el centro del elemento.
- **Knob**: `[role=slider]` que no es `<input>` y tiene `touch-action:none`
  (el knob de arrastre vertical).
- **Slider**: el slider alternativo de los sheets (`<input type=range>`):
  swipe desde la pista (lejos de la perilla), swipe desde la perilla y un toque
  en la pista.
- **Otra**: otra superficie del sheet con `touch-action:none` (teclado, tira,
  canvas).
- **Carril**: el mismo swipe en los 32 px de la derecha (`zd-mobile` v5).
- Por gesto: cuánto scrolleó el sheet y qué valores cambiaron (`input`/`select`
  y `aria-valuenow` del documento). Hasta 3 elementos de cada tipo por sheet
  (primero, del medio, último), página recargada por sheet.
- **Agarra**: qué porcentaje del área del contenido del sheet (todo el alto, sin
  el carril) ocupan las cajas de knobs, sliders nativos y otras superficies con
  `touch-action:none`. Es geométrico: el ajuste de toque de Chromium agranda el
  área real (un swipe que arranca en la etiqueta de arriba de un slider de
  CronBeat cayó en el slider en la primera prueba de esta sesión).

## Resumen

1. **Knobs: un swipe vertical que empieza sobre un knob nunca scrollea y casi
   siempre cambia el valor**, en los 4 instrumentos y en todos los sheets que
   tienen knobs (13 sheets con knobs, 0 px de scroll en todos). Los únicos "no
   cambia" medidos son de tope: el valor ya estaba en el límite en la dirección
   del swipe (Prob de Nebularp en 1, Drone, Ruido · Nivel y PHASER MIX en 0 con
   el dedo bajando). El knob se queda con el gesto siempre.
2. **Sliders alternativos: tocar la pista salta el valor en los 4** (lo hace
   Chrome en el `touchstart`, antes de saber si es un scroll).
   - **Acid** (`touch-action:none` en todos los `input[type=range]`): además
     **no scrollea** nunca. Es el mismo problema que tenía CronBeat.
   - **Nebularp** (`pan-y`): scrollea, pero si el swipe arranca en la pista el
     valor salta igual (Gate 1→0, Reverb 0,72→0…). Desde la perilla no cambia.
   - **MonoMoon y J4** (sin `touch-action`, `auto`): scrollea y el valor salta
     (de la pista: todo el rango; de la perilla: un poco, lo que el dedo está
     corrido del centro).
3. **Otras superficies**: el teclado de Acid (pestaña SEQ) y la tira de teclas y
   el visualizador de J4 (pestaña PAD, 43 % del contenido) no scrollean; la
   tira de J4 toca notas en `pointerdown`/`pointermove` (el swipe es un
   glissando). No cambian parámetros.
4. **Carril: en los 20 sheets el swipe en el carril scrollea y no cambia
   nada**, a 360×640 y a 390×844, también en peek. Es la única vía garantizada.
5. **Cuánto agarra el resto**: en los sheets de knobs, entre el 10 % y el 22 %
   del área del contenido a 360 px (13–26 % a 390 px), concentrado en las filas
   de knob + slider, donde va casi todo el ancho útil menos la etiqueta y el
   valor. Con el ajuste de toque, más.

**¿Alcanza el carril? No.** Alcanza como garantía (siempre hay por dónde
scrollear sin tocar nada), pero el dedo que scrollea en el medio del sheet, que
es donde lo pone cualquiera, sigue cambiando parámetros: los knobs se quedan con
todo swipe vertical y los sliders saltan al tocarlos. Hace falta además:

- **Sliders (los 4): el mismo manejo que CronBeat** (ver más abajo). Sin esto,
  aunque se arreglen los knobs, tocar un slider para scrollear cambia el valor.
- **Knobs dentro de los sheets: sacarles el arrastre vertical** (opción A) o,
  si se quiere conservar, **armarlos con una pulsación corta** (opción B).

## Tabla por sheet (360×640)

"pista / perilla / toque" son los tres gestos sobre el slider alternativo.
Cada celda: scrollea (sí/no) · cambia el valor (sí/no) en los elementos medidos.

| Instrumento | Sheet | Agarra | Swipe sobre knob | Slider: swipe desde la pista | desde la perilla | toque en la pista | Otras | Carril |
|---|---|---|---|---|---|---|---|---|
| Acid | SEQ | 22 % | no · sí (TEMPO 130→163) | no · sí | no · sí 1 de 2 | salta | teclado: no · — | +196 px · nada |
| Acid | SONIDO (peek) | 17 % | no · sí (3/3) | no · sí | no · sí 2 de 3 (chico) | salta | — | +115 px · nada |
| Acid | FILTRO (peek) | 17 % | no · sí (3/3) | no · sí | no · sí 2 de 3 (chico) | salta | — | +116 px · nada |
| Acid | PATRÓN | 2 % | — | no · sí (Densidad) | no · sí | salta | — | +38 px · nada |
| Acid | EXPORT | 0 % | — | — | — | — | — | +101 px · nada |
| Nebularp | ESCALA (peek) | 0 % | — | — | — | — | — | +110 px · nada |
| Nebularp | ARP (peek) | 10 % | no · sí (2/3, 1 en tope) | sí · sí | sí · no | salta | — | +110 px · nada |
| Nebularp | SONIDO (peek) | 16 % | no · sí (2/3, 1 en tope) | sí · sí | sí · no | salta | — | +110 px · nada |
| Nebularp | ESPACIO (peek) | 19 % | no · sí (3/3) | sí · sí | sí · no | salta | — | +110 px · nada |
| Nebularp | TECLADO | 0 % | — | — | — | — | — | +206 px · nada |
| MonoMoon | OSC (peek) | 13 % | no · sí (2/3, 1 en tope) | sí · sí | sí · sí 2 de 3 (chico) | salta | — | +128 px · nada |
| MonoMoon | FILTRO (peek) | 20 % | no · sí (3/3) | sí · sí | sí · sí (chico) | salta | — | +127 px · nada |
| MonoMoon | MOD (peek) | 5 % | no · sí (2/2) | sí · sí | sí · sí (chico) | salta | — | +130 px · nada |
| MonoMoon | VOZ (peek) | 14 % | no · sí (3/3) | sí · sí | sí · sí (chico) | salta | — | +110 px · nada |
| MonoMoon | PATCHES | 0 % | — | — | — | — | — | +218 px · nada |
| J4 | SIRENA (peek) | 15 % | no · sí (3/3) | sí · sí | sí · sí (chico) | salta | — | +129 px · nada |
| J4 | ENV·LFO (peek) | 17 % | no · sí (3/3) | sí · sí | sí · sí (chico) | salta | — | +130 px · nada |
| J4 | FX (peek) | 22 % | no · sí (2/3, 1 en tope) | sí · sí | sí · sí (chico) | salta | — | +129 px · nada |
| J4 | PAD (peek) | 43 % | — | — | — | — | tira y visualizador: no · — (la tira toca notas) | +110 px · nada |
| J4 | SESIÓN | 0 % | — | — | — | — | — | +266 px · nada |

A 390×844 da lo mismo gesto por gesto (las mismas celdas); "agarra" sube 1–4
puntos porque los sliders son más anchos. En Acid PATRÓN y EXPORT a 390×844 el
sheet ya no tiene nada para scrollear (el carril no mueve nada y no cambia
nada).

CronBeat, como referencia, después de este cambio (mismo script,
`--file CronBeat-808.html`): 0 % agarra en sus 5 sheets; swipe desde la pista o
la perilla de un slider: scrollea y no cambia; toque en la pista: no cambia.

## Dónde está cada cosa

| Instrumento | Knob (arrastre vertical) | Slider alternativo en el sheet | Otras superficies |
|---|---|---|---|
| Acid (`descargables/Acid_Bass-303.html`) | `.knob{… touch-action:none}` (l. 81); arrastre en `knob.addEventListener('pointerdown'…)` (l. 3032), long-press 550 ms = valor numérico | `.knob-slider` (l. 469 en el sheet); `input[type=range]{… touch-action:none}` (l. 132) para **todos** los sliders, también Swing y Densidad | `.keyboard{… touch-action:none}` (l. 209), en SEQ (`#kbPanel`) |
| Nebularp (`descargables/Nebularp_2035.html`) | `.knob .dial{… touch-action:none}` (l. 169); `dial.addEventListener("pointerdown"…)` (l. 3590) | `.kslider{… touch-action:pan-y}` (l. 373; en el sheet l. 520) | — |
| MonoMoon (`descargables/MonoMoon70.html`) | `.knob{… touch-action:none}` (l. 84); `el.addEventListener('pointerdown'…)` (l. 3300) | `#zd-sheet .ctl > .kslider` (l. 459), sin `touch-action` | — (el pad XY, las ruedas y el teclado están en la zona de tocar, no en sheets) |
| J4 (`descargables/J4-Sirens_Station.html`) | `.dial{touch-action:none}` (l. 43 y 130); `dial.addEventListener('pointerdown'…)` (l. 4281) | `#zd-sheet .knob .kslider` (l. 570), sin `touch-action` | `.strip`, `.scopewrap` (l. 43), en PAD |

Los cuatro knobs comparten el mismo patrón: `pointerdown` con
`preventDefault()` y `setPointerCapture`, arrastre vertical (`dy/180`–`dy/200`
del rango) y long-press de 550 ms que abre la entrada numérica; el gesto se
decide en el `pointerdown`, sin esperar a ver hacia dónde va el dedo.

## Qué haría falta, además del carril

### 1. Sliders alternativos: el manejo de CronBeat (los 4)

CronBeat (`bindSheetSliders()` y la regla del `zd-mobile-skin`) hace esto,
solo dentro de `html.zd-m #zd-sheet`:

- `pointer-events:none` en el `<input type=range>` (Chrome no puede saltar la
  perilla porque el input no ve el dedo) y `touch-action:pan-y pinch-zoom` en su
  contenedor (el vertical lo scrollea el navegador; el horizontal llega al
  script).
- Un handler delegado en `document` decide: vertical dominante → scroll;
  desde la perilla (zona de 44×44) → arrastre con |dx|≥|dy| tras 3 px; desde la
  pista → arrastre con |dx|>|dy| tras 10 px. El valor es **relativo** (desde
  donde estaba, Δx sobre el recorrido de la perilla, mínimo 160 px). Si el
  navegador se queda con el gesto (`pointercancel`), el valor vuelve.
- El valor se escribe en el input y se despachan `input`/`change`: los handlers,
  el autoguardado y la exportación no cambian; el foco, el teclado y la
  semántica de slider son los nativos. El doble toque despacha `dblclick`.

Lo único propio de cada instrumento es el ancho de la perilla y la lista de
contenedores del slider para el `pan-y`. Propuesta: **promoverlo a bloque**
(por ejemplo `zd-ui` v3 con `ZD.ui.sheetSliders({ thumb: 20 })`, que ponga él
mismo el `pointer-events:none` y el `pan-y` sobre el padre de cada slider del
sheet) y que cada sesión lo active con una línea. Tiene que hacerlo la sesión de
cada instrumento (y la de bloques), no esta: acá no se tocan esos archivos.

### 2. Knobs dentro de los sheets

**Opción A, recomendada — sin arrastre vertical en el sheet.** En el sheet cada
knob ya tiene su slider al lado (SPEC R1: "slider alternativo en móvil"): el
knob pasa a ser indicador más toques (doble toque = reset, long-press = valor
numérico) y el arrastre se hace con el slider, en horizontal. Cambio chico por
instrumento: `touch-action:pan-y` en el knob dentro de `html.zd-m #zd-sheet` y,
en el `pointermove`, no mover el valor si el knob está en un sheet (el
`pointerdown` ya no debería hacer `preventDefault()` ahí, para no frenar el
scroll en iOS). En la zona de tocar (macros de MonoMoon, TEMPO de Acid fuera
del sheet) el knob sigue como está. Un solo modelo por fila: "vertical scrollea,
horizontal ajusta".

**Opción B — armar el knob con una pulsación corta.** Si se quiere conservar el
arrastre vertical del knob en el sheet: `touch-action:pan-y` en el knob; si el
dedo se mueve más de ~8 px antes de 250 ms, es scroll (lo hace el navegador);
si se queda quieto 250 ms, el knob se "arma" (feedback visual: anillo de
acento) y desde ahí un listener `touchmove` no pasivo hace `preventDefault()` y
el arrastre vertical ajusta el valor. Entra antes del long-press de 550 ms (que
sigue abriendo la entrada numérica si el dedo no se movió). Contras: más código
por instrumento, un retardo que se siente en un control de tocar, y depende de
que el primer `touchmove` sea cancelable (Chrome lo es fuera de la zona de slop;
iOS hay que probarlo).

**Opción C — solo el carril (lo que hay hoy con v5).** Con los números de
arriba no alcanza: el carril es una vía segura que hay que aprender, y el swipe
natural en el medio del sheet sigue cambiando parámetros.

### 3. Superficies de tocar dentro de un sheet

El teclado de Acid (SEQ) y la tira de J4 (PAD) son para tocar: que no
scrolleen está bien. Ahí el carril es la vía, y conviene que el texto de ayuda
de esas pestañas lo diga ("para scrollear, deslizá por el borde derecho").

## Efectos del carril (v5) en el layout de los otros 4

Medido por `tools/tests/zd-mobile-rail.test.mjs` contra la geometría de v4
(360×640, 390×844, 768×1024, 844×390). Ningún control pierde alto, ninguna
grilla pierde columnas, no aparece scroll horizontal nuevo y nada queda en el
carril, salvo:

- **MonoMoon · OSC · 360 px — para la sesión de MonoMoon.** Los 18 botones de
  forma de onda (`.waves`, grilla de 6, adentro de 51 px de paddings anidados:
  `.section`, `.osc-row`, `.ctl.wave-ctl`) pasan de 46×44 a 42×44: mantienen
  44 de alto pero quedan por debajo de 44 en el eje corto (SPEC R1). No se puede
  arreglar desde el bloque sin bajar el carril de 32 px. Arreglo propuesto, una
  línea en su `zd-mobile-skin`:
  `@media (max-width:400px){ html.zd-m #zd-sheet .waves{grid-template-columns:repeat(3,minmax(0,1fr))} }`
  (3×2, ~86 px por botón). Hasta entonces el test lo lista como conocido
  (`KNOWN_NARROW`) y no falla por eso.
- **MonoMoon · FILTRO y VOZ · 844×390 — ya pasaba con v4.** El contenido mide
  464 px en un sheet de 408 (scroll horizontal dentro del sheet); con el carril,
  453 en 415, y los `.kslider` entran en la franja del carril. Es del skin de
  MonoMoon en landscape (las filas `.ctl` con columnas mínimas fijas).
- **Reflujos de filas `flex-wrap`** (no son grillas; una fila de botones o
  texto ocupa un renglón más): Acid EXPORT (a 360 px `↓ GUARDAR JSON` y
  `↑ CARGAR JSON` quedan uno por fila; a 390, un renglón más), MonoMoon MOD a
  360 px (la nota del modulador), J4 PAD a 360 px (controles del visualizador)
  y SESIÓN (estado de la toma), Nebularp ESCALA a 768×1024 y 844×390 (los
  botones de escala, un renglón más) y CronBeat SAMPLE a 360 px (la barra del
  editor).
- **Los sliders alternativos de las filas de knob pierden los 23 px** (siguen
  en 44 de alto): J4 a 360 px de 99 a 76 de ancho, Acid a 390 de 123 a 100,
  Nebularp a 390 de 113 a 90. El resto de la fila (knob, etiqueta, valor) no se
  mueve.
- Controles que ya medían <44 px con v4 (no son del carril, siguen igual):
  Acid (botones de 40 px, knobs de 42, Swing y Densidad de 26 de alto, chips de
  38), MonoMoon (knobs de 40, toggles de 28), J4 (diales de 42, casillas de 14,
  botones de forma de onda del LFO de 30–35 de ancho), y los links de texto de
  las pestañas de sesión. Los lista `zd-mobile-rail` en su salida.

## A verificar en dispositivo

Nada de esto está probado en un teléfono. Chromium headless con toques por CDP
no reemplaza un dedo (ni el ajuste de toque de iOS, ni su manejo de
`touch-action`).

- **CronBeat · FX con el pulgar** (Android Chrome e iPhone Safari): scrollear
  la lista de efectos y la matriz de envíos con swipes rápidos y lentos que
  arrancan encima de los sliders, en el medio y en el carril; ningún valor
  tiene que cambiar. Ajustar Nivel, Tiempo y Profundidad arrastrando de costado
  desde la perilla y desde la pista: el valor se mueve desde donde estaba, sin
  saltos.
- CronBeat · un toque en la pista no cambia nada; doble toque en un PAN de la
  mezcla lo centra; los sliders angostos de la matriz (48 px) se pueden ajustar
  con el pulgar (recorrido mínimo de 160 px).
- CronBeat · swipe en diagonal (~45°) que arranca sobre un slider: o scrollea o
  ajusta, nunca las dos cosas, y si el navegador se queda con el scroll a mitad
  de camino el valor vuelve.
- iOS: que `touch-action:pan-y` en el contenedor del slider deje pasar el
  scroll vertical y frene el horizontal (Safari lo soporta desde iOS 13, falta
  verlo en este layout) y que el foco quede en el slider después del toque
  (teclado externo).
- Los 5 · carril: con el pulgar derecho, scrollear por el borde en todos los
  sheets, también en peek; el indicador se ve, no tapa nada y la barra nativa
  no aparece encima. En Android con navegación por gestos, que el swipe
  vertical por el borde derecho no dispare el "atrás" del sistema (ese gesto es
  horizontal, pero conviene verlo).
- Los 5 · el ancho útil 23 px menor: que en un teléfono de 360 px no se corte
  ningún texto importante en los sheets (Acid EXPORT, MonoMoon OSC con los
  botones de onda de 42 px).
- Acid, Nebularp, MonoMoon y J4 · lo medido acá (knobs que se quedan con el
  swipe, sliders que saltan) en el teléfono real, para confirmar la prioridad
  del arreglo.

## Cómo reproducir

```
node reports/F3-barrido-scroll.mjs                          # 360×640, los 4
node reports/F3-barrido-scroll.mjs --vp 390x844             # otro viewport
node reports/F3-barrido-scroll.mjs --file CronBeat-808.html # referencia
node reports/F3-barrido-scroll.mjs --json /tmp/f3.json      # además, JSON
node tools/tests/zd-mobile-rail.test.mjs                    # carril y layout, los 5
```
