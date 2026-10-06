# F2b · J4 en reposo: VCA en 0 exacto, y la cola del eco que queda

Fecha: 2026-10-06 · rama `main` (desde `224763d`) · archivo
`descargables/J4-Sirens_Station.html`. Sale del hallazgo "J4 nunca se calla
solo" de [`j4.md`](j4.md) (riesgos): con el patch de fábrica y sin tocar nada
después de encender, la salida pasaba de −81 a −14 dBFS RMS en ~10 s y se
quedaba ahí.

Decisión del usuario: **(a) dejar el VCA en 0 exacto en reposo**. No se
normaliza TAPE SAT ni se tocan los valores de feedback o de saturación.
FEEDBACK ∞ es autooscilación intencional y no se toca.

Todo medido en Chromium (Playwright, headless). Nada se escuchó en un
dispositivo (sección 5).

---

## 1 · El arreglo: VCA en 0 en reposo y al final de cada release

Commits: `1c59b1a` (test que falla antes) · `fad26d7` (arreglo) · `44a0efe`
(control de "no cambia el sonido").

**Qué cambió** (`ampGate` e `initAudio`, fuera de las regiones ZD-BLOCK):

- El VCA nace en `0` (antes `0.0001`).
- El ataque arranca desde el valor actual (en reposo, 0); antes, desde
  `max(valor, 0.0001)`.
- El release es la misma exponencial de siempre (`setTargetAtTime`,
  τ = RELEASE/3) hasta **1e-4 (−80 dB)** y desde ahí una **recta a 0 en otra
  τ**. La recta tiene la pendiente de la exponencial en ese punto, así que no
  hay escalón ni quiebre de pendiente. Con el patch de fábrica (RELEASE 340 ms,
  sustain 0,85) el VCA llega a 0 exacto a las 10,05 τ = **1,14 s** de soltar.
  Antes caía hacia 0,0001 y se quedaba ahí.
- Una nota nueva cancela todo lo programado (`cancelScheduledValues`) y
  arranca desde donde esté: una nota tocada durante el release no queda
  cortada por el 0 (test 2b).

**Por qué la recta, y no `setTargetAtTime(0)` + `setValueAtTime(0)`.** Lo
medí con una sonda que repite cada llamada de automatización de `vca.gain`
sobre un GainNode alimentado con 1, grabada muestra a muestra. **Chromium da
por terminado un `setTargetAtTime`** y salta al objetivo: a las 10 τ si el
objetivo es ≠ 0, y antes, cuando el valor baja de ~4,5e-5, si el objetivo es 0
(medido: salto a las 9,86 τ con sustain 0,85 y a las 10,01 τ con 1,0). El
salto es de e^-10 ≈ **−87 dB** en la envolvente.

- Primer intento (`setTarget(0)` + `setValueAtTime(0)` a las 14 τ): el salto
  de Chromium llegaba antes, a las ~10 τ.
- Segundo intento (volver a pedir el mismo `setTarget` a las 8 τ, para que no
  llegue a las 10): tampoco sirve, porque con objetivo 0 el umbral es por
  valor, no por tiempo.
- La recta desde −80 dB no usa `setTarget` por debajo de 4,5e-5: es igual en
  todos los navegadores.

**Ese salto ya existía antes.** La versión anterior saltaba de
0,0001 + e^-10·g0 a 0,0001 a las 10 τ (control del test 2, sobre `224763d`).

**Escalón del release, medido** (`j4-reposo` 2). El escalón es lo que una
muestra se sale del rango que una curva continua puede recorrer en una muestra.
En la salida: escalón de la envolvente × portadora que entra al VCA ×
ganancia de pequeña señal del VCA a la salida (medida).

| Patch | Envolvente antes | Envolvente ahora | Salida de J4 antes | Salida de J4 ahora |
| --- | --- | --- | --- | --- |
| seco (fábrica sin eco ni reverb) | −88,4 dB a las 10,01 τ | **−144,7 dB** | −79,4 dBFS | **−135,7 dBFS** |
| DRIVE 8, volumen 100 %, sierra, reso 0,95 | −87,0 dB a las 10,01 τ | **−144,7 dB** | −61,1 dBFS | **−118,8 dBFS** |

−144,7 dB es el redondeo de float32 de la exponencial. La última muestra ≠ 0
del VCA real cae en la misma muestra que la de la sonda (−168 a −209 dBFS),
y después la salida es 0 exacto. El −61 dBFS de antes con DRIVE 8 era un clic
que se podía oír con auriculares y volumen alto; hoy no queda ninguno por
encima de −118 dBFS (el LSB de 16 bits está en −90 dBFS).

**En reposo** (`j4-reposo` 1, patch de fábrica, encender y 30 s sin tocar
nada):

| | RMS 30 s | Por segundo |
| --- | --- | --- |
| antes (`224763d`) | **−14,2 dBFS** | −67,8 (0 s) → −49,6 (3 s) → −32,7 (6 s) → −17,8 (9 s) → −12,9 (12 s) → −12,3 (29 s) |
| ahora | **−∞** (0 exacto) | −∞ los 30 s |

**No cambia el sonido** (`j4-reposo` 3). Una nota de 1,5 s y su release, con
un render repetible entre páginas: semilla para `Math.random` (IR y ruido),
todas las fuentes arrancan en el mismo frame, el patch se aplica antes de
encender y la nota cae en frames fijos. Toma de la salida (2 canales) muestra a
muestra contra `224763d`:

| Patch | Sostenido Δ RMS | Release Δ RMS | Forma de onda |
| --- | --- | --- | --- |
| seco | 0,0000 dB | −0,0013 dB (1,5 s) | el sostenido es **idéntico bit a bit**; la diferencia, máx −69 dBFS, está donde antes quedaba el 0,0001: antes de la nota (la fuga), al arrancar el ataque (que salía de 0,0001) y en la cola |
| eco + reverb (lazo 0,25 × 2,7, sin wow; plate 1,2 s) | 0,0000 dB | +0,0035 dB (3 s) | la diferencia queda **64,5 dB bajo la señal** (RMS −73,4 dBFS, máx −53,4 dBFS en el ataque): en la versión anterior el eco y la reverb ya traían la fuga cuando empezaba la nota (−68,6 dBFS antes de la nota) y eso pasa por la saturación del lazo |

Control de repetibilidad: la versión actual contra sí misma da un piso de
−121 dBFS a −∞ (seco) y de −93 dBFS a −∞ (eco + reverb; la reverb no es bit a
bit repetible entre páginas), muy por debajo de lo que se compara. Además
`j4-mute` 9, contra `3aceb34` con la nota en tiempo real, da 0,000 dB en los
dos patches.

---

## 2 · Lo que (a) no resuelve: después de una nota, el eco se autosostiene

**Respuesta: se autosostiene.** Con el patch de fábrica, SIREN 1 s y soltar,
la salida queda en **−12,2 dBFS RMS** (picos de −8 dBFS) desde el segundo 3
hasta el 60, sin decaer. Con la versión de antes da exactamente lo mismo: (a)
saca la semilla que cebaba el lazo **en reposo**, pero la nota misma lo ceba a
pleno nivel.

Medido con `node reports/F2b-cola.mjs` (no es un test: mide y no falla). RMS y
pico de la salida por segundo, desde que se suelta SIREN:

| s | ahora: RMS | pico | antes (`224763d`): RMS | pico |
| --- | --- | --- | --- | --- |
| 1 | −8,7 | −0,7 | −9,2 | −0,8 |
| 2 | −11,7 | −8,2 | −11,7 | −8,1 |
| 3 | −12,0 | −8,6 | −12,2 | −8,5 |
| 4 | −12,2 | −8,8 | −12,2 | −8,5 |
| 5 | −12,1 | −8,6 | −12,3 | −8,7 |
| 10 | −12,2 | −8,3 | −12,2 | −8,5 |
| 15 | −12,2 | −8,6 | −12,2 | −8,7 |
| 20 | −12,1 | −8,2 | −12,2 | −8,7 |
| 30 | −12,2 | −8,1 | −12,2 | −8,5 |
| 40 | −12,2 | −7,9 | −12,2 | −8,2 |
| 50 | −12,3 | −7,9 | −12,3 | −8,0 |
| 60 | −12,2 | −7,8 | −12,2 | −8,0 |

No baja de −60 ni de −80 dBFS en ningún momento. La salida completa (los 60
segundos, en las dos versiones) la imprime el script. La curva, una columna
por segundo (las dos versiones caen en la misma fila):

```text
    0 │
      │
  -10 │●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●
      │
  -20 │
  ...   (filas vacías hasta −100)
≤-100 │
      └────────────────────────────────────────────────────────────
       0         10        20        30        40        50        s desde que se suelta SIREN
       ○ antes (224763d) · ● ahora (VCA en 0)
```

**Por qué.** La ganancia de pequeña señal del lazo no es 1,13, es más.
Medida con una semilla de −80 dB inyectada en el eco (con el VCA en 0 no entra
nada más), ajustando cuántos dB crece por repetición:

| Frecuencia de la semilla | dB por repetición | Ganancia del lazo |
| --- | --- | --- |
| 250 Hz | +2,94 | **1,40** |
| 500 Hz | +1,80 | 1,23 |
| 1 kHz | +1,65 | 1,21 |
| 2 kHz | +2,57 | 1,34 |
| 2,6 kHz | +2,96 | **1,41** |
| 3 kHz | +2,75 | 1,37 |
| 4 kHz | +1,41 | 1,18 |

FEEDBACK × pendiente de TAPE SAT da 0,42 × 2,7 = 1,13. Encima, los dos
biquads del lazo (highpass 170 Hz y lowpass TONE, los dos con el Q por defecto
de 1 dB) tienen un pico de resonancia de ~+2 dB cada uno, según la cuenta del
biquad: cerca de 220 Hz (la fundamental de SIREN, A3; medido a 250 Hz) y cerca
de 0,78 × TONE (2,6 kHz con TONE 3400). Por eso el máximo es ~1,13 × 1,24 ≈ **1,40**. La `tanh` acota el
crecimiento y el lazo se queda donde la ganancia de señal grande vale 1:
−12 dBFS en la salida.

**No es solo el patch de fábrica.** Los presets, con SIREN 1 s y soltar:

| Preset | FEEDBACK × 1,5·SAT | A los 10 s | 20 s | 30 s |
| --- | --- | --- | --- | --- |
| Classic Wail | 0,45 × 2,70 = 1,22 | −10,6 | −10,6 | −10,6 dBFS |
| Police Alarm | 0,30 × 2,25 = 0,67 | −70,4 | −126,1 | −253 dBFS (< −80 a los 11 s) |
| Acid Scream | 0,50 × 3,90 = 1,95 | −10,1 | −10,2 | −10,2 dBFS |
| UFO Random | 0,55 × 2,70 = 1,49 | −8,4 | −8,5 | −8,5 dBFS |
| Cosmic Drone | 0,50 × 2,40 = 1,20 | −10,6 | −10,5 | −10,4 dBFS |
| Feedback Dub | 0,72 × 3,30 = 2,38 | −6,6 | −6,6 | −6,6 dBFS |

Cinco de seis no se callan nunca. Con SAT 1,8, todo FEEDBACK por encima de
~0,30 se autosostiene: es el 73 % del recorrido de la perilla (0–1,1).

Lo que hoy lo corta: **BURNOUT** (vacía el eco; `j4-mute` 3) o bajar FEEDBACK
a mano. MUTE no, porque solo silencia la salida mientras se mantiene. Leído en
el código y **no medido**: con el eco en OFF solo se cierra el retorno
(`echoWet`). El envío y el lazo siguen corriendo, así que la cola sigue
adentro y vuelve al prender el eco.

---

## 3 · Opciones (para decidir; ninguna aplicada)

Las tres se simularon dentro de la página medida (el instrumento no
cambió): `applyPatch` para FEEDBACK, la ganancia de `echoFB` para el techo y
`setSat` reemplazada para la curva normalizada. FEEDBACK ∞ (`echoFB` = 1,06)
queda afuera de A y B; C lo cambia (ver abajo).

Ganancia máxima del lazo (semilla en el pico de 2,6 kHz) y cola después de
SIREN 1 s, en dBFS RMS:

| Opción | Lazo a 1 kHz | Lazo en el pico | 0–2 s | 5 s | 10 s | 20 s | 40 s | < −80 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hoy (FEEDBACK 0,42, SAT 1,8) | 1,21 | **1,41** | −10,1 | −12,3 | −12,2 | −12,2 | −12,3 | nunca |
| A · FEEDBACK 0,37 | 1,07 | 1,24 | −10,9 | −14,7 | −14,7 | −14,7 | −14,2 | nunca |
| A · FEEDBACK 0,34 | 0,98 | 1,14 | −10,8 | −17,2 | −18,5 | −18,2 | −15,1 | nunca |
| A · FEEDBACK 0,30 | 0,87 | 1,005 | −11,9 | −24,0 | −33,1 | −41,6 | −41,4 | nunca |
| A · FEEDBACK 0,25 | 0,74 | **0,84** | −12,2 | −37,2 | −66,5 | −116,5 | −∞ | **12 s** |
| B · techo FEEDBACK·k ≤ 0,80 (sin contar los filtros) | 0,86 | 0,99 | −11,5 | −24,5 | −35,2 | −47,7 | −52,4 | nunca (−0,06 dB/rep) |
| C · TAPE SAT normalizada | 0,45 | **0,52** | −14,7 | −84,6 | −170,6 | −∞ | −∞ | **4 s** |

```text
    0 │
      │
  -10 │C███████████████████████████████████████
      │ B44477777777777777777744444444444444444
  -20 │ 2BB 444444444444444444
      │  2 BB
  -30 │   2  BB3
      │ C  2   BBB3
  -40 │           BBB3333333333333 333333333333
      │     2        BBBBB        3
  -50 │  C   2            BBBBBBBBBBBBBBBBBBBBB
      │       2
  -60 │        2
      │         2
  -70 │   C      2
      │
  -80 │           2
      │    C       2
  -90 │             2
      │              2
≤-100 │     CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
      └────────────────────────────────────────
       0         10        20        30        s desde que se suelta SIREN
       █ hoy · 7 A 0,37 · 4 A 0,34 · 3 A 0,30 · 2 A 0,25 · B techo 0,80 · C SAT normalizada
```

La conclusión de la tabla es que el umbral no es FEEDBACK = 1/k = 0,37, como
da la cuenta, sino **~0,30** (con SAT 1,8), por el pico de +2 dB de los
filtros. Cualquier límite tiene que contar con ese pico.

### A · Bajar el FEEDBACK por defecto (`P.echo.fb`)

- Decae por debajo de ~0,30 (0,30 da 1,005 en el pico y se queda en
  −41 dBFS). Para que se apague en segundos, **~0,25**: < −60 dBFS a los 8 s y
  < −80 a los 12 s.
- Es el cambio más chico (un número) y no toca la perilla, ni los presets, ni ∞.
- Cambia el sonido de fábrica: el eco pasa de infinito a una cola que se apaga
  (−12,2 contra −10,1 dBFS en los primeros 2 s).
- **No resuelve los presets** (5 de 6 se autosostienen) ni la perilla: con
  SAT 1,8, todo FEEDBACK por encima de ~0,30 se autosostiene, y con más SAT el
  umbral baja (SAT 3 → ~0,18).
- Las sesiones ya guardadas conservan su 0,42: solo cambia para quien arranca
  de cero.

### B · Limitar la ganancia del lazo (techo, salvo ∞)

- `echoFB = min(FEEDBACK, L / (1,5·SAT·1,24))`, con L < 1 (por ejemplo 0,9),
  aplicado en `applyEcho`. Con ∞ apretado no se aplica.
- Medido con un techo que **no** contaba los filtros (FEEDBACK·k ≤ 0,80):
  0,99 en el pico, y la cola se arrastra (−52 dBFS a los 40 s, −0,06 dB por
  repetición). Hay que contar el +2 dB: FEEDBACK·k ≤ ~0,72.
- Cubre todos los patches, presets y posiciones de la perilla. Por debajo del
  techo no cambia nada; ∞ sigue igual.
- Por encima del techo la perilla no hace nada (zona muerta), salvo que se
  reescale el recorrido, lo que sí cambia el sonido en toda la perilla.
- Cambia los presets que hoy se autosostienen. "Feedback Dub" (2,38) parece
  pensado para el eco desbocado: **decidir** si ese comportamiento es parte del
  preset (y entonces queda para ∞) o un defecto.

### C · Normalizar TAPE SAT (`tanh(k·x)/k`, pendiente 1 en el origen)

- La ganancia del lazo pasa a ser la de la perilla FEEDBACK (× 1,24 en los
  picos de los filtros): con 0,42 da 0,52 y se apaga en 4 s. Se autosostiene
  recién con FEEDBACK > ~0,8, así que la perilla vuelve a significar lo que dice.
- **Cambia el carácter del eco.** Las repeticiones salen ~4,6 dB más bajas
  (−14,7 contra −10,1 dBFS en los primeros 2 s) y caen −5,6 a −6,9 dB por
  repetición. Con la curva normalizada la salida máxima es 1/k, así que más
  SAT da menos nivel. Se puede compensar el retorno (×k en `echoWet`), pero
  eso no está medido.
- **Cambia FEEDBACK ∞**, que no se iba a tocar: sigue autooscilando
  (1,06 × 1,24 > 1), pero se asienta en **−22 dBFS** en lugar de −8,8 (6 s
  sostenido después de una nota, RMS por segundo: hoy −8,2 · −8,8 · −8,8 ·
  −8,8 · −8,8 · −8,8; normalizada −12,2 · −21,1 · −21,8 · −22,0 · −21,9 ·
  −22,0). Para dejar ∞ como está habría que darle su propia ganancia.

### Recomendación

Para que J4 "se calle solo" con cualquier patch y sin tocar ∞, la opción **B**
es la que lo cubre todo: techo con el pico de los filtros contado
(FEEDBACK·1,5·SAT ≤ ~0,72), sin reescalar la perilla. Así nada cambia por
debajo del techo. **A** sola (FEEDBACK por defecto 0,25) alcanza para el patch
de fábrica, pero deja los presets y la perilla como están. **C** es la más
"correcta" en la teoría, pero cambia el eco y el ∞, y sería la que más se
escucha. Las tres cambian el sonido de algo que hoy se autosostiene: decide el
usuario.

---

## 4 · Tests antes y después

Chromium de Playwright, headless, `--autoplay-policy=no-user-gesture-required`.

| Test | Antes del arreglo (`224763d`) | Después |
| --- | --- | --- |
| `j4-reposo` 1 · 30 s en reposo | **falla**: −14,2 dBFS RMS (corrido antes de `fad26d7`) | ok: −∞ |
| `j4-reposo` 2 · release, seco | escalón −88,4 dB → −79,4 dBFS (control dentro del test) | ok: −144,7 dB → −135,7 dBFS |
| `j4-reposo` 2 · release, DRIVE 8 | escalón −87,0 dB → −61,1 dBFS (ídem) | ok: −144,7 dB → −118,8 dBFS |
| `j4-reposo` 2b · nota durante el release | — | ok: la segunda nota se sostiene en −3,1 dBFS más allá del 0 programado |
| `j4-reposo` 3 · seco / eco + reverb | es la referencia | ok: Δ RMS 0,0000 / −0,0013 dB y 0,0000 / +0,0035 dB |
| `j4-mute` | — | **15/15** (9: 0,000 dB contra `3aceb34`, seco y con eco + reverb) |
| `j4-verify` | — | **18/18 en tres corridas** |
| `zd-mobile-cycle --file …J4… --cycles 4` | — | **7/7** |
| `check-blocks` · `sync-blocks --check` | — | OK: ningún bloque modificado, 8/8 idénticos |

Una corrida completa de `j4-reposo` falló en el control de repetibilidad del
caso 3 con eco + reverb: la versión actual contra sí misma dio −92,7 dBFS de
máximo, cuando el umbral era −110. La comparación contra la versión de antes
dio lo mismo que siempre. El ConvolverNode no es bit a bit repetible entre
páginas, así que el control pasó a "máx < −80 dBFS y RMS 80 dB bajo la señal"
(`fab0b1b`). Con eso: tres corridas del caso, y el archivo completo, 6/6.

**Fuera de las regiones ZD-BLOCK y sin tocar el adaptador C2.** El diff del
HTML contra `224763d` tiene 5 hunks (líneas 3125, 3426–3428, 4076–4085,
4089 y 4095–4102 del archivo nuevo); ninguno cae dentro de los 8 bloques ZD. Los sha1 del adaptador no
cambian:

```text
<script> del adaptador C2 ("ADAPTADOR C2 v1 — J4 Sirens Station" … </script>)
  antes 57a88fb056b43b190a9e98ca7da9b7095fea1d62 · ahora 57a88fb056b43b190a9e98ca7da9b7095fea1d62
detección del hub (HOST, C2_OUT, C2_CHANNEL, SLOT_ID)
  antes aa03e463802d2942748a5fc6b4494955b4eccbbf · ahora aa03e463802d2942748a5fc6b4494955b4eccbbf
líneas del diff que nombran HOST / C2_OUT / C2_CHANNEL / registerInstrument / zeroday_sync / SLOT_ID / ZD_M: 0
```

`j4-mute` 7 compara además el adaptador contra `3aceb34`: 21 sentencias del
contrato C2, 0 quitadas, 0 nuevas.

Para repetir:

```text
node tools/tests/j4-reposo.test.mjs          # 6 casos (~2,5 min)
node tools/tests/j4-mute.test.mjs            # 15
node tools/tests/j4-verify.test.mjs          # 18
node tools/tests/zd-mobile-cycle.test.mjs --file descargables/J4-Sirens_Station.html --cycles 4
node tools/check-blocks.mjs && node tools/sync-blocks.mjs --check
node reports/F2b-cola.mjs                    # las mediciones de las secciones 2 y 3 (~7 min)
```

---

## 5 · A verificar en dispositivo

Nada de esto se escuchó en hardware real, ni en WebKit ni en Firefox.
También quedó en [`docs/QA-dispositivos.md`](../docs/QA-dispositivos.md)
(apartado 1, J4).

- [ ] **J4 encendido 1 minuto sin tocar nada, en el teléfono** (iPhone Safari
      y PWA, Android Chrome). Patch de fábrica: sin sesión guardada, o después
      de "Empezar de cero". Encender y no tocar nada durante 1 minuto, con
      auriculares y el volumen alto: **tiene que quedar en silencio**. Antes
      subía solo, en ~10 s, a un zumbido fuerte (−14 dBFS).
- [ ] Lo mismo después de **recargar la página** con la sesión guardada: el
      VCA arranca en 0 aunque el patch restaurado tenga el lazo > 1.
- [ ] **El final de una nota no hace clic.** SIREN con DRIVE al máximo y
      volumen 100 %, soltar y escuchar el último segundo del release con
      auriculares. En Chromium el clic de antes (−61 dBFS) desapareció; en
      WebKit y Firefox el `setTargetAtTime` puede terminar de otra manera, pero
      el release ya no depende de eso (la recta final es un
      `linearRampToValueAtTime`).
- [ ] **Una nota durante el release** (SIREN, soltar y volver a tocar enseguida,
      varias veces): suena entera y no se corta al segundo.
- [ ] **Sin arreglar (sección 2):** SIREN y soltar con el patch de fábrica. El
      eco sigue sonando y no se apaga (−12 dBFS, medido). Anotar cómo se oye en
      el teléfono; BURNOUT lo corta. Es lo que hay que decidir en la sección 3.
