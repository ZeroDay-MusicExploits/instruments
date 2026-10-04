# J4-Sirens Station: pedido de cambio a bloques

Rama `c-j4` · 2026-10-04. No toqué ningún bloque. Lo que sigue lo encontré al
cablear REC en J4. El workaround vive en el instrumento y no bloquea ningún
requisito.

## 1 · `zd-rec` v1: al llegar al tope (`maxSec`) la toma se pierde si `onLimit` solo avisa

**Qué pasa.** Cuando la captura llega a `maxSec`, el bloque llama a
`cfg.onLimit(maxSec)` y enseguida a su propio `stop()`:

```js
// rama worklet
if (frames / sampleRate >= maxSec) { if (cfg.onLimit) cfg.onLimit(maxSec); stop(); }
// rama MediaRecorder
setTimeout(function () { if (state === 'rec') { if (cfg.onLimit) cfg.onLimit(maxSec); stop(); } }, maxSec * 1000);
```

La promesa de ese `stop()` interno, que trae el `{ blob, duration, … }`, se
descarta. Después el instrumento llama a `rec.stop()`, pero el estado ya es
`idle` y vuelve `null`. La documentación (`docs/zd-blocks.md`) muestra
`onLimit: max => {}` como un aviso, así que leída al pie de la letra la toma
de 10 minutos se tira entera.

**Reproducción** (sobre el piloto, el bloque es el mismo byte a byte; Chromium
con `--autoplay-policy=no-user-gesture-required`):

```js
const c = new AudioContext(); await c.resume();
const o = c.createOscillator(); o.start();
const rec = ZD.rec.create({ getContext: () => c, getSource: () => o, maxSec: 1, onLimit: () => {} });
await rec.start();
await new Promise((r) => setTimeout(r, 1600));
await rec.stop();   // -> null: la toma de 1 s no está en ningún lado
```

Resultado medido:

```text
A (onLimit solo avisa):     en onLimit → sin resultado · stop() después del tope → null
B (onLimit llama a stop()): en onLimit → 1.00 s, 176684 B · stop() después del tope → null
```

**Workaround en J4 (sin tocar el bloque).** `onLimit` llama a `stopRec()` del
instrumento, que hace `recorder.stop()` de forma sincrónica antes de cualquier
`await`. Como `onLimit` corre antes del `stop()` interno, el del instrumento
gana y se queda con la toma. El `stop()` interno encuentra el estado en
`stopping` y no hace nada. Funciona en las dos ramas, pero depende del orden
de dos líneas del bloque.

**Arreglo propuesto (v2).** Que el bloque entregue el resultado del corte
automático y que `stop()` no pierda una toma ya cerrada:

```js
// create({ ..., onLimit(max, result) }) — result es lo mismo que resuelve stop()
function autoStop() {
  var p = stop();
  p.then(function (res) { if (cfg.onLimit) cfg.onLimit(maxSec, res); }, function () {});
}
// rama worklet:      if (frames / sampleRate >= maxSec) autoStop();
// rama MediaRecorder: setTimeout(function () { if (state === 'rec') autoStop(); }, maxSec * 1000);
```

Además, guardar el último resultado en una variable `last` y que
`stop()` con `state === 'idle'` devuelva `Promise.resolve(last)` en vez de
`null`. Con eso, un instrumento que solo muestra un aviso en `onLimit` y llama
a `stop()` cuando el usuario toca ■ sigue recibiendo la toma. Para J4 alcanza
cualquiera de las dos mitades; con la primera, el workaround se puede sacar.

Afecta a quien use `ZD.rec.create` con captura en vivo: hoy J4 y Nebularp
(SPEC R4, "REC posta"). Acid usa solo `ZD.rec.card`.
