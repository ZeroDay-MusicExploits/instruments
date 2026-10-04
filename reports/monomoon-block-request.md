# Pedidos de cambio a bloques — sesión MonoMoon'70

Rama `c-monomoon` · 2026-10-04. No toqué ningún bloque: los 8 están pegados
byte a byte desde `tools/blocks/` y `node tools/check-blocks.mjs` da verde.
Ninguno de los dos pedidos me bloqueó. El 1 tiene un workaround local en
MonoMoon. El 2 no lo necesita: es visual y el botón muerto termina en un toast.

| # | Bloque | Severidad | Workaround en MonoMoon |
|---|---|---|---|
| 1 | `zd-rec` v1 | Media: se puede perder una toma de 10 min | Sí (`stop()` dentro de `onLimit`) |
| 2 | `zd-pwa` v2 | Baja: banner con un botón que ya no instala | No hace falta |

---

## 1 · `zd-rec` v1: al llegar a `maxSec`, el resultado de la toma se descarta

**Qué pasa.** Cuando la grabación llega al tope, el bloque hace esto (modo
worklet, en `node.port.onmessage`; en modo MediaRecorder es igual, en un
`setTimeout`):

```js
if (frames / sampleRate >= maxSec) { if (cfg.onLimit) cfg.onLimit(maxSec); stop(); }
```

`stop()` arma el WAV y devuelve `Promise<{ blob, duration, … }>`, pero ese
valor de retorno no lo recibe nadie. Además, `stop()` vacía `chunks` y deja
`state = 'idle'`, así que si el instrumento llama a `rec.stop()` *después*
(por ejemplo, desde su botón ■ o desde un toast "se cortó la toma"), recibe
`null`. **La toma de 10 minutos se pierde** salvo que el instrumento llame a
`rec.stop()` *de forma sincrónica dentro de* `onLimit`, antes del `stop()`
interno. Eso no está documentado en `docs/zd-blocks.md`: la doc muestra
`onLimit: max => {}` como un aviso.

**Reproducción** (consola de cualquier instrumento con el bloque y audio andando):

```js
const rec = ZD.rec.create({ getContext: () => ctx, getSource: () => master, maxSec: 1,
  onLimit: () => console.log('tope') });            // solo avisa, como en la doc
await rec.start();
// … esperar 1,5 s
await rec.stop();   // → null: el WAV de 1 s ya no existe
```

**Workaround en MonoMoon** (`startTake()`): `onLimit` llama a `stopTake()`,
que llama a `wavRec.stop()` de forma sincrónica. Ese `stop()` gana, toma los
chunks y el `stop()` interno encuentra `state !== 'rec'` y devuelve `null`. Lo
cubre `reports/monomoon-verify.mjs` («al llegar al tope la toma no se pierde»,
con `maxSec` forzado a 1 s).

**Arreglo propuesto** (cualquiera de los dos, sin romper la API):

- a) Guardar el resultado del corte automático y entregarlo en el próximo
  `stop()`:
  ```js
  var limitResult = null;
  // en el tope:
  if (cfg.onLimit) cfg.onLimit(maxSec);
  if (state === 'rec') limitResult = stop();        // Promise<resultado>
  // y en stop():
  if (state !== 'rec') { var r = limitResult; limitResult = null; return r || Promise.resolve(null); }
  ```
- b) Pasar el resultado a `onLimit`: `cfg.onLimit(maxSec, stop())`, y documentar
  que el instrumento lo recibe ahí.

La a) es la que menos cambia el uso: el ■ del instrumento sigue funcionando
igual aunque llegue tarde. Afecta a Nebularp y J4, que también graban en vivo.

---

## 2 · `zd-pwa` v2: después de `prompt()` el banner queda visible y su botón ya no instala

**Qué pasa.** `doInstall()` llama a `deferredPrompt.prompt()`, y al resolver
`userChoice` hace `deferredPrompt = null; refreshAll();`. `refreshAll()`
actualiza el ítem del menú, el ícono ↓ y el botón de escritorio, pero **no el
banner**. Si el usuario cierra el diálogo nativo (`outcome: 'dismissed'`), el
banner sigue en `#zd-stage` con «↓ Instalar». Al tocarlo otra vez,
`variant()` ya da `null` y sale el toast «Usá el menú del navegador para
instalar esta app». No se rompe nada (no hay segundo `prompt()`; lo verifiqué),
pero el banner ocupa ~82 px de la zona de tocar hasta que se toca «Ahora no».

**Reproducción** (360×640, `beforeinstallprompt` sintético con
`userChoice = { outcome: 'dismissed' }`): clic en «↓ Instalar» → `prompt()` se
llama una vez → el banner sigue visible.

**Arreglo propuesto.** En el `finally` de `doInstall()`, si ya no hay variante,
esconder el banner (sin marcar "Ahora no", así vuelve si el navegador vuelve a
mandar el evento):

```js
deferredPrompt = null; refreshAll();
if (!variant()) hideBanner();   // o el nombre que tenga la función que lo saca
```

Afecta igual a los 5 instrumentos; en Acid pasa lo mismo.

---

## Notas (no son pedidos)

- `zd-audio.bindGesture()` llama a `unlock()` → `ensure()` en **cualquier**
  gesto, incluido abrir una tab o el menú. En MonoMoon eso enciende el motor (y
  esconde el overlay "Pulsá para encender") con el primer toque en cualquier
  lado. Es lo que pide SPEC R5 y está bien, pero conviene saberlo: un
  instrumento con overlay de encendido lo pierde como "puerta".
- `ZD.rec.card()` tiene un solo botón de descarga. MonoMoon necesita además
  «↓ MIDI DE LA TOMA» (el MIDI sale de la misma toma) y lo pone afuera, debajo
  de la tarjeta. Si Nebularp y J4 hacen lo mismo, quizá valga un
  `extraActions: [{ label, onClick }]` en la tarjeta.
- `zd-store.open({ migrate })`: el envoltorio que devuelve `migrate` no se
  guarda solo; el instrumento tiene que llamar a `saveNow()` después de
  restaurarlo. Está bien que sea así (el instrumento decide), pero la doc
  podría decirlo en la línea de `migrate`.
