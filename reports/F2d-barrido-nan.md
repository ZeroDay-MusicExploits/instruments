# F2d · Barrido de NaN en Acid, Nebularp y CronBeat (sin arreglar)

Fecha: 2026-10-06 · rama `main`. Parte 3 de F2d (J4 en [`F2d.md`](F2d.md),
MonoMoon en [`F2d-monomoon.md`](F2d-monomoon.md)). Pedido: el mismo fuzz
determinista sobre los filtros y osciladores de estos tres, **sin arreglar
nada**, y por instrumento: ¿salida siempre finita?, ¿silencio permanente?, y la
combinación de parámetros que lo dispara.

Todo medido en Chromium (Playwright, headless). No se tocó ningún instrumento.

---

## 0 · Resumen

| Instrumento | Fuzz de 10 min (44,1 kHz) | Silencio permanente | Lo que encontré leyendo el motor |
| --- | --- | --- | --- |
| **Acid Bass-303** | finita (0 en 3 001 acciones) | no a 44,1 kHz. **Sí a 22,05 kHz** | **NaN con sampleRate < 32 kHz**: el corte llega a 16 kHz y, pasado Nyquist, el SVF (`acid-svf`) diverge. En el navegador a 22,05 kHz: NaN a los 6,1 s con CUTOFF 2 773 Hz y RESO 30 %, y queda mudo sin recargar. A 32, 44,1, 48 y 96 kHz no |
| **Nebularp 2035** | finita (0 en 2 942 acciones); también a 22,05 kHz | no | Solo nodos nativos; el lazo del delay queda < 1 (0,85 × pico de 1,12 del lowpass = 0,95) |
| **CronBeat-8:08** | finita (0 en 2 937 acciones, 76 sliders con FX); también a 22,05 kHz | no | Solo nodos nativos; delay ≤ 0,9 sin filtro en el lazo; phaser 4 allpass × ≤ 0,9 |

## 1 · Cómo se midió

`node reports/F2d-barrido-nan.mjs` (no es un test; no arregla nada). El fuzz es
el mismo para los tres y no conoce el motor: va por la UI.

- **Controles:** cada perilla (`role=slider`, por teclado: Inicio, Fin, RePág,
  AvPág, como `ZD.ui.a11ySlider`) y cada slider (`input type=range`, valor +
  `input`), con 40 % de los movimientos a un extremo (0 o 100 %). En CronBeat
  el fuzz rota entre las pestañas Secuenciador, Pads y FX (los sliders de
  reverb, delay, phaser y drive están en FX).
- **Botones:** modo de filtro, onda y octava del sub, RANDOM y MUTAR (Acid);
  patrón, subdivisión, octavas, escala y Euclid (Nebularp); carácter del drive
  y pestañas (CronBeat). Transporte (parar y volver a tocar). En Nebularp, las
  teclas del acorde (con LATCH).
- **Siempre sonando:** Acid con el secuenciador, Nebularp con el arpegiador y
  un acorde latcheado, CronBeat con el patrón.
- **Grilla determinista** antes del fuzz, sonando: los controles de filtro en
  0, 25, 50, 75 y 100 % (Acid: CUTOFF × RESO, con DRIVE y FUZZ al mínimo o al
  máximo; Nebularp: Cutoff; CronBeat: Repetición del delay × realimentación del
  phaser, con el tono del drive).
- **Sonda:** muestras no finitas, pico y RMS de la salida por bloque; la primera
  no finita con las últimas acciones; errores y warnings de consola.
- **Silencio permanente:** al final, sin recargar, volumen y corte al 75 %,
  parar y volver a tocar, y 2 s de medición.
- Semilla fija por instrumento; 10 minutos reales cada uno, en paralelo;
  sampleRate el de esta máquina (44,1 kHz) salvo donde se dice.

Además leí el código de cada filtro y oscilador y probé los worklets de Acid en
Node con el código real (sección 2.1).

## 2 · Por instrumento

### 2.1 · Acid Bass-303

**Fuzz (44,1 kHz):** 10 min, 3 001 acciones sobre 14 perillas y 2 sliders, la
grilla CUTOFF × RESO + DRIVE + FUZZ, los 3 modos de filtro, las 4 ondas, el
sub, RANDOM y MUTAR: **0 muestras no finitas.** Al
final, sin recargar, suena (−4,4 dBFS RMS). Consola limpia. (En el último
minuto del fuzz, 88 de 240 ventanas de 0,25 s estaban en silencio digital: el
fuzz deja VOLUME o CUTOFF en 0 y el secuenciador tiene silencios; con volumen y
corte al 75 % vuelve a sonar.)

**El motor:** `acid-osc` (PolyBLEP, `dt` acotado a 0,5, frecuencia del
AudioParam acotada a 20–8 000 Hz) y `acid-svf` (SVF trapezoidal de Simper, con
`tanh` a la entrada y `k ≥ 0,03`). El SVF es estable mientras
`g = tan(π·fc/sr)` sea positiva, o sea **con el corte por debajo de Nyquist**.
El corte del filtro llega a 16 kHz (CUTOFF hasta 8 kHz × la envolvente, con
`clamp(…, 30, 16000)`), y el worklet no lo acota a Nyquist. Medido en Node con
el código real (`node reports/F2d-barrido-nan.mjs --only nodo`):

| sampleRate | Barrido 16 kHz → 30 Hz (LP/BP/HP, RESO 0 · 0,62 · 1) | Corte fijo, RESO 1, LP |
| --- | --- | --- |
| 22 050 Hz | **NaN** en 7 de 9 combinaciones (BP y HP con RESO 1 llegan a 1e9) | **NaN** con el corte ≥ 12 kHz; ok hasta 11 025 Hz |
| 32 000 Hz | ok (pico ≤ 3,7) | ok |
| 44 100 / 48 000 / 96 000 Hz | ok | ok |

`acid-osc` en los extremos (las 4 ondas, 20–8 000 Hz, detune +4 800 ¢, PWM
0,02, unison 7, spread 60 ¢, sub −2 oct al máximo), a 22,05, 44,1 y 48 kHz:
siempre finito, pico 2,95.

**En el navegador a 22,05 kHz** (`--only acid --sr 22050`, el instrumento
real): la grilla da **NaN a los 6,1 s, poco después de llevar CUTOFF a
2 773 Hz** (en el paso con RESO 30 %; el anterior, con RESO 0 %, duró 0,3 s
sin NaN). Con ENV MOD en 55 % y ACCENT, el
pico de la envolvente es CUTOFF × 2^(0,55 × 3,2 + 0,8 + 0,6 × 1,1) ≈ CUTOFF × 9,3
para las notas acentuadas: con CUTOFF 2,8 kHz pasa de 16 kHz (se acota ahí),
muy por encima de Nyquist (11 025 Hz). **Es permanente:** el estado del SVF
queda en NaN; al final, con CUTOFF y VOLUME al 75 %, parar y volver a tocar,
sigue en NaN (en el último minuto, 239 de 240 ventanas en silencio). El patch
por defecto (CUTOFF 218 Hz, pico ≈ 2 kHz) sigue finito a 22,05 kHz.

**Combinación que lo dispara:** un `AudioContext` a menos de 32 kHz y un pico
del corte por encima de Nyquist. A 22,05 kHz el riesgo empieza con CUTOFF desde
~1,2 kHz en las notas acentuadas (×9,3) o ~3,3 kHz sin acento (×3,4, con ENV MOD
en 55 %); medido, con 2,8 kHz y RESO 30 % alcanza. En Node diverge con RESO 0 y
con RESO 1, en LP, BP y HP (cuanto más tiempo pasa el corte sobre Nyquist, más
seguro). Un `AudioContext` a esa frecuencia es raro (los navegadores toman la
del dispositivo de salida; 44,1 o 48 kHz casi siempre), pero puede pasar si el
sistema saca el audio por un auricular Bluetooth en perfil de llamada; no lo
verifiqué.

**No lo arreglé** (parte 3). El arreglo mínimo sería acotar `fc` a
sampleRate / 2 dentro del worklet (`if(fc > sr/2) fc = sr/2`): con el corte en
Nyquist el SVF queda finito (medido: 11 025 Hz a 22,05 kHz), y a 32 kHz o más
el corte (≤ 16 kHz) nunca pasa de ahí, así que el sonido queda bit a bit igual.
J4 (0,45 × sr) y MonoMoon (0,99 × Nyquist) ya lo acotan.

**Arreglado en F2e** ([`F2e.md`](F2e.md)): el tope quedó en 0,45 × sampleRate
(a sr/2, tan(π/2) se dispara). A 44,1 kHz o más es idéntico; a 32 kHz cambian
las tomas con el corte sobre 14,4 kHz; a 22,05 kHz ya no hay NaN.

### 2.2 · Nebularp 2035

**Fuzz (44,1 kHz):** 10 min, 2 942 acciones sobre 30 perillas, la grilla de
Cutoff, patrón, subdivisión, octavas, escala, Euclid y teclas del acorde.
**0 muestras no finitas.** Al final, sin recargar, suena (−11,2 dBFS). Consola
limpia.

**El motor:** solo nodos nativos (osciladores, BiquadFilter, delays, convolver,
compresor); no tiene worklet de audio propio. El único lazo es el ping-pong
delay: `dR → lowpass 3 400 Hz → dFb (≤ 0,85) → dL`. El lowpass de Web Audio
con Q por defecto (1 dB) tiene un pico de 1,12, así que la ganancia del lazo
no pasa de 0,95: decae siempre. No encontré combinación que lo dispare.

**A 22,05 kHz** (2 min, 597 acciones): 0 muestras no finitas y suena al final.
La consola avisa `BiquadFilter.frequency … 12000 outside nominal range [0,
11025]; value will be clamped`: los BiquadFilter nativos recortan el corte a
Nyquist por su cuenta, que es lo que le falta al worklet de Acid.

### 2.3 · CronBeat-8:08

**Fuzz (44,1 kHz):** 10 min, 2 937 acciones sobre los 76 sliders de las
pestañas Secuenciador, Pads y FX (reverb, delay, phaser, drive, mezcla y
envíos por pista), el carácter del drive y la grilla Repetición del delay ×
realimentación del phaser con el tono del drive al mínimo o al máximo. **0
muestras no finitas.** Al final, sin recargar, suena (−33,3 dBFS). Consola
limpia. (Una primera corrida solo veía los 34 sliders del Secuenciador, porque
los de FX están en otra pestaña: también 0 en 10 min y 2 407 acciones.)

**El motor:** nodos nativos. Delay: `dlyBus → lowpass (tono) → delay → dFb (≤ 0,9)
→ delay`: el filtro está fuera del lazo y la ganancia del lazo es ≤ 0,9.
Phaser por pista: 4 allpass (|H| = 1) → `pfb` (≤ 0,9) → delay de 1,5 ms → al
primero: lazo ≤ 0,9. Drive: WaveShaper (acotado) + lowpass. Reverb: convolver.
No encontré combinación que lo dispare. A 22,05 kHz (2 min, 579 acciones): 0
muestras no finitas, suena al final.

## 3 · Para repetir

```text
node reports/F2d-barrido-nan.mjs                          # los 3, 10 min cada uno, en paralelo
node reports/F2d-barrido-nan.mjs --only acid --sr 22050 --minutes 2
node reports/F2d-barrido-nan.mjs --only nebularp,cronbeat --sr 22050 --minutes 2
node reports/F2d-barrido-nan.mjs --only nodo                # los worklets de Acid en Node
```

## 4 · A verificar en dispositivo

- [ ] **Acid con un auricular Bluetooth en modo llamada** (o cualquier salida a
      menos de 32 kHz): CUTOFF y ENV MOD altos con el secuenciador sonando. Si
      se queda mudo hasta recargar, es la sección 2.1. Anotar el equipo y la
      frecuencia de muestreo de un WAV grabado con REC en ese momento (va en la
      cabecera del archivo: es la del AudioContext).
