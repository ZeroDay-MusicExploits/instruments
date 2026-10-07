# F2d · J4: NaN en el filtro ladder

Fecha: 2026-10-06 · rama `main` (desde `22fb1d2`) · archivo
`descargables/J4-Sirens_Station.html`. Sigue al hallazgo de la sección 6 de
[`F2c.md`](F2c.md). En la misma tanda: MonoMoon
([`F2d-monomoon.md`](F2d-monomoon.md)) y el barrido sin arreglos de Acid,
Nebularp y CronBeat ([`F2d-barrido-nan.md`](F2d-barrido-nan.md)).

Todo medido en Chromium (Playwright, headless). Nada se escuchó en un
dispositivo (sección 8).

Commits: `64adee5` (test que falla antes) · `ab5573a` (la guarda) · `4944735`
(la salida del caso 1b) · el de este reporte.

---

## 1 · Qué pasaba

**Reproducción** (`node tools/tests/j4-ladder.test.mjs` contra `22fb1d2`):

- **Acid Scream, 52 tomas de SIREN** (4 páginas × 13, a 44,1 kHz, con
  sostenidos de 250 a 1200 ms y pausas de 150 a 1500 ms): **38 fallidas**. La
  primera toma con NaN cae en la toma 1, 4, 5 u 8 según la página, y desde ahí
  todas dan NaN: J4 queda mudo. El control al final (Police Alarm, una nota) da
  NaN en las 4 páginas.
- **Barrido de CUTOFF, RESO y DRIVE** en los 7 patches a 44,1 y 48 kHz: los 14
  mueren en el primer paso (CUTOFF 12 kHz, RESO 1,15).

**No es solo Acid Scream.** Con el corte fijo, el ladder diverge en cuanto el
corte pasa de ~0,19 × sampleRate con la resonancia desde ~0,35–0,5
(`node reports/F2d-ladder.mjs --only mapa`, sierra de 220 Hz, 1 s; ✕ = NaN):

| CUTOFF \ RESO | 0 | 0,2 | 0,35 | 0,5 | 0,62 | 0,8 | 1,0 | 1,08 | 1,15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 000 Hz · 44,1 kHz | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| 8 500 Hz · 44,1 kHz | ok | ok | ok | ok | ok | ✕ | ✕ | ✕ | ✕ |
| 9 000 Hz · 44,1 kHz | ok | ok | ok | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| 11–12 kHz · 44,1 kHz | ok | ok | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |
| 9 000 Hz · 48 kHz | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| 9 250 Hz · 48 kHz | ok | ok | ok | ok | ok | ✕ | ✕ | ✕ | ✕ |
| 10–12 kHz · 48 kHz | ok | ok | ok | ✕ | ✕ | ✕ | ✕ | ✕ | ✕ |

El pad XY tiene por defecto **X = CUTOFF y Y = RESO**. Llevar el dedo al borde
derecho del pad (los últimos ~4–6 % del ancho: CUTOFF ≥ 8,4 kHz a 44,1 kHz, ≥ 9,3 kHz a 48 kHz) con
Y por encima de la mitad deja a J4 mudo hasta recargar, **sin tocar ninguna
nota**: el oscilador entra al filtro siempre (el VCA está después). Medido: con
el patch de fábrica y CUTOFF 12 kHz / RESO 0,62, NaN mientras el corte sube, en
8,9 kHz a 44,1 kHz y en 9,5 kHz a 48 kHz.

Acid Scream llega con la envolvente: CUTOFF 500 + ENV AMT 0,7 × 11 500 = pico de
8 550 Hz en 4 ms. A 44,1 kHz ese pico está en la zona; a **48 kHz no**: 52 tomas
de Acid Scream a 48 kHz quedan finitas (máx. |s3| 2,61). Por eso depende del
equipo (iOS alterna 44,1 y 48 kHz).

## 2 · Dónde aparece el primer valor no finito

El ladder de `22fb1d2` instrumentado dentro del worklet (solo lee; `node
reports/F2d-ladder.mjs --only diag`):

- **Variable: el estado, `s3` después de la sigmoide** (`y = s3 − s3³/6`). En
  esa muestra s3 vale ~1e171 antes de la sigmoide: s3³ desborda a Infinity e
  `y` queda en ∓Infinity; a la siguiente, `x = entrada − r·y` se recorta a ±3
  (finita) pero `s3 = … − k·y` es ±Inf, la sigmoide da Inf − Inf = **NaN**, y desde ahí
  `x` es NaN (el recorte no atrapa NaN) y todo el estado queda en NaN para
  siempre. Los coeficientes (f, k, p, r) y la entrada son finitos en todo
  momento.
- **Parámetros**, las 4 páginas de Acid Scream a 44,1 kHz: corte en el worklet
  **8 510–8 525 Hz** (la cima de la envolvente), RESO **1,08**, drive del
  ladder **1** (el AudioParam `drive` del worklet no lo toca nadie; la perilla
  DRIVE es el WaveShaper de después del filtro), f = 0,386, **k = +0,151**,
  p = 0,576, r = 7,78; entrada 0,53–0,64. Modulación: la envolvente del
  filtro (ataque 4 ms) y el LFO de WAIL (0,4 Hz, ±600 Hz al tono, cambia la
  entrada, no el corte). sampleRate 44 100.
- **Cómo diverge:** con r = 7,8 la entrada `x` queda recortada en ±3 y las tres
  primeras etapas se clavan en ±3. Con k > 0 (corte por encima de ~0,16 ×
  sampleRate), la cuarta etapa da `s3 = p·(s2 + s2_ant) − k·y ≈ 3,46 + 0,15·|y|`
  y la sigmoide, pasado √6, invierte el signo: `−k·y` suma. En cuanto
  |s3| > √12 ≈ 3,46, |y| > |s3| y cada muestra lo agranda. Historia de s3 antes
  de la sigmoide (página 1): 3,35 → 3,10 → 2,71 → 3,14 → **3,79** → 4,28 → 4,79
  → 5,51 → 6,85 → 10,6 → 31,6 → 796 → 1,3e7 → 5,2e19 → 3,6e57 → 1,2e171 → NaN.
  **Del cruce de √12 al NaN: 11 muestras** (0,25 ms) en las cuatro páginas; 9 y
  10 en el pad en la esquina.
- En ninguna página hubo una excursión sobre √12 que volviera sola.

## 3 · El arreglo: confirmado, con una corrección

Antes de la sigmoide, si `!(|s3| <= √12)` (incluye NaN e Infinity), el filtro
vuelve a 0 (`s`, `ox`, `oy`). Son una constante y una línea
(`ab5573a`, 2 hunks, fuera de los 8 ZD-BLOCK):

```js
const SQ12=Math.sqrt(12);
…
this.s[3]=this.s[2]*p+this.oy[2]*p - k*this.s[3];
if(!(Math.abs(this.s[3])<=SQ12)){ this.s[0]=this.s[1]=this.s[2]=this.s[3]=0; x=0; }
this.s[3]=this.s[3]-(this.s[3]*this.s[3]*this.s[3])/6; // sigmoide band-limited
```

`x=0` hace que `ox` quede en 0 en la asignación de siempre (`this.ox=x`), y
`oy` copia las etapas, que ya están en 0. La muestra de la guarda sale en 0.

**Lo que se confirma:** mientras |s3| ≤ √12 el código hace exactamente las
mismas cuentas (la comparación no tiene efectos), así que la salida es la
misma bit a bit hasta la primera activación. Y con |s3| ≤ √12 la sigmoide
queda en [−√12, √12]: la salida del filtro nunca pasa de 3,46, así que aguas
abajo (trémolo, VCA, WaveShaper con sobremuestreo, eco, reverb) no entra nada
enorme ni infinito.

**Lo que se corrige: "por construcción" no vale en general.** Que |s3| pase √12
no garantiza que la recurrencia diverja: con k < 0 o con la entrada ya
recortada por su cuenta, la sigmoide invierte el signo y el término −k·y puede
traerla de vuelta. Medido en Node con el código real (`--only umbral`; tomas
de 0,8 s con envolvente, 44,1 y 48 kHz):

| Entrada al ladder | Tomas | Divergían | Finitas | Finitas que la guarda cambia |
| --- | --- | --- | --- | --- |
| drive 1, entrada 0,3–1 (J4) | 1 500 | 574 | 926 | **0** |
| drive 1, entrada 1–2 | 1 500 | 691 | 809 | **0** |
| drive 1, entrada 2–4 | 1 000 | 648 | 352 | 23 (la menor: entrada 2,54) |
| drive 4–8, entrada 0,3–1 | 1 000 | 712 | 288 | 41 (la menor: entrada × drive 2,80) |

En un fuzz más grande que corrí durante la sesión (drive 1, entrada de 1 a
2,2, 8 000 tomas sesgadas a la frontera; no quedó en el script) apareció una
con entrada 1,93. O sea: las excursiones que vuelven
solas aparecen cuando la entrada ya llega casi al recorte de ±3 por sí misma.
**En J4 no pasa:** el AudioParam `drive` del ladder queda en 1 (no lo toca ni
la UI, ni los patches, ni el JSON, ni el hub), y la entrada es el oscilador
(PeriodicWave normalizada a pico 1) y el ruido (±1) con `oscGain + noiseGain =
1` en todo cruce de modos (las dos rampas usan el mismo τ hacia objetivos
complementarios), así que |entrada| ≤ 1.

La afirmación correcta es: **en J4 toda toma en la que el ladder de antes queda
finito da la misma salida bit a bit**, medido, no deducido:

- `j4-ladder` 3, en el navegador: el ladder de `22fb1d2` y el de ahora corren
  lado a lado dentro del worklet sobre la misma entrada y los mismos
  parámetros, muestra por muestra, y el grafo recibe el de antes. En 13 páginas
  (los 7 patches con 6 notas a 44,1 y 48 kHz, salvo Acid Scream a 44,1 kHz)
  el de antes queda finito: **0 muestras distintas** en 287 232 a 350 720
  muestras por página, 0 activaciones. En las 7 en que diverge (Acid Scream a
  44,1 kHz y el barrido en 3 patches a 44,1 y 48 kHz), la primera activación
  cae 4–10 muestras antes de la primera muestra no finita del de antes, y todas
  las muestras previas son iguales.
- `j4-ladder` 4, en Node: 1 200 tomas como las de J4 (drive 1, entrada hasta 2,
  6 sampleRates, envolvente y LFO al corte): 936 quedaban finitas y dan **0
  muestras distintas**; las 264 que divergían quedan finitas.

**¿Hay un arreglo más chico o mejor?** Más chico no: es una línea. Hay uno que
sí es idéntico por construcción en cualquier condición: reiniciar recién cuando
la salida dejaría de ser finita en Float32 (`!(|y| < 2^128 − 2^103)` después de
la sigmoide). De un estado no finito el ladder no vuelve nunca (NaN es
absorbente y ±Inf da NaN a la muestra siguiente), así que esa guarda solo se
activa en tomas que hoy mueren. **No lo recomiendo** para J4: deja salir del
filtro ~6–10 muestras enormes (hasta 3,4e38) antes del reinicio. Pasan por el
trémolo y el VCA (finitas) y llegan a un WaveShaper con sobremuestreo 2×, cuyo
interpolador suma muestras vecinas en Float32: con valores cerca de 3,4e38 esa
suma puede desbordar a Infinity, y si se cruzan dos de signo opuesto, a NaN.
No lo pude descartar sin leer el código de cada navegador. Con √12 la salida
está acotada por construcción y el costo (excursiones que volverían solas) no
existe en las condiciones de J4. Si algún día se expone el drive del ladder, hay que volver
a mirar esto.

Las opciones (b) `tanh` y (c) acotar la resonancia no se aplicaron (cambian el
timbre).

## 4 · Mediciones de la guarda

`j4-ladder` 1b (52 tomas de Acid Scream a 44,1 kHz, una sonda en la salida del
filtro: activación = muestra en 0 exacto después de una distinta de 0):

- **Tomas fallidas: de 38 (las 13 en la peor página) a 0 de 52.** Las 52
  suenan (−5,1 a −6,9 dBFS RMS) y Police Alarm suena después (−3,8 dBFS).
- **Activaciones de la guarda: 10 y 16 en 52 tomas** en dos corridas (3 + 3 +
  2 + 2 y 4 + 4 + 4 + 4 por página; varía con dónde cae cada nota respecto del
  LFO), una o dos por toma afectada, en la cima de la envolvente.
- **Recuperación: el filtro vuelve a −6 dB de su RMS previo en 1,02 ms** en
  todas (la resolución de la ventana es 1 ms; objetivo < 50 ms). J4 nunca deja de
  sonar: no hay silencio que esperar.
- **El clic:** chico, ver 4.1.

### 4.1 · El clic de recuperación

`node reports/F2d-ladder.mjs --only clic`: 52 tomas de Acid Scream a 44,1 kHz
con la nota en un frame fijo, grabando la salida de J4 y la del filtro desde
5 ms antes hasta 60 ms después. La referencia son las tomas **sin** activación,
en el mismo momento de la nota (en una corrida: 11 con activación, 41 sin).

- Las activaciones caen **4,15–4,72 ms después de la nota**: la cima de la
  rampa de ataque del corte (4 ms). Última muestra del filtro antes del 0:
  entre 1,4 y 3,3 en valor absoluto.
- **Escalón máximo entre dos muestras** en la salida de J4 (0–60 ms): mediana
  **4,1 dBFS con activación y 3,8 sin**; máximo 5,2 y 5,1. El ataque de Acid
  Scream ya tiene escalones de escala completa (la sierra y la autooscilación
  a 8,5 kHz después del DRIVE y el compresor): el reinicio no los supera.
- **Nivel por milisegundo:** con activación hay un pozo de **1,0 a 1,8 dB entre
  los 6 y los 8 ms** (el reinicio más la anticipación del compresor). En el
  resto de los primeros 30 ms la diferencia queda entre −0,4 y +0,6 dB. En la
  salida del filtro: +1,1 dB en el ms 4 (la excursión hacia √12 justo antes) y
  −0,4 dB en el 5.

Lectura: el "clic" es un pozo de ~3 ms y ~1,5 dB dentro del ataque de la nota,
sin un escalón mayor que los que ya tiene. No lo considero grande y no propongo
cambiarlo. Si en el teléfono se oye, hay una variante que tampoco toca el
sonido estable: en vez de llevar el estado a 0, escalarlo para que s3 quede en
±1 con el mismo signo (s0–s2 en la misma proporción). Sigue siendo una
diferencia solo en el camino de la guarda.

El caso 1b del test medía el escalón contra los 20 ms anteriores, que caen
antes de la nota; esa comparación no servía y se sacó (`4944735`).

### 4.2 · Con el corte quieto en la zona (el pad en la esquina)

En Acid Scream el corte pasa por la zona ~2 ms y sale. Con el corte **quieto**
ahí (el pad XY a la derecha, o CUTOFF alto con RESO alta), la recurrencia
diverge una y otra vez y la guarda se activa en continuado. Medido en Node con
el código de ahora (sierra de 220 Hz, 2 s):

| sampleRate | Corte · RESO | Activaciones por segundo | Salida del filtro: RMS · pico |
| --- | --- | --- | --- |
| 44,1 kHz | 8 000 Hz · 0,62 | 0 | −3,2 dB · 0,94 |
| 44,1 kHz | 8 600 Hz · 0,62 | 13 | −3,3 dB · 3,25 |
| 44,1 kHz | 9 000 Hz · 0,62 | 220 | −3,1 dB · 3,37 |
| 44,1 kHz | 12 000 Hz · 0,62 | 3 183 | −3,6 dB · 3,35 |
| 44,1 kHz | 8 550 Hz · 1,08 (la cima de Acid Scream) | 482 | −1,3 dB · 3,39 |
| 48 kHz | 9 000 Hz · 0,62 | 0 | −3,2 dB · 1,43 |
| 48 kHz | 12 000 Hz · 0,62 | 1 282 | −2,9 dB · 3,35 |

El nivel queda como fuera de la zona, con picos de hasta 3,4 y el ritmo de
los reinicios encima: un timbre áspero. Antes, ahí, había silencio para
siempre. No toca ningún sonido que hoy exista; si se quiere que esa zona suene
como una autooscilación limpia hay que cambiar el filtro (opciones (b) o (c) de
F2c), con aprobación.

## 5 · Barrido determinista

`j4-ladder` 2: los 7 patches a 44,1 y 48 kHz, 31 pasos cada uno (los extremos
y 26 al azar con semilla fija por patch y sampleRate): CUTOFF 30–12 000 Hz,
RESO 0–1,15, DRIVE 1–8, y una nota de 160 ms por paso. **Salida siempre finita
(0 muestras no finitas en los 14) y al final J4 suena** (−3,8 a −4,5 dBFS). Antes
de la guarda los 14 morían en el primer paso.

## 6 · Verificación

Chromium de Playwright, headless, `--autoplay-policy=no-user-gesture-required`.

| Test | Resultado |
| --- | --- |
| `j4-ladder` (5) | **antes de la guarda (`64adee5`): falla** 1, 1b, 2, 3 y 4 (38 de 52 tomas, los 14 barridos, la guarda no existe, 264 tomas no finitas). **Después: 5/5** en dos corridas (0 de 52 tomas fallidas las dos veces; 10 y 16 activaciones) |
| `j4-cola` (7) | 7/7 |
| `j4-reposo` (6) | **Intermitente, y ya lo era antes.** El caso 2 «dry» falla a veces con `mayor escalón -111.7 dB a las 9.0x τ (tiene que ser < −120)`; los otros 5 casos pasan siempre. Con la guarda: 4 de 12 corridas en el árbol del repo y 4 de 24 en un worktree aparte. **En `22fb1d2` (sin la guarda), en un worktree igual: 2 de 24, con el mismo mensaje.** (En los worktrees git no anda por el dueño de /tmp y el test se saltea las comparaciones contra 224763d; por eso se comparan worktree contra worktree.) La diferencia no es significativa con estas muestras (Fisher, p ≈ 0,67) y esa aserción no pasa por el filtro: mide la envolvente de `vca.gain` con una sonda (un GainNode alimentado con 1 que repite su automatización), con el patch de fábrica, que nunca llega a la zona de la guarda. El escalón está en la rodilla de −80 dB del release de F2b (`REL_KNEE`), que se calcula con `vca.gain.value` leído desde el hilo principal, que puede llegar con un bloque de atraso. No lo toqué (fuera del pedido); queda anotado para quien siga F2b. **Arreglado en F2e** ([`F2e.md`](F2e.md), sección 3): el release arrancaba a veces un bloque tarde y la rodilla forzaba un salto |
| `j4-mute` (15) | 15/15 |
| `j4-verify` (18) | 18/18 en las tres corridas |
| `zd-mobile-cycle --file descargables/J4-Sirens_Station.html` | 7/7 |
| `check-blocks` · `sync-blocks --check` | OK: ningún bloque modificado, 40 idénticos |

**Fuera de las regiones ZD-BLOCK y sin tocar el adaptador C2.** El diff del HTML
contra `22fb1d2` tiene 2 hunks (líneas 3026 y 3054–3056 del archivo nuevo),
fuera de los 8 bloques ZD. Los sha1 no cambian:

```text
<script> del adaptador C2   antes 57a88fb056b43b190a9e98ca7da9b7095fea1d62 · ahora 57a88fb056b43b190a9e98ca7da9b7095fea1d62
detección del hub           antes b3c1864eedc5ebaba1f12555b0990aac2ac26806 · ahora b3c1864eedc5ebaba1f12555b0990aac2ac26806
líneas del diff que nombran HOST / C2_OUT / C2_CHANNEL / registerInstrument / zeroday_sync / SLOT_ID / ZD_M: 0
```

(El sha1 del adaptador es el mismo que en F2c. El de la detección del hub se
calculó de `/* ADAPTADOR C2 v1 — detección del hub` hasta el primer
`}catch(e){}`; F2c usó otro recorte, por eso el número es otro.)

**No se tocaron** `tools/blocks/`, `sw.js`, el ZIP, `data/` ni el sitio. El ZIP
queda desactualizado respecto de `descargables/` (lo regenera la sesión de
integración).

## 7 · Para repetir

```text
node tools/tests/j4-ladder.test.mjs          # 5 casos (~4 min)
node reports/F2d-ladder.mjs                  # diag, mapa, umbral, zona, clic (~5 min)
```

## 8 · A verificar en dispositivo

Nada de esto se escuchó en hardware real, ni en WebKit ni en Firefox. También
quedó en [`docs/QA-dispositivos.md`](../docs/QA-dispositivos.md).

- [ ] **Acid Scream 20 veces seguidas en el teléfono** (SIREN con sostenidos y
      pausas distintas) y después Police Alarm: J4 suena siempre. Antes, a
      44,1 kHz, quedaba mudo hasta recargar en la mayoría de las tomas. Anotar
      el equipo y su frecuencia de muestreo (la del WAV que graba REC): a
      48 kHz Acid Scream no llega a la zona y la prueba no dice nada.
- [ ] **Con auriculares, el ataque de esas tomas:** si en alguna se oye un clic
      o un hueco de unos 3 ms, es la guarda (sección 4.1). Anotar si molesta.
- [ ] **El pad XY en la esquina de arriba a la derecha**, con cualquier patch y
      sin tocar notas, y después SIREN: tiene que sonar. Con el dedo quieto en
      la esquina el timbre se vuelve áspero (sección 4.2); anotar si molesta.
- [ ] **WebKit (Safari, iOS) y Firefox:** la guarda es JavaScript puro (una
      comparación por muestra en el worklet); igual, repetir las dos primeras.
