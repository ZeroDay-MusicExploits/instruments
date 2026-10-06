# F2c · J4: techo del lazo del eco (opción B), y cómo cambió cada preset

Fecha: 2026-10-06 · rama `main` (desde `27707d5`) · archivo
`descargables/J4-Sirens_Station.html`. Sigue a [`F2b.md`](F2b.md): después de
tocar SIREN y soltar, el eco se autosostenía (−12,2 dBFS con el patch de
fábrica) porque la ganancia del lazo llegaba a 1,41. Decisión del usuario:
**opción B**, un techo para la ganancia del lazo con ∞ apagado.

Todo medido en Chromium (Playwright, headless). Nada se escuchó en un
dispositivo (sección 8).

Commits: `0a0fb39` (test que falla antes) · `60f8ab0` (el techo) · `80d86d2`
(ajuste de una métrica del test) · el de este reporte.

---

## 1 · Qué cambió

**El techo.** Con ∞ apagado, la ganancia de pequeña señal del lazo
(FEEDBACK × pendiente de TAPE SAT × pico de los filtros del lazo) no pasa de

```text
L(TIME) = min(0,97 ; 10^(−1,8 · TIME / 20))
```

Es la misma caída, **1,8 dB por segundo** en el pico de los filtros, con
cualquier tiempo de eco. Algunos valores: 0,970 con TIME ≤ 0,15 s · 0,944 con
0,28 s (Police Alarm) · **0,924 con 0,38 s (fábrica)** · 0,902 con 0,5 s ·
0,883 con 0,6 s · 0,780 con 1,2 s (máximo de la perilla TIME) · 0,733 con 1,5 s
(hub a 40 BPM) · **0,661 con 2 s** (máximo del DelayNode).

- **Pendiente de TAPE SAT:** 1,5 × SAT (la de `tanh(k·x)` en el centro).
- **Pico de los filtros:** el máximo de |highpass 170 Hz · lowpass TONE|
  (Q = 1 dB), calculado con las fórmulas de biquad de la spec de Web Audio en
  600 puntos de 20 Hz a Nyquist. Con TONE ≥ 1 kHz da 1,256 (+2 dB, cada
  filtro por su lado). Con TONE 300 Hz los dos picos se juntan y da 1,568.
  Coincide con `getFrequencyResponse` de los nodos reales a 4 decimales
  (`j4-cola` 2).

**La perilla FEEDBACK** sigue yendo de 0 a 1,1 (0–100 %), pero el valor que
llega al lazo es:

- **igual que antes** mientras el lazo queda por debajo del 93 % del techo
  (la rodilla). En el patch de fábrica la rodilla cae en FEEDBACK 0,253, así
  que de 0 a 0,25 no cambia nada;
- de ahí, **una recta hasta el techo**, que es el máximo de la perilla. Es
  monótona y sin zona muerta: más perilla da más lazo hasta el techo.

El techo depende de SAT, TONE y TIME, así que la rodilla también. Con SAT 6
llega en FEEDBACK 0,076; con SAT 1, en 0,456.

**Lo que se guarda no cambia.** `P.echo.fb` sigue siendo la posición de la
perilla: autoguardado, slots, JSON, presets y el hub C2 leen y escriben el
mismo número, que se interpreta con la escala nueva. En el grafo, `echoFB`
lleva la perilla y un GainNode nuevo en el lazo, `echoCap`, el factor del
techo (`echoSat → echoFB → echoCap → echoDelay`). Con **∞**, `echoFB` = 1,06 y
`echoCap` = 1: el lazo de siempre (1,06 × 2,7 × 1,256 = 3,6 con el patch de
fábrica). Al soltar ∞ los dos vuelven con la misma constante de tiempo que
antes (0,12 s).

**Lo que no se tocó:** ECHO THROW, KILL y MUTE (no están en el diff), los
presets, el formato de lo guardado, los bloques ZD y el adaptador C2. ∞
(`setFbInf`) y BURNOUT (`freshTails`) cambian solo para llevar también
`echoCap`: ∞ lo pone en 1, y BURNOUT lo desconecta y lo rearma con el lazo
nuevo. Su comportamiento es el de antes (`j4-mute` 15/15, `j4-cola` 4).

---

## 2 · Por qué el techo depende del TIME

El pedido decía "un techo menor que 1, el más alto que cumpla el criterio
(bajar de −60 dBFS en 30 s) con el delay más largo disponible". Medido, un
techo **fijo** no puede cumplir a la vez con eso y con el requisito 3
(FEEDBACK ≤ 0,25 sin cambios):

- Con el patch de fábrica, FEEDBACK 0,25 ya da un lazo de 0,25 × 2,7 × 1,256 =
  **0,848**. Para que no cambie, el techo tiene que estar por encima.
- El techo fijo más alto que cumple con el delay más largo queda por debajo:
  con el patch de fábrica, ~0,75 con TIME 2 s (con los 7 patches, 0,66,
  sección 3) y ~0,85 con TIME 1,2 s, el máximo de la perilla (0,85 tarda 28 s
  y 0,90, 34 s).
- Con un techo fijo de 0,85, el 75 % superior de la perilla movería el lazo de
  0,848 a 0,85: zona muerta, contra el requisito 2. Con 0,75, FEEDBACK 0,25
  tendría que bajar: contra el requisito 3.

Lo que cumple todo es que el techo dependa del TIME, con la regla de "la misma
caída por segundo". La razón es que el tiempo hasta −60 dBFS, a igual caída por
segundo, **crece con el delay**. Medido con el patch de fábrica y la perilla
al máximo (lazo = techo):

| Caída R | TIME 0,1 s | 0,38 s | 1,2 s | 2,0 s |
| --- | --- | --- | --- | --- |
| 1,0 dB/s | 6,0 s | 16,0 s | 31,2 s | 36,0 s |
| 1,25 dB/s | 6,0 s | 14,8 s | 27,6 s | 30,0 s |
| 1,5 dB/s | 6,0 s | 13,7 s | 24,0 s | 26,0 s |

En todo lo medido, el peor caso es el delay más largo: si R cumple ahí, cumple
con los TIME más cortos (`j4-cola` 1 lo controla en los 7 patches con su TIME
y con 2 s), y con los delays cortos el techo queda más alto: 0,924 con el
TIME de fábrica, que deja lugar para la rodilla en 0,86 y para el recorrido de
arriba de la perilla.

**El delay más largo disponible:** tomé **2 s**, el máximo del DelayNode y del
`cleanPatch`, que se puede cargar desde un JSON. La perilla TIME llega a
1,2 s y el hub C2 a 1,5 s (40 BPM). Si se toma 1,2 s como "el más largo", R
puede bajar y todas las colas se alargan: con el patch de fábrica a 1,2 s ya
cumple 1,25 dB/s (27,6 s), pero para los 7 patches no lo medí. A cambio, un
patch con TIME 2 s y la perilla al máximo pasaría de 30 s.

**El tope de 0,97** cuida los delays muy cortos. Con 1,8 dB/s y TIME 0,02 s
el techo sería 0,996, a 4 milésimas de 1, y el lazo real puede desviarse del
calculado (medido con la semilla de F2b: queda 0,1 dB *por debajo*, pero no
hay margen). Con 0,97 sobran −0,26 dB por repetición.

**La rodilla al 93 %**, para que el patch de fábrica conserve FEEDBACK 0,25
con margen: la rodilla queda en 0,86 contra el 0,848 de 0,25.

---

## 3 · La calibración: R = 1,8 dB/s

Medido con `node reports/F2c-cola.mjs --only calibrar --calibrar 1.6,1.7,1.8`
(el script fija el techo con cada R sin tocar el instrumento). Caso de diseño:
los 7 patches con la perilla FEEDBACK al máximo (lazo = techo) y TIME 2 s,
SIREN 1 s y soltar. Ventanas de una repetición (2 s), así que la resolución es
de 2 s. Nada crece en ningún caso (0,0 dB).

| Patch | R 1,6 dB/s | R 1,7 dB/s | **R 1,8 dB/s** |
| --- | --- | --- | --- |
| fábrica | 26 s | 24 s | 24 s |
| Classic Wail | 28 s | 26 s | 26 s |
| Police Alarm | 26 s | 24 s | 24 s |
| Acid Scream | 24 s | 22 s | 22 s |
| UFO Random | **30 s** | **30 s** | **28 s** |
| Cosmic Drone | 28 s | 26 s | 26 s |
| Feedback Dub | 28 s | 28 s | 26 s |

UFO Random (S&H, WOW 0,35, MIX 0,45) es el peor caso. Con 1,6 y 1,7 dB/s llega
a 30 s justos: con ventanas de 2 s, el cruce real cae entre 28 y 30 s, sin
margen. **1,8 dB/s es el techo más alto con margen** (28 s, una repetición
antes del límite), que da L = 0,661 con TIME 2 s. El mismo resultado dio un
barrido previo en otra corrida (UFO: 30,0 / 30,0 / 28,0 s, dos veces).

Fuera de este caso de diseño: con MIX al 100 % o VOLUME al máximo la cola
arranca más fuerte y tarda más en llegar a −60 dBFS. El criterio se fijó sobre
los 7 patches tal como vienen; no lo medí con esos extremos.

---

## 4 · Cómo cambió cada preset

Medido con `node reports/F2c-cola.mjs` (antes = `27707d5`, sin techo).
SIREN 1 s y soltar. "−40" y "−60": cuándo la salida baja de ese nivel en RMS y
ya no vuelve a subir. "No baja" quiere decir que a los 34 s seguía arriba. El
lazo es la ganancia de pequeña señal en el pico de los filtros.

| Preset | Lazo antes → ahora | Antes | Ahora | Ahora, perilla al máx. | Ahora, perilla al máx. y TIME 2 s |
| --- | --- | --- | --- | --- | --- |
| fábrica (0,38 s) | 1,43 → 0,87 | no baja (−12,5 dBFS) | −40: 5,7 s · −60: **9,1 s** | 6,8 · 12,5 s | 14,0 · 24,0 s |
| Classic Wail (0,38 s) | 1,53 → 0,88 | no baja (−10,7) | 6,8 · **11,4 s** | 9,1 · 16,0 s | 16,0 · 24,0 s |
| Police Alarm (0,28 s) | 0,85 → 0,85 | 4,5 · 7,8 s | 4,5 · **7,8 s** (igual) | 7,8 · 16,8 s | 12,0 · 24,0 s |
| Acid Scream (0,30 s) | 2,45 → 0,90 | no baja (−10,1) | 3,6 · **7,2 s** | 4,8 · 9,6 s | 12,0 · 22,0 s |
| UFO Random (0,44 s) | 1,87 → 0,87 | no baja (−8,6) | 9,2 · **15,8 s** | 11,9 · 21,1 s | 16,0 · 28,0 s |
| Cosmic Drone (0,60 s) | 1,51 → 0,84 | no baja (−10,6) | 10,8 · **18,0 s** | 13,2 · 24,0 s | 16,0 · 26,0 s |
| Feedback Dub (0,50 s) | 2,99 → 0,88 | no baja (−6,5) | 9,0 · **16,0 s** | 11,0 · 19,0 s | 16,0 · 26,0 s |

Nivel de la salida a los 5 / 10 / 20 / 30 s, ahora (antes, los cinco que no
bajaban se quedaban planos en el nivel de la columna "Antes"):

| Preset | 5 s | 10 s | 20 s | 30 s |
| --- | --- | --- | --- | --- |
| fábrica | −32,0 | −56,0 | −102 | −137 dBFS |
| Classic Wail | −29,0 | −48,5 | −91 | −129 |
| Police Alarm | −38,7 | −63,6 | −120 | −215 |
| Acid Scream | −41,5 | −67,4 | −104 | −140 |
| UFO Random | −20,7 | −37,6 | −70 | −98 |
| Cosmic Drone | −19,4 | −34,9 | −62 | −91 |
| Feedback Dub | −24,4 | −40,4 | −72 | −101 |

**Cómo cambia el carácter, para decidir si se retoca alguno:**

- **Police Alarm**: no cambia. Ya decaía y su FEEDBACK 0,3 queda bajo la
  rodilla (0,311): la misma salida, repetición por repetición (`j4-cola` 5).
- **Fábrica y Classic Wail**: de un eco infinito a −12 / −11 dBFS pasan a una
  cola de ~6–7 s audible (−40) y ~9–11 s hasta −60. Las primeras repeticiones
  suenan igual; lo que desaparece es el colchón infinito. Con la perilla al
  máximo, ~1,2–1,4 veces más largas.
- **Acid Scream**: el que más se acorta (3,6 s a −40). Tiene SAT 2,6 (pendiente
  3,9), así que con señal fuerte el lazo comprime mucho y las primeras
  repeticiones caen rápido. Antes autooscilaba a −10 dBFS. Si se quiere un eco
  más largo hay que bajar SAT, no subir FEEDBACK (ya está cerca del techo).
- **UFO Random y Cosmic Drone**: las colas más largas (9–11 s a −40, 16–18 s a
  −60). Cosmic Drone, con su release de 2,5 s y la reverb de 5,5 s, sigue
  siendo un colchón; solo que ahora termina.
- **Feedback Dub**: es el cambio de carácter más grande. Su nombre y su lazo
  (2,99, el más alto) sugieren que el eco desbocado era la idea, y ahora es una
  cola de 9 s a −40. **El desborde sigue estando, pero en ∞**: con ∞
  mantenido autooscila igual que antes. Si se quiere que este preset arranque
  "desbocado" sin apretar ∞, no se puede con un techo < 1; es decisión del
  usuario si se cambia su descripción o se le sube TIME/MIX para que la cola
  dure más dentro del techo.

Ningún preset se retocó.

---

## 5 · La perilla FEEDBACK, antes y ahora (patch de fábrica)

Medido con `node reports/F2c-cola.mjs --only perilla`. Patch de fábrica,
SIREN 1 s y soltar.

| FEEDBACK | Lazo antes | Antes: −60 dBFS | Lazo ahora | Ahora: −40 · −60 dBFS | Nivel a los 10 s, ahora |
| --- | --- | --- | --- | --- | --- |
| 0,1 | 0,34 | 2,3 s | 0,34 (igual) | 2,3 · 2,3 s | −246 dBFS |
| 0,25 | 0,85 | 8,0 s | 0,85 (igual) | 4,6 · 8,0 s | −61,1 |
| 0,4 | 1,36 | no baja (−13,1) | 0,87 | 5,7 · 9,1 s | −56,9 |
| 0,6 | 2,04 | no baja (−9,9) | 0,88 | 5,7 · 10,3 s | −53,6 |
| 0,8 | 2,71 | no baja (−9,1) | 0,90 | 5,7 · 10,3 s | −50,7 |
| 1,1 | 3,73 | no baja (−8,8) | **0,924** (techo) | 6,8 · 12,5 s | −46,7 |

Hasta 0,25 la perilla hace exactamente lo mismo (las repeticiones coinciden con
0,000 dB de diferencia, `j4-cola` 5). De 0,25 a 1,1, que hoy era todo
autooscilación (de −13 a −9 dBFS para siempre), la cola va de 8 a 12,5 s
hasta −60: crece en todo el recorrido (−61 → −47 dBFS a los 10 s), pero el
rango es acotado. Si se quiere más diferencia entre 25 % y 100 %, se puede
bajar la rodilla: más recorrido arriba, a cambio de que FEEDBACK 0,25 deje de
ser idéntico.

---

## 6 · Hallazgo sin arreglar: el filtro ladder da NaN con Acid Scream

**No es de este cambio ni de F2b, y no lo arreglé** (es el motor del filtro,
SPEC 3.1.4, y no era lo pedido). Lo encontré porque en la calibración algunas
tomas de Acid Scream daban −∞.

- **Qué pasa:** con Acid Scream (RESO 1,08 y ENV AMT 0,7, que barre el cutoff
  de 500 a ~8500 Hz en 4 ms), al tocar SIREN el worklet del filtro ladder a
  veces devuelve **NaN**. El NaN pasa al VCA, al eco, a la reverb y a la
  salida, y **J4 queda mudo hasta recargar la página**: el estado del filtro
  queda en NaN. Cambiar a Police Alarm y tocar otra vez no lo arregla.
  BURNOUT vacía el eco (vuelve a 0), pero el filtro y la salida siguen en NaN.
- **Cuánto:** con `224763d` (antes de F2b), 4 de 6 tomas; con `27707d5`, 2 de
  6; con el techo, 2 de 5 en la prueba de persistencia, 2 tomas descartadas
  antes de una buena en `j4-cola` y ninguna en las 7 tomas de Acid Scream de
  `F2c-cola.mjs`. Depende de en qué momento de la autooscilación del filtro
  cae la nota. El código del ladder no cambió desde `8bef265`.
- **Causa probable (leída en el código, no aislada):** la saturación del
  estado es `s3 = s3 − s3³/6`, que deja de ser monótona por encima de
  |s3| = √2 ≈ 1,4 y, si el estado pasa de √12 ≈ 3,5, cada muestra lo agranda
  (diverge). Con RESO 1,08 la realimentación del filtro llega a r ≈ 8 (a
  48 kHz) en la cima del barrido.
- **Propuestas, para decidir:**
  - (a) Guarda en el worklet: si el estado deja de ser finito, volverlo a 0.
    No cambia el sonido cuando el filtro es estable, pero el filtro "explota" y
    vuelve: puede oírse un clic donde hoy hay silencio para siempre.
  - (b) Cambiar la saturación del estado por una monótona (`tanh`): cambia el
    timbre de la autooscilación.
  - (c) Acotar la resonancia efectiva mientras barre el cutoff: cambia el
    sonido de Acid Scream.
- **En los tests:** `j4-cola` detecta las muestras no finitas apenas suena la
  nota, avisa y repite la toma (hasta 8 veces). Una toma con NaN no mide el
  eco.

---

## 7 · Tests antes y después

Chromium de Playwright, headless, `--autoplay-policy=no-user-gesture-required`.

| Test | Antes del techo (`27707d5`) | Después |
| --- | --- | --- |
| `j4-cola` 1 · 7 patches tal cual, perilla al máx. y perilla al máx. con TIME 2 s (21 tomas) | **falla**: 5 de 7 tal cual y los 14 con la perilla al máximo no bajan nunca de −60 dBFS (se quedan entre −6 y −16 dBFS) | ok: los 21 bajan en 7,2–28,0 s, sin crecer (0,0 dB) |
| `j4-cola` 2 · techo en el grafo (13 casos × 12 posiciones) | **falla**: con la perilla al máximo el lazo llega a 3,73 | ok: ≤ L, = L al máximo, creciente, igual bajo la rodilla |
| `j4-cola` 2b · techo medido con la semilla | **falla**: 3,67 | ok: 0,918 / 0,914 (techo 0,924) y 0,652 / 0,653 (techo 0,661) |
| `j4-cola` 3 · más perilla, cola más larga | **falla**: de 0,5 para arriba no baja | ok: −38,05 · −36,18 · −34,99 · −33,86 dBFS (2–20 s); −60 a 8,0 · 9,1 · 10,3 · 12,5 s |
| `j4-cola` 4 · ∞ | pasa la parte de ∞; **falla** al soltarlo (no decae) | ok: efectivo 1,06 en las dos versiones, RMS por segundo igual al centésimo (−8,44 … −8,82), al soltar ∞ baja de −60 a los 9,1 s |
| `j4-cola` 5 · feedback bajo | es la referencia | ok: 0,000 dB de diferencia en las 6, 22 y 28 repeticiones audibles |
| `j4-cola` 6 · valores guardados | **falla**: 0,9 se interpreta como 0,9 | ok: se guarda 0,9, se lee 0,9 y llega al lazo como 0,268; formato idéntico |
| `j4-reposo` | — | 6/6 |
| `j4-mute` | — | 15/15 (4: al soltar ∞, `echoFB` vuelve a la perilla) |
| `j4-verify` | — | 18/18 en las tres corridas |
| `zd-mobile-cycle --file …J4… --cycles 4` | — | 7/7 |
| `check-blocks` · `sync-blocks --check` | — | OK: ningún bloque modificado, 40 idénticos |

La columna "antes" sale de correr `j4-cola` contra el HTML sin el techo,
antes de `60f8ab0`. El caso 4 en esa corrida comparaba la forma de onda con
∞, y ahí vi que el lazo autooscilando no es repetible ni con el mismo código.
Lo cambié a ganancia efectiva y RMS antes de commitear el test, y después
corrí el caso 4 final contra el HTML viejo: pasa la parte de ∞ (1,06 y el
mismo RMS) y falla al soltarlo ("nunca" baja de −60 dBFS). El caso 3
cambió de métrica después (`80d86d2`, la energía de 0–30 s la dominaba la
nota).

**Fuera de las regiones ZD-BLOCK y sin tocar el adaptador C2.** El diff del
HTML contra `27707d5` tiene 7 hunks (líneas 3011, 3375–3418, 3427, 3431,
3437, 3456–3457 y 3529 del archivo nuevo); ninguno cae dentro de los 8 bloques
ZD. Los sha1 no cambian:

```text
<script> del adaptador C2   antes 57a88fb056b43b190a9e98ca7da9b7095fea1d62 · ahora 57a88fb056b43b190a9e98ca7da9b7095fea1d62
detección del hub           antes aa03e463802d2942748a5fc6b4494955b4eccbbf · ahora aa03e463802d2942748a5fc6b4494955b4eccbbf
líneas del diff que nombran HOST / C2_OUT / C2_CHANNEL / registerInstrument / zeroday_sync / SLOT_ID / ZD_M: 0
```

El hub C2 cambia TIME con `onTempo` (hasta 1,5 s); pasa por `applyEcho`, que
recalcula el techo.

Para repetir:

```text
node tools/tests/j4-cola.test.mjs            # 7 casos (~8 min)
node tools/tests/j4-reposo.test.mjs && node tools/tests/j4-mute.test.mjs && node tools/tests/j4-verify.test.mjs
node tools/tests/zd-mobile-cycle.test.mjs --file descargables/J4-Sirens_Station.html --cycles 4
node tools/check-blocks.mjs && node tools/sync-blocks.mjs --check
node reports/F2c-cola.mjs                    # secciones 4 y 5 (~7 min)
node reports/F2c-cola.mjs --only calibrar --calibrar 1.6,1.7,1.8   # sección 3 (~4 min)
```

---

## 8 · A verificar en dispositivo

Nada de esto se escuchó en hardware real, ni en WebKit ni en Firefox.
También quedó en [`docs/QA-dispositivos.md`](../docs/QA-dispositivos.md).

- [ ] **SIREN y soltar: el eco se apaga solo.** Con el patch de fábrica (sin
      sesión, o "Empezar de cero"), auriculares y volumen alto, el eco se
      oye unos 5–8 s y se apaga, sin crecer en el medio. Antes no se apagaba.
- [ ] **Recorrer los 6 presets** (SIREN 1 s y soltar en cada uno) y anotar si
      alguna cola quedó corta para lo que se busca: la sección 4 tiene los
      tiempos medidos, para decidir si se retoca algún preset.
- [ ] **FEEDBACK de 0 a 100 %** con la sirena latcheada: hasta ~25 % suena
      igual que antes; de ahí al máximo la cola se alarga de a poco, sin saltos
      y sin un tramo en el que la perilla no haga nada.
- [ ] **Con ∞ sigue autooscilando:** mantener FEEDBACK ∞ (botón o tecla 4)
      después de una nota. El eco crece y se sostiene fuerte (−8,8 dBFS
      medido, igual que antes); al soltarlo la cola se apaga sola.
- [ ] **TIME al máximo (1,2 s) y FEEDBACK al máximo:** la cola dura más, pero
      se apaga antes de ~25 s.
- [ ] **Abrir un patch o una sesión guardados antes de esta versión:** suenan
      igual que antes si su FEEDBACK estaba bajo, y con cola finita si se
      autosostenía.
- [ ] **Acid Scream varias veces seguidas (sección 6):** si en algún momento
      J4 queda mudo hasta recargar, es el bug del ladder, no el eco. Anotar en
      qué equipo pasa.
