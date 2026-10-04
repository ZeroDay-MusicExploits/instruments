# Pedidos de cambio a bloques — sesión CronBeat

Ninguno bloqueó un requisito. CronBeat lleva los 8 bloques **byte a byte**
(`node tools/check-blocks.mjs` y `node tools/sync-blocks.mjs --check` en
verde). Los tres pedidos son de prioridad baja: el 1 tiene un workaround local
en el instrumento y se puede cerrar solo con documentación; el 2 y el 3 no
afectan a CronBeat más allá de lo que se describe.

## 1. `zd-mobile` v4 — el contenedor que se esconde está fijo en `.wrap`

**Qué pasa.** El CSS del bloque esconde `html.zd-m .wrap{display:none!important}`
y el test `zd-mobile-cycle` verifica que los nodos de `keep` vuelvan a quedar
dentro de `.wrap` (`e.closest('.wrap')`). Un instrumento cuyo contenedor
principal se llama de otra forma no se entera hasta que lo prueba.

**Reproducción.** CronBeat antes de esta sesión: el chasis es
`<div class="machine">`. Con el shell activo (390×844) el `.machine` sigue
renderizado debajo del shell fijo: se ve en los huecos de `#zd-stage` (no tiene
fondo) y `zd-mobile-cycle` falla en `inWrap` ("los nodos de keep tienen que
volver a .wrap").

**Workaround aplicado.** `<div class="machine wrap">` (CronBeat no tenía reglas
para `.wrap`). Sin cambios en el bloque.

**Arreglo propuesto** (una de las dos):

- Solo docs: agregar al checklist de `docs/zd-blocks.md` el paso "el contenedor
  principal del instrumento lleva la clase `.wrap`".
- Configurable: `ZD_M.root` (selector, por defecto `'.wrap'`). El bloque
  inyecta la regla de ocultar para ese selector y el test lo lee de la config.

## 2. `zd-audio` v1 — `onResumed` corre en cada gesto, no solo al reanudar

**Qué pasa.** `unlock()` llama a `cfg.onResumed()` también cuando el contexto
**ya estaba** en `running`, y `bindGesture()` llama a `unlock()` en cada
`pointerup`, `click`, `keydown` y `touchend`. O sea: `onResumed` corre en cada
toque, no solo cuando hubo una reanudación.

**Reproducción** (medida en Chromium sobre CronBeat, escritorio):
`ZD.audio.attach({ onResumed: () => n++ })` con `bindGesture(window)` ya
enganchado, y 6 clics en un botón cualquiera: `n` vale **12**. Cada clic
dispara `pointerup` y `click`, y los dos llaman a `unlock()`, que con el
contexto ya en `running` vuelve a llamar a `onResumed`.

**Impacto en CronBeat.** Ninguno: su `onResumed` (`resyncSamples()`, que vuelve
a decodificar a la frecuencia real los samples restaurados antes del primer
gesto) es idempotente a propósito. Un instrumento que haga trabajo no
idempotente ahí (por ejemplo, reiniciar un LFO o mostrar un toast) lo repetiría
en cada toque.

**Arreglo propuesto.** Recordar el estado anterior y llamar a `onResumed` solo
en la transición a `running` (de `suspended`/`interrupted` o en el primer
destrabe), o bien documentar en `docs/zd-blocks.md` que el callback es "después
de cada destrabe exitoso" y tiene que ser idempotente.

## 3. `zd-pwa` v2 — después de rechazar el prompt nativo el banner sigue ofreciendo "↓ Instalar"

**Qué pasa.** Con `userChoice.outcome === 'dismissed'` el bloque esconde el ↓ de
la barra y el ítem del menú, pero el banner queda montado con su botón
"↓ Instalar". Como el `beforeinstallprompt` ya se usó, un segundo clic no llama
a `prompt()` (bien) y muestra el toast "Usá el menú del navegador para instalar
esta app". El usuario acaba de decir que no y el banner se lo vuelve a ofrecer
con un botón que ya no instala.

**Reproducción** (medida igual en CronBeat y en Acid, 390×844):
`beforeinstallprompt` sintético con `userChoice` → `dismissed`, clic en
"↓ Instalar" → `prompt()` ×1, el banner sigue; segundo clic → `prompt()` sigue
en 1 y aparece el toast. Con `accepted`, el banner se va.

**Impacto.** Solo UX; no tapa nada (el banner vive en `#zd-stage`). Workaround:
ninguno, el usuario lo cierra con "Ahora no".

**Arreglo propuesto.** Si el resultado del prompt es `dismissed`, tratarlo como
"Ahora no": desmontar el banner y guardar `zd:pwa:dismissed` (14 días).
