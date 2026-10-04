# Logs de la sesión D1 (2026-10-04)

Salida de las corridas de la sesión D1 (`tee`). Formato TAP de `node:test`.

**Qué se conserva.** Solo `LEEME.md`, `3/RESUMEN.txt` y los logs `1a`–`1d`
(antes y después de cada arreglo de bloque). El resto de la salida de la sesión
se borró con `git rm` (`0-base/`, `2-*`, `3/*` salvo el resumen, `4-*`, o sea
los `cycle-*`, `*-verify-*`, `nebularp-rotacion-*` y `run*`): era repetición de
corridas en verde y sigue en el historial de git. Los números de esas corridas
están en la tabla de abajo y en `3/RESUMEN.txt`.

| Archivo | Qué es |
|---|---|
| `1a-zd-rec-*.log`, `1b-zd-ui-*.log`, `1c-zd-pwa-*.log`, `1d-zd-audio-*.log` | Tarea 1. Cada test nuevo **antes** (bloque viejo, falla) y **después** del arreglo en `tools/blocks/`. Los tests que además corren sobre los instrumentos publicados siguen en rojo en el "después" hasta el sync. |
| `3/RESUMEN.txt` | Tarea 3: el exit code y el conteo de cada corrida (tres seguidas de cada script y 20 de la rotación de tablet de Nebularp). |
| *(borrados)* `0-base/` | Antes de tocar nada (`main` en `0f6e507`): `run.mjs`, los 4 verify y `zd-mobile-cycle` de los 5. Todo en verde. |
| *(borrados)* `2-*` | Tarea 2: `sync-blocks`, `check-blocks`, `sync-blocks --check` y los tests que esperaban el sync, ya en verde. |
| *(borrado)* `4-barrido-verify.log` | Tarea 4: las mediciones de `reports/D1-barrido-verify.mjs` (se reproducen corriéndolo). |

Los scripts `*-verify` viven desde ahora en `tools/tests/*-verify.test.mjs`
(antes en `reports/`); ver `docs/tests.md`.

## Resultado de la tarea 3

| Script | Corridas | Resultado |
|---|---|---|
| `node tools/tests/run.mjs` (8 archivos, 52 tests) | 3 | 3/3 verde |
| `zd-mobile-cycle --cycles 4`, los 5 instrumentos | 3 × 5 | 15/15 verde |
| `tools/tests/nebularp-verify.test.mjs` | 3 | 3/3 verde (17) |
| `tools/tests/j4-verify.test.mjs` | 3 | 3/3 verde (18) |
| `tools/tests/monomoon-verify.test.mjs` | 3 | **3/3 rojo**, 1 test (ver abajo) → adaptado: 3/3 verde (23) |
| `tools/tests/cronbeat-verify.test.mjs` | 3 | **3/3 rojo**, 1 test (ver abajo) → adaptado: 3/3 verde (24) |
| Nebularp · rotación de tablet, sola | 20 | 20/20 verde |

### Las dos fallas: es el test, no el bloque

Las dos son el mismo cambio buscado de `zd-pwa` v3 (rechazar el diálogo nativo
cuenta como "Ahora no"), y los dos tests afirmaban el comportamiento que las
propias sesiones habían reportado como bug:

- `cronbeat-verify.test.mjs:256` · `CronBeat · Instalar llama a prompt() una sola vez`
  → `page.click: Timeout 30000ms exceeded … waiting for locator('.zd-pwa-banner').locator('text=/Instalar/')`
  en `:273`. El test hacía un segundo clic en el "↓ Instalar" del banner
  después de rechazar el prompt (su comentario decía "rechazado: el banner
  queda (ver reports/cronbeat-block-request.md, punto 3)"). Con v3 el banner ya
  no está.
- `monomoon-verify.test.mjs:182` · `MonoMoon · R2 · el banner no tapa REC…`
  → `page.click: Timeout 30000ms exceeded … waiting for locator('.zd-pwa-banner .zd-pwa-later')`
  en `:200`. Su `beforeinstallprompt` sintético rechaza el prompt; con v3 eso
  guarda `zd:pwa:dismissed` y el banner no vuelve al mandar otro evento, así que
  no hay "Ahora no" para tocar.

Fallaron igual en las 3 corridas (deterministas). La adaptación es mínima:
afirmar lo nuevo (sin banner, `zd:pwa:dismissed` guardado) y borrar esa clave
antes de probar "Ahora no", que sigue cubierto igual que antes.

### Rotación de Nebularp

20/20 en verde corriendo solo el caso
(`node --test-name-pattern="rotación de tablet" tools/tests/nebularp-verify.test.mjs`),
más 3/3 dentro de las corridas completas. La falla de la sesión C (1 de 8, sin
mensaje) no se reprodujo. Dos puntos del test que podrían explicarla bajo
carga, sin confirmar: exige que el arpegio programe al menos una voz nueva en
cada ventana de 350 ms después de un resize (`s.starts > starts`), y cuenta
como error cualquier `console.warning` de la página (no solo errores).
