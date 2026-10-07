# F2e · MonoMoon con la realimentación saturada, Acid con el corte acotado y el escalón del release de J4

Fecha: 2026-10-07 · rama `main` (desde `70a916a`). Sigue a [`F2d.md`](F2d.md),
[`F2d-monomoon.md`](F2d-monomoon.md) (secciones 2, 4 y 5) y
[`F2d-barrido-nan.md`](F2d-barrido-nan.md) (sección 2.1).

Todo medido en Chromium (Playwright, headless) y en Node con el código real de
los worklets. Nada se escuchó en un dispositivo (sección 6).

Commits (uno por tarea; cada uno se revierte solo, comprobado con
`git revert --no-commit` sobre la punta): `640cc2b` (Acid) · `b8f7477`
(MonoMoon) · `db63cea` (J4) · el de este reporte (con los scripts de medición
`reports/F2e-monomoon.mjs`, `F2e-acid.mjs` y `F2e-reposo.mjs`).

---

## 0 · Resumen

| Tarea | Qué cambió | Resultado |
| --- | --- | --- |
| 1 · MonoMoon | `x -= Math.tanh(this.out4) * fb` en vez de `this.out4 * fb` (opción (b) de F2d), con la guarda de F2d | **Cumple** lo que pediste para la acotación y el sonido: la guarda se activa **0 veces** (antes, en 190 de 2 000 tomas del fuzz y 234 veces en 60 s de la condición dirigida); el estado queda **acotado** (cota demostrable 1,7e14; medido, ≤ 7,9e6); con RESO ≤ 0,6 y sin modulación audible, **\|ΔRMS\| ≤ 0,27 dB**. **No cumple** "la salida no queda clavada en ±1 más de 100 ms": en la condición dirigida sigue clavada (62 tramos de ≥ 100 ms en 60 s; antes, 87). El zumbido no viene de la realimentación sino de la normalización de la cadena directa (sección 1.3). Corregir esa causa, medido y **no aplicado**, lo saca del todo (0 tramos) sin cambiar los presets estáticos |
| 2 · Acid | `acid-svf` acota el corte a 0,45 × sampleRate | Idéntico muestra a muestra a 44,1, 48, 88,2 y 96 kHz (Node: 945 tomas; navegador: los dos lado a lado en el instrumento, 0 muestras distintas). A 32 kHz cambian 150 de 945 tomas, todas con el pico del corte sobre 14,4 kHz (mediana −31 dB contra la señal; la peor, −16 dB). A 22,05 kHz: 0 NaN (antes, 132 tomas no finitas en Node y NaN permanente en el navegador) |
| 3 · J4 | La recta del release se ancla en la rodilla con un `setTarget` en vez de fijar `REL_KNEE` | Era una discontinuidad real: en ~1 de cada 4 releases el hilo de audio aplica el release **un bloque tarde** (128 muestras); la exponencial llega a la rodilla en 1e-4 × 1,02595 y fijar 1e-4 era un salto de −111,7 dB. Con el ancla, 0 saltos. El sonido no cambia: la diferencia de ganancia es ≤ 2,6e-6 y solo por debajo de −80 dB. **`j4-reposo`: 50 de 50** (de a una; antes 4 de 24 fallaban). El test además tomaba mal su referencia de tiempo (sección 3.2) |

---

## 1 · MonoMoon: realimentación saturada

### 1.1 · El cambio

```js
const fb = res * 4.0 * (1.0 - 0.15 * ff);
// realimentación saturada (F2e): cada etapa tiene polo |1-f| < 1, así que con
// |tanh| <= 1 el estado queda acotado aunque el corte se module a frecuencia de audio
x -= Math.tanh(this.out4) * fb; x *= 0.35013 * ff * ff;
```

La guarda de F2d queda igual. Un hunk de 3 líneas y otro del comentario de la
guarda, fuera de los ZD-BLOCK.

### 1.2 · Acotación

**Cota demostrable.** Con |tanh| ≤ 1, la entrada de la primera etapa cumple
|x| ≤ (I + fb) · 0,35013 · f⁴, con I el pico de la entrada al filtro, fb ≤ 3,86
y f ≤ 1,148 (el corte se acota a 0,99 × Nyquist). Cada etapa es
`out = in + 0,3·in' + (1−f)·out` con |1−f| ≤ 1 − 1,16·0,0005 = 0,99942 (el corte
se acota abajo a 0,0005 × Nyquist), así que, con f variable en el tiempo, su
salida no pasa de 1,3 · sup|in| / 0,00058. Para las cuatro etapas:

```text
|out4| ≤ (1,3 / 0,00058)⁴ · 0,35013 · 1,148⁴ · (I + 3,86) ≈ 1,54e13 · (I + 3,86)
```

Con la entrada de MonoMoon al máximo (3 osciladores en 1 + 6 voces de unison en
0,5 + ruido en 1: I = 7) son **1,7e14**: finito y muy lejos de 1e308, así que la
guarda no puede activarse. Antes la cota no existía: la realimentación lineal
podía crecer sin límite.

**Medido** (`node reports/F2e-monomoon.mjs --only cota,d --runs 2000`, Node, el
worklet de `70a916a` y el de ahora sobre la misma entrada): 2 000 tomas de 1 s,
semilla fija; RESO 0–1; el Osc3 de 1 Hz a 4 kHz en sus 6 ondas; rueda Mod 0–1;
corte base de 100 Hz a 18 kHz; contorno ±1; sampleRate 22,05 · 32 · 44,1 · 48 ·
96 kHz; la entrada con los niveles al azar y, en el 30 % de las tomas, al
máximo (I ≈ 7):

| | Activaciones de la guarda | No finitas | Máx. \|out4\| (p50 · p99) | Tomas con la salida clavada > 100 ms | El tramo más largo |
| --- | --- | --- | --- | --- | --- |
| antes (F2d) | 836, en 190 tomas | 0 (por la guarda) | 1,35e308 (29 · 5,7e307) | 567 | 1 000 ms (toda la toma) |
| **ahora (b)** | **0** | **0** | **7,9e6** (11 · 4,9e5) | **170** (161 también antes) | 1 000 ms |
| (d), no aplicada (1.3) | 0 | 0 | **6,5** (p99 5,5) | 8, todas con la entrada al máximo | 870 ms |

"Clavada": ventanas de 10 ms con al menos el 90 % de las muestras en
|salida| ≥ 0,99, seguidas. Control: con RESO 0 (realimentación 0) el código de
antes y el de ahora dan las mismas muestras.

**La condición dirigida de F2d, en el navegador** (`--only dirigida --secs 60`:
patch de fábrica + Mod → Filtro + rueda Mod 1 + Osc3 en 2', acordes durante
60 s, RESO de 0,32 a 1 y el corte cambiando cada 8 acordes; los dos worklets
lado a lado sobre la misma entrada):

| | Guarda | Máx. \|out4\| | Tramos clavados ≥ 100 ms | El más largo |
| --- | --- | --- | --- | --- |
| antes (F2d) | 234 | 1,8e308 | 87 | 2,79 s |
| **ahora (b)** | **0** | 7 520 | **62** | 2,63 s |
| (d), no aplicada | 0 | 2,07 | **0** | 0 |

### 1.3 · Por qué (b) no saca el zumbido, y qué lo saca

(b) acota la realimentación, y con eso el estado, pero la cota es alta (1e5 a
1e7 medido). La causa del zumbido está en **cómo se normaliza la cadena
directa**: la entrada se escala por 0,35013 · f⁴ (0,35013 = 1/1,3⁴) y cada etapa
tiene ganancia 1,3/f. Con el corte fijo se compensan (ganancia total 1), pero
los estados de las etapas quedan a la escala de f: out1 ∝ f³, out2 ∝ f²,
out3 ∝ f. Si el corte baja rápido de f_alto a f_bajo, esos estados (hechos con
f_alto) pasan por etapas de ganancia 1,3/f_bajo y la salida se amplifica, en
transitorio, del orden de (f_alto/f_bajo)³. Con el Osc3 modulando ±4 200 cents
(f_alto/f_bajo hasta 128) eso pasa en cada ciclo del Osc3: |out4| llega a miles,
la `tanh` de la salida queda en ±1 y suena el zumbido. No es inestabilidad
(decae sola) y la realimentación no tiene nada que ver: con RESO 0 pasa igual.

**(d) Normalizar cada etapa** (medido, **no aplicado**: es otro cambio de
motor). Repartir la normalización en las etapas en vez de aplicarla a la
entrada:

```js
x -= Math.tanh(this.out4) * fb; const g = f / 1.3;            // en vez de x *= 0.35013*ff*ff
this.out1 = g*(x         + 0.3*this.in1) + (1-f)*this.out1;  this.in1 = x;
this.out2 = g*(this.out1 + 0.3*this.in2) + (1-f)*this.out2;  this.in2 = this.out1;
this.out3 = g*(this.out2 + 0.3*this.in3) + (1-f)*this.out3;  this.in3 = this.out2;
this.out4 = g*(this.out3 + 0.3*this.in4) + (1-f)*this.out4;  this.in4 = this.out3;
```

Con el corte fijo es la misma cuenta ((f/1,3)⁴ = 0,35013 · f⁴; cambia solo el
redondeo) y los presets estáticos suenan igual que con (b) (sección 1.4). Con
el corte modulado, los estados quedan siempre a nivel de señal: máx. |out4| 6,5
en el fuzz y 2,07 en la condición dirigida, y **0 tramos clavados**. Donde sí
cambia el sonido es justamente con la modulación del corte: en «Auto-wah» la
banda de 25 Hz baja 13 dB en C2 (la energía grave que bombeaba la amplificación
transitoria). Para aplicarla hace falta tu aprobación; la variante está armada
en `reports/F2e-monomoon.mjs` (`--b d` la mide en el navegador en lugar de lo
de ahora).

### 1.4 · Cuánto cambia el sonido

`node reports/F2e-monomoon.mjs --only sonido`: los 8 patches de fábrica (el de
arranque y los 7 presets) con sus ajustes por defecto y una nota sostenida en C2,
C3 y C4. Los dos worklets corren lado a lado sobre la misma entrada; se compara
la ventana de 2,5 a 4,0 s (ya en el sustain). "Instrumento" = la salida del
filtro × sustain × volumen por la curva del WaveShaper (el resto de la cadena es
lineal). Bandas de 1/3 de octava de 25 Hz a 16 kHz; se cuentan las que llevan al
menos el 1 % de la potencia. Δ = ahora − antes.

| Preset | RESO | Mod → Filtro | ΔRMS C2 · C3 · C4 (dB) | Peor banda (dB, a Hz) | \|Δ\| medio por energía (dB) |
| --- | --- | --- | --- | --- | --- |
| de fábrica | 0,32 | no | −0,24 · −0,04 · −0,00 | −0,24 a 63 Hz (C2) | ≤ 0,24 |
| Bajo gordo | 0,34 | no | −0,02 · −0,06 · −0,04 | +0,55 a 31 Hz (C2) | ≤ 0,16 |
| Sub redondo | 0,15 | no | +0,18 · +0,14 · +0,05 | +0,18 a 31 Hz (C2) | ≤ 0,18 |
| Lead filoso | 0,55 | no | +0,11 · +0,21 · +0,15 | −0,68 a 500 Hz (C3) | ≤ 0,30 |
| Pad cálido | 0,18 | no | +0,20 · +0,18 · +0,05 | +0,45 a 63 Hz (C3) | ≤ 0,21 |
| Órgano hueco | 0,10 | no | +0,27 · +0,27 · +0,24 | +0,47 a 125 Hz (C2) | ≤ 0,29 |
| Auto-wah (osc3 LFO) | 0,50 | sí (LFO) | −0,18 · −0,03 · −0,01 | −1,56 a 31 Hz (C2) | ≤ 0,15 |
| **Resonante zumbón** | **0,85** | no | +0,26 · −0,02 · **+0,66** | +0,62 a 250 Hz (C4) | ≤ 0,62 |

- **Con RESO ≤ 0,6 y sin modulación audible** (los 6 primeros): |ΔRMS| máximo
  **0,27 dB** (objetivo ≤ 0,5); la peor banda, 0,68 dB.
- **Fuera de eso:** «Resonante zumbón» (RESO 0,85) da **+0,66 dB en C4**, por
  encima del objetivo; en C2 y C3, +0,26 y −0,02 dB. «Auto-wah» queda en ±0,18 dB
  de RMS, con −1,56 dB en la banda de 31 Hz.
- Por qué cambia algo con RESO baja: la `tanh` comprime la realimentación
  cuando |out4| pasa de ~0,5, y los patches con varios osciladores a nivel alto
  llegan ahí (Órgano hueco, a −12 dBFS, sube 0,27 dB). Los cambios van en los
  dos sentidos según el patch y la nota; en C4 de fábrica, que suena bajo
  (−38 dBFS), no cambia nada.

Con (d) los presets estáticos dan lo mismo (|ΔRMS| máx. 0,27 dB, peor banda
0,73 dB; Resonante zumbón +0,50 en C4); cambia Auto-wah (−0,76 dB en C2, −13 dB
en la banda de 25 Hz).

### 1.5 · Los tests

`tools/tests/monomoon-ladder.test.mjs` se ajustó en el mismo commit:

- 3 (navegador): los 7 presets, la **condición dirigida** y el fuzz, con el
  ladder de antes de F2d y el de ahora lado a lado. Antes esperaba que la guarda
  se activara justo donde el de antes divergía; ahora espera **0
  activaciones**, salida finita y |out4| bajo la cota. Control: en la condición
  dirigida el de antes de F2d diverge. El caso ya no compara bit a bit: el
  sonido cambia a propósito.
- 4 (Node, 1 500 tomas): 0 activaciones, salida finita, |out4| bajo la cota, y
  con RESO 0 la misma salida bit a bit que con el de F2d.
- 1 y 2 sin cambios.
- Si en el caso 3 una página casi no renderizó (el worklet procesó menos de la
  mitad de lo que duró la página), se informa y se repite una vez; si vuelve a
  pasar, el caso falla (sección 4).

Con la máquina quieta: 4/4 (0 de 24 configuraciones con NaN; los 24 controles
suenan; guarda 0 en los 7 presets × 2 sampleRates, en la dirigida —máx. |out4|
4 606 y 3 994— y en el fuzz; Node: 1 500 tomas, guarda 0, máx. |out4| 2,1e5
contra una cota de 1,6e14, y con RESO 0 idéntico a F2d en las 146 tomas). En
una corrida con otras 7 páginas abiertas en paralelo fallaron dos controles
del caso 1 (el medidor no llegó a escribir sus ventanas: −∞ sin una sola
muestra no finita) y en el caso 3 tres páginas procesaron 0 muestras: carga,
no el filtro.

---

## 2 · Acid: el corte del SVF acotado

### 2.1 · El cambio

```js
const fcMax=0.45*this.sr;
for(let i=0;i<n;i++){ let fc=cC?cut[0]:cut[i]; if(fc>fcMax) fc=fcMax; const g=Math.tan(piSr*fc); …
```

Un hunk dentro de `WORKLET_CODE` (el mismo worklet sirve al render en vivo y al
export WAV), fuera de los ZD-BLOCK.

### 2.2 · Idéntico donde el corte no llega al tope

`node tools/tests/acid-svf.test.mjs`:

- **Node**, el código de `70a916a` y el de ahora en la grilla del barrido de F2d:
  CUTOFF de 0 a 100 % en pasos de 5 %, el pico de la envolvente sin acento y con
  acento (×1, ×3,39, ×9,33, acotado a 16 kHz como en `trigFilter`), RESO 0 · 25 ·
  50 · 75 · 100 %, LP/BP/HP, la caída exponencial de la envolvente: 945 tomas.
  **A 44,1, 48, 88,2 y 96 kHz, 0 tomas con alguna muestra distinta.**
- **Navegador**, el instrumento real a 44,1 y 48 kHz: los dos SVF lado a lado
  dentro del worklet, muestra por muestra, con el secuenciador sonando, la grilla
  CUTOFF × RESO con DRIVE y FUZZ en los extremos y después ENV MOD, ACCENT y
  DECAY al máximo en los tres modos: **0 muestras distintas** en 453 632 y 493 824
  muestras; el corte nunca pasó del tope.

### 2.3 · A 32 kHz

El tope es 14,4 kHz y el corte llega a 16 kHz. `node reports/F2e-acid.mjs`:

- Cambian **150 de 945** tomas, todas con el pico del corte sobre 14,4 kHz.
- Diferencia (RMS de ahora − antes, contra la señal): mediana **−31,2 dB**, p90
  −21,2 dB, la peor **−16,2 dB** (BP y HP con RESO 100 %, CUTOFF 8 kHz, pico
  16 kHz).
- En LP, el modo de fábrica: mediana −45,9 dB, la peor −28,3 dB; LP con RESO
  50 %: la peor −44,4 dB.

Lo que cambia es el agudo extremo durante el pico de la envolvente: antes el
filtro se abría hasta 16 kHz (justo Nyquist a 32 kHz) y ahora hasta 14,4 kHz.
Antes no había NaN a 32 kHz, así que esto es un cambio de sonido (chico) sin
arreglo a cambio; queda dicho para decidir.

### 2.4 · A 22,05 kHz

- **Node:** 0 tomas no finitas de 945 (antes, 132).
- **Navegador** (`acid-svf` 3): la grilla con el secuenciador sonando a 22,05 y
  32 kHz: 0 muestras no finitas y al final suena (−11,1 y −11,0 dBFS). Con el
  código de antes, a 22,05 kHz: 152 829 no finitas y −∞ al final.
- **El fuzz de 2 minutos de F2d** (`node reports/F2d-barrido-nan.mjs --only acid
  --sr 22050 --minutes 2`): 632 acciones, **0 muestras no finitas**, y al final,
  sin recargar, suena (−4,5 dBFS). Antes de F2e: NaN a los 6,1 s, permanente.

---

## 3 · J4: el escalón de −111,7 dB en la rodilla del release

### 3.1 · Dónde y por qué

`node reports/F2e-reposo.mjs`: el patch «dry» de `j4-reposo` (sustain 0,85,
RELEASE 340 ms → τ 113,3 ms, 44,1 kHz), 48 releases (4 páginas × 12). Una sonda
(GainNode alimentado con 1) recibe las mismas llamadas de automatización que
`vca.gain` y se graba muestra a muestra, con la captura ya corriendo antes del
noteOff. Por release: en qué muestra empieza a caer la envolvente, contra el
`t = ctx.currentTime` que usa `ampGate`, y cuánto vale justo antes de la rodilla
`tk = t + τ·ln(g0/1e-4)`:

| La caída empieza | Releases | Valor antes de la rodilla / 1e-4 | Mayor escalón |
| --- | --- | --- | --- |
| 1 muestra después de t (lo esperado) | 35 | 1,00001 | −144,7 dB (a 0,17 τ: el normal del inicio) |
| **129 muestras después de t** | **13** | **1,02595** | **−111,7 dB a 9,05 τ** |

Previsto con un bloque (128 muestras) de atraso: e^(128/(44 100 × 0,1133)) =
1,02594 y un escalón de 1e-4 × 0,02594 = **−111,72 dB**. Es exacto.

**La causa:** `ampGate` agenda el release en `t = ctx.currentTime`. A veces el
hilo de audio ya renderizó el bloque que empieza en `t` cuando llegan los
eventos; Chromium los aplica en el bloque siguiente y la exponencial arranca 128
muestras tarde. Pero `tk` y la recta están calculadas para el `t` nominal, así
que en `tk` la exponencial vale 1,026e-4, y `setValueAtTime(REL_KNEE, tk)` la
bajaba de golpe a 1e-4. **Es una discontinuidad real** (2,6e-6 en la ganancia
del VCA), inaudible: en la salida de J4 queda bajo −100 dBFS. El test la veía
porque pide < −120 dB en la envolvente. Con dos bloques de atraso (lo vi una
vez) el salto es −105,6 dB.

### 3.2 · El arreglo

```js
g.setTargetAtTime(0, t, tau);
g.setTargetAtTime(0, tk, tau);        // ancla: la recta arranca del valor en tk
g.linearRampToValueAtTime(0, tk+tau);
```

en vez de `g.setValueAtTime(REL_KNEE, tk)`. Según la spec de Web Audio, una
rampa lineal que sigue a un `setTarget` que todavía no empezó arranca en el
tiempo de ese evento y desde el valor que tenga la automatización justo antes:
o sea, desde donde esté la exponencial en `tk`, llegue a horario o un bloque
tarde. Verificado en Chromium con un `OfflineAudioContext` (exponencial a
horario y con 128 muestras de atraso):

| | A horario | Con un bloque de atraso |
| --- | --- | --- |
| antes (`setValueAtTime`) | sin salto | **salto de 2,6e-6** (−111,7 dB) en la rodilla |
| ahora (ancla) | sin salto (diferencia con antes ~1e-9) | **sin salto**: el mayor paso cerca de la rodilla es 2,07e-8, la pendiente normal de una muestra (−153,7 dB) |

El 0 cae en la misma muestra (`tk + τ`) en los cuatro casos. Con el atraso, la
recta sale de 1,026e-4 en vez de 1e-4 (la pendiente es un 2,6 % más empinada
durante esa última τ, por debajo de −80 dB): el sonido audible no cambia.

**Medido con la sonda, después del arreglo:** 48 releases, 20 con la caída un
bloque tarde (valor en la rodilla 1,02595) y **ninguno con escalón** (el mayor,
−144,7 dB a 0,2 τ: el normal).

**El test.** Con el escalón arreglado apareció otra cosa, que ya estaba: el
caso 2 calculaba la rodilla y el 0 esperados con una lectura de
`ctx.currentTime` hecha **después** de `noteOff`. Cuando el hilo de audio rinde
un bloque mientras corre `noteOff` (justo el caso en que el release arranca
tarde), esa lectura queda 128 muestras adelante del `t` que usó `ampGate` y el
test esperaba el 0 un bloque más tarde de donde cae (falló así en una de las
primeras 5 corridas secuenciales: 0 a las 10,022 τ en vez de 10,05 τ). Antes no
se veía porque en esos casos el test ya había fallado por el escalón. Ahora
toma como referencia el `t` de `ampGate` (su primer `setValueAtTime`), igual que
`F2e-reposo.mjs`. Los umbrales no cambiaron: < −120 dB en la envolvente y
< −100 dBFS en la salida. Va en el mismo commit que el arreglo.

**50 corridas, de a una, con la máquina quieta: 50 de 50 en verde.** En las
100 mediciones de la envolvente (dry y loud × 50) el mayor escalón es
−144,7 dB (el normal del inicio, a 0,17–0,35 τ); en la salida de J4, el
escalón estimado va de −135,7 a −118,8 dBFS. Antes fallaban por el escalón 2
de 24 corridas en `22fb1d2` y 4 de 24 con la guarda de F2d (contadas en F2d, en
worktrees aparte).

Lo que se vio por el camino y no es de este cambio: con dos tests corriendo a
la vez (hasta 8 páginas), el caso 3 falló 5 veces en 50 por sus controles de
render repetible ("la misma versión dos veces da la misma salida", "la toma
arranca en el frame pedido"). Esos controles miden en tiempo real; con un
test por vez no falló nunca (0 en más de 100 corridas entre F2d y F2e).

---

## 4 · Verificación

Chromium de Playwright, headless, `--autoplay-policy=no-user-gesture-required`.

**`node tools/tests/run.mjs` (los 31 archivos, en serie): 30 de 31 en verde.**
Corrió sobre el mismo código de los instrumentos que quedó commiteado, antes de
agregar el reintento del caso 3 de `monomoon-ladder`.
`acid-first-key` 4/4 · `acid-svf` 3/3 · `acid-verify` 13/13 ·
`cronbeat-sheet-sliders` 6/6 · `cronbeat-verify` 24/24 · `favicon` 10/10 ·
`first-hit` 12/12 · `index-cards` 15/15 · `install-info` 13/13 · `j4-cola` 7/7 ·
`j4-ladder` 5/5 · `j4-mute` 15/15 · `j4-reposo` 6/6 · `j4-verify` 18/18 ·
`landing-probar` 26/26 · `logo-once` 7/7 · **`monomoon-ladder` 3/4** ·
`monomoon-midi` 4/4 · `monomoon-verify` 23/23 · `monomoon-xypad-a11y` 1/1 ·
`nebularp-verify` 17/17 · `pc-keys` 5/5 · `zd-audio-resumed` 2/2 ·
`zd-midi-order` 6/6 · `zd-mobile-cycle` 7/7 · `zd-mobile-rail` 10/10 ·
`zd-pwa-choice` 6/6 · `zd-rec-comments` 1/1 · `zd-rec-instruments` 6/6 ·
`zd-rec-limit` 6/6 · `zd-ui-prompt` 6/6.

La falla de `monomoon-ladder` fue el control del caso 3 ("el par corrió"): en
dos páginas el worklet doble procesó 0 muestras, sin errores en la consola ni
en el worklet. Lo repetí: 1 de 3 corridas sueltas, 0 de 12 más, y 0 de 24
páginas en un script aparte. No encontré la causa; no tiene que ver con el
filtro (en esas páginas el filtro no llegó a correr). El caso 3 ahora informa
una página que renderizó menos de la mitad de lo que duró y la repite una vez
(si vuelve a pasar, el caso falla); está en el commit de MonoMoon. Con eso,
`monomoon-ladder` 4/4.

**Los 5 verify, tres corridas cada uno** (la primera dentro de `run.mjs`):
`acid-verify` 13/13 · 13/13 · 13/13 · `cronbeat-verify` 24/24 · 24/24 · 24/24 ·
`j4-verify` 18/18 · 18/18 · 18/18 · `monomoon-verify` 23/23 · 23/23 · 23/23 ·
`nebularp-verify` 17/17 · 17/17 · 17/17.

**`zd-mobile-cycle --file`** para los 5: 7/7 en cada uno.

**`j4-reposo`:** 50 de 50, de a una (sección 3.2).

**Fuera de las regiones ZD-BLOCK y sin tocar el adaptador C2**, en los tres
archivos:

```text
Acid_Bass-303.html     1 hunk (2818–2821)              · adaptador aedc0250c0280154689c627acb5eeca7bd2a2aff → igual · detección del hub 0fd8845df118ef1aab9aedbf84fc436c68796638 → igual
J4-Sirens_Station.html 2 hunks (4133–4138, 4154)       · adaptador 57a88fb056b43b190a9e98ca7da9b7095fea1d62 → igual · detección del hub b3c1864eedc5ebaba1f12555b0990aac2ac26806 → igual
MonoMoon70.html        2 hunks (2893–2895, 2900–2901)  · adaptador 2744966c22250d28316128293f95dcce3386e36a → igual · detección del hub de4b3347a38d69919c9bb702c81897335f3f327e → igual
líneas de los diffs que nombran HOST / C2_OUT / C2_CHANNEL / registerInstrument / zeroday_sync / SLOT_ID / ZD_M: 0
```

`check-blocks` y `sync-blocks --check`: ningún bloque modificado, 40 idénticos.
No se tocaron `tools/blocks/`, `sw.js`, el ZIP, `data/` ni el sitio; el ZIP queda
desactualizado respecto de `descargables/` (lo regenera la sesión de
integración).

## 5 · Para repetir

```text
node tools/tests/monomoon-ladder.test.mjs     # 4 casos (~3 min)
node tools/tests/acid-svf.test.mjs            # 3 casos (~1 min)
node tools/tests/j4-reposo.test.mjs           # 6 casos
node reports/F2e-monomoon.mjs                 # cota, dirigida, sonido (~6 min); --only cota,d suma la variante (d)
node reports/F2e-acid.mjs                     # Acid a 32 kHz (segundos)
node reports/F2e-reposo.mjs                   # dónde cae la rodilla (~2 min); --base 70a916a, la versión de antes
```

## 6 · A verificar en dispositivo

Nada de esto se escuchó en hardware real, ni en WebKit ni en Firefox. También
quedó en [`docs/QA-dispositivos.md`](../docs/QA-dispositivos.md).

- [ ] **MonoMoon con Mod → Filtro y el Osc3 a frecuencia de audio durante 5
      minutos** (Osc3 → teclado, rango 8' a 2', rueda Mod arriba, RESO de 30 a
      100 %): no tiene que quedar mudo nunca. **Con este commit (b) el zumbido
      saturado va a seguir apareciendo** (medido: 62 tramos de ≥ 100 ms en 60 s
      en la condición dirigida); se va recién con la variante (d) de la sección
      1.3. Anotar si con (b) es tolerable o si se aprueba (d).
- [ ] **Los presets antes y después** (revertir el commit de MonoMoon para
      escuchar el antes): sostener una nota grave, media y aguda en cada uno. Con
      RESO baja la diferencia medida es ≤ 0,27 dB; mirar sobre todo «Resonante
      zumbón» en notas agudas (+0,66 dB) y «Órgano hueco» (+0,27 dB).
- [ ] **Acid con la salida a menos de 32 kHz** (por ejemplo, un auricular
      Bluetooth en modo llamada): CUTOFF y ENV MOD altos con el secuenciador
      sonando; ya no tiene que quedar mudo.
- [ ] **J4, el final de las notas con auriculares** (SIREN y soltar, varias
      veces): ningún clic al final del release. El cambio está a −100 dBFS o
      menos, así que no debería oírse nada distinto de antes.
