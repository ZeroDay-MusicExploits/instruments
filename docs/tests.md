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
| `zd-mobile-cycle.test.mjs` | Conformidad de `zd-mobile` para cualquier instrumento (`--file`, `--cycles`). | sí |
| `acid-verify.test.mjs` | Verificación completa de Acid Bass-303 (el piloto). | sí |
| `cronbeat-verify.test.mjs` | Verificación completa de CronBeat-8:08: 24 casos (R1–R5, C2 simulado, extras). | sí |
| `monomoon-verify.test.mjs` | Verificación completa de MonoMoon'70: 23 casos. | sí |
| `nebularp-verify.test.mjs` | Verificación completa de Nebularp 2035: 17 casos (incluye la rotación de tablet). | sí |
| `j4-verify.test.mjs` | Verificación completa de J4-Sirens Station: 18 casos. | sí |

Los `*-verify` comparten el molde de `acid-verify`: viewports de SPEC R1
(360×640, 390×844, 430×932, 768×1024, 844×390, desktop), banner de instalación
con `beforeinstallprompt` sintético, standalone, iframe, `file://` y registro
del service worker sobre http, autoguardado y migración, exportación
JSON/MIDI/WAV (MIDI parseado con `lib/smf.mjs`), audio con wake lock y
suspend/resume, rotación de tablet sonando y un hub C2 simulado con el diff del
adaptador C2. Cada instrumento suma lo propio (ver el encabezado de su archivo).

Los helpers están en `tools/tests/lib/` (`serve.mjs`: servidor estático bajo
`/instruments/` como GitHub Pages; `load-block.mjs`, `block-page.mjs`, `smf.mjs`,
`acid-midi.mjs`).

## Notas

- Los `*-verify` de CronBeat y J4 comparan el adaptador C2 contra el commit
  `8bef265` con `git diff`, así que necesitan el historial completo (no sirven
  con un clon superficial).
- Chromium headless arranca todo `AudioContext` en `running`: lo que depende de
  la política de gestos de iOS se **emula** y **no reemplaza** la prueba en un
  iPhone (ver `docs/QA-dispositivos.md`).
- `reports/D1-barrido-verify.mjs` no es un test: mide (no falla) los puntos b y
  c de `reports/D1-barrido.md`, cuyos números de línea son de un commit
  concreto. Por eso sigue en `reports/`.
- Un test de la corrida completa puede fallar por carga de la máquina sin que
  haya un bug (por ejemplo la rotación de Nebularp: ver `reports/D1-logs/LEEME.md`).
  Antes de culpar al código, correrlo solo con `--only`.
