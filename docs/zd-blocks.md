# Bloques `ZD` · API y cómo pegarlos

Los 8 bloques compartidos que piden SPEC 3.1.2 y 3.4. Se copian **byte a byte
idénticos** en los 5 `descargables/*.html`: no llevan ni un selector, ni un
texto, ni un slug del instrumento — todo entra por configuración. Se verifican
con `node tools/check-blocks.mjs`.

La copia canónica de cada bloque está en `tools/blocks/<nombre>.html`, lista
para pegar tal cual (incluye el `<script>` que la envuelve). `check-blocks`
compara los 5 HTML entre sí **y** contra esa copia.

Un bloque es el tramo que va de `/* ZD-BLOCK:<nombre> v<n> */` a
`/* /ZD-BLOCK:<nombre> */`, ambos incluidos, una sola vez por archivo.

## Dónde van

Los 8 van **en el `<head>`**, en este orden, después de los `<style>` del skin
y **antes** del `<script>` del instrumento:

```
zd-ui → zd-store → zd-audio → zd-dl → zd-midi → zd-rec → [config ZD_M] → zd-mobile → zd-pwa
```

Por qué en el `<head>` y no antes de `</body>`:

- `zd-ui` y `zd-mobile` inyectan su CSS de forma sincrónica. En el `<head>` no
  hay destello del layout de escritorio antes de que entre el shell.
- `zd-mobile` agrega `zd-m` a `<html>` en el acto y recién arma el DOM en
  `DOMContentLoaded`.
- El `<script>` del instrumento ya encuentra `ZD.*` definido.

Los bloques no dependen del orden entre sí en tiempo de carga (cada uno hace
`window.ZD || (window.ZD = {})`), pero `zd-mobile` necesita que
`window.ZD_M` esté definido **antes**, así que la config va justo arriba.

`zd-pwa` necesita además, en el `<head>` del instrumento:

```html
<link rel="manifest" href="../manifests/<slug>.webmanifest">
<link rel="apple-touch-icon" href="../icons/<slug>-apple-touch-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="<ShortName>">
```

Slugs y `apple-mobile-web-app-title`: ver `docs/pwa.md`.

---

## `zd-ui` v1 — toasts, modales, accesibilidad

Reemplaza `alert`/`confirm`/`prompt`. Inyecta `<style id="zd-ui-css">`. Todo
texto entra por `textContent`, nunca por `innerHTML`.

```js
ZD.toast(mensaje, {
  ms: 3600,                                  // 0 = no se cierra solo
  kind: 'error',                             // borde de alerta
  action:  { label: 'Recargar', onClick() {} },
  action2: { label: 'Deshacer', onClick() {} }
}) // -> { close(), el }

await ZD.modal.alert(mensaje, { title, ok })
await ZD.modal.error(mensaje, { title, ok })
await ZD.modal.confirm(mensaje, { title, ok, cancel, danger })   // -> boolean
await ZD.modal.prompt(mensaje, { title, value, placeholder, maxlength, label }) // -> string | null

await ZD.modal.open({
  title, message | node,          // `node` reemplaza el cuerpo de texto
  input: { value, placeholder, maxlength, label },
  actions: [{ label, value, primary, danger }],  // value puede ser (input) => any
  cancelValue,                    // lo que resuelve Escape / tap afuera
  dismissable: false              // desactiva cerrar tocando el scrim
})
```

Escape cierra, Tab queda atrapado dentro del diálogo y el foco vuelve a donde
estaba. En el shell móvil los toasts se levantan por encima de las tabs.

```js
ZD.ui.a11ySlider(el, {
  min, max, step, fineStep, pageStep,
  label, get: () => valor, set: v => {}, format: v => '880 Hz',
  onEnter: () => {}               // opcional: Enter/Espacio
}) // -> { refresh(valor) }
```

Pone `role="slider"`, `aria-label`, `aria-valuemin/max/now/valuetext` y el
teclado completo (←→↑↓, Shift = fino, PgUp/PgDn, Home/End). Hay que llamar a
`refresh(v)` cuando el valor cambia por otra vía (arrastre, patch, pad XY).

## `zd-store` v1 — autoguardado

IndexedDB `zd-sessions` / object store `sessions`, con fallback a
`localStorage`. Misma clave en los dos: `zd:<slug>:session`.

```js
const session = ZD.store.open({
  slug: 'acid-bass',
  app: 'acid-bass-303',   // va en el envoltorio y se valida al leer
  version: 1,
  debounce: 1500,
  getData: () => ({ ... }),   // lo que se guarda si se llama save() sin argumento
  migrate: () => envoltorioViejo | null,  // solo si load() no encontró nada
  enabled: true
});

session.save(data?)      // debounce 1,5 s
session.saveNow(data?)   // -> Promise<'idb'|'ls'|null>
session.flush()          // guarda ya si había algo pendiente
await session.load()     // -> envoltorio | null
await session.clear()
session.enabled = false  // apaga el autoguardado en caliente
session.unwrap(env, { anyApp, anyVersion })  // -> { ok, data, savedAt, version, reason }
await ZD.store.persist() // navigator.storage.persist()
```

El envoltorio es `{ app, version, savedAt, data }` (SPEC R3/R4). `unwrap()`
valida `app` y rechaza versiones **más nuevas** que la del instrumento;
`reason` es `'vacio' | 'otra-app' | 'version-nueva'`. Si le pasás un objeto sin
`data`, lo trata como el `data` suelto (compatibilidad hacia atrás).

El bloque ya engancha `visibilitychange` (hidden), `pagehide` y `freeze` para
hacer flush — no hace falta repetirlo en el instrumento.

**`migrate`** es el gancho para MonoMoon: leer la DB vieja
(`hackwave-minimoog`), devolver un envoltorio y dejar la vieja intacta.

**Decisión que afecta a los 5:** con el hub C2 presente (`window.HOST`) el
autoguardado va **apagado** (`enabled: false`). El host es el dueño del estado
y lo empuja por `setState`; si el instrumento restaurara encima, pelearían.

## `zd-audio` v1 — iOS, interrupciones, wake lock

No crea ni conoce el grafo: el instrumento le pasa cómo llegar al contexto.

```js
ZD.audio.attach({
  getContext: () => Engine.ctx,     // puede devolver null antes del primer gesto
  ensure:     () => Engine.ensure(),// sincrónico o Promise
  onResumed:  () => {},
  label: 'Tocá para reanudar'
});

ZD.audio.options({ sampleRate })  // -> { latencyHint:'interactive', ... }
await ZD.audio.unlock()           // DENTRO del handler del gesto -> boolean
ZD.audio.bindGesture(window)      // pointerup/click/keydown/touchend en captura
ZD.audio.setPlaying(true|false)   // wake lock + vigilancia de interrupciones
ZD.audio.resume()                 // reintento manual
await ZD.audio.decode(ctx, arrayBuffer)   // Promise con fallback a callbacks
ZD.audio.setSession()             // navigator.audioSession.type = 'playback'
ZD.audio.requestWake() / releaseWake()
ZD.audio.showResume() / hideResume()
ZD.audio.unlocked                 // boolean
```

`unlock()` hace, en este orden y dentro del gesto: `audioSession.type =
'playback'` donde exista, arranca un `<audio loop>` silencioso (WAV armado en
runtime como data URI, sin bytes extra en el archivo), llama a `ensure()` y
después `ctx.resume()`.

`setPlaying(true)` pide el Screen Wake Lock, lo re-pide en `visibilitychange` y
empieza a vigilar el contexto: si queda en `suspended` o `interrupted` (estado
propio de Safari) mientras debería estar sonando, muestra el overlay
"Tocá para reanudar". `setPlaying(false)` lo suelta y esconde el overlay.
Todo degrada en silencio donde no hay soporte.

## `zd-dl` v1 — descargas y lectura de archivos

```js
await ZD.dl.save(blob, filename, { prefer: 'share' | 'download' })  // -> 'share' | 'download'
ZD.dl.name('acid-bass', 'wav')   // -> 'acid-bass-20261003-0142.wav'
ZD.dl.slug(texto, max)
ZD.dl.stamp(date)                // 'YYYYMMDD-HHmm'
await ZD.dl.pick({ accept: '.json,application/json', multiple })    // -> File | File[] | null
await ZD.dl.readText(file)
await ZD.dl.readBuffer(file)
ZD.dl.bytes(n)                   // '1.4 MB'
ZD.dl.isIOS() / isStandalone() / canShareFiles(files)
ZD.download(blob, filename)      // alias de save()
```

Por defecto usa `<a download>`. En iOS (Safari, Chrome, standalone — todos
WebKit, donde el atributo `download` no es confiable) intenta **Web Share con
archivo** y, si `canShare({files})` dice que no o el share falla por algo que
no sea `AbortError`, cae al `<a download>`. `prefer` fuerza una u otra.

`pick()` crea su propio `<input type=file>`: no hace falta el input oculto en
el markup.

## `zd-midi` v1 — SMF y captura de performance

```js
ZD.midi.write({ ppq: 96, bpm, trackName, events }) // -> Blob audio/midi (formato 0)
// events: { t: <ticks>, type: 'on'|'off'|'cc'|'bend', pitch, vel, cc, val, ch }

ZD.midi.bendValue(semitonos, rango = 2)   // -> 0..16383
ZD.midi.CC                                // { mod:1, cutoff:74, reso:71, volume:7, pan:10 }
ZD.midi.support()                         // { available, ios, reason }
```

`write()` ordena por tick y, a igual tick, resuelve `off → cc → bend → on`
(nunca un note-off después del note-on del mismo tick). El nombre de track se
pasa a ASCII imprimible. `support()` es lo que hay que mostrar como
"MIDI no disponible en este navegador": **Web MIDI no existe en Safari ni en
ningún navegador de iOS** (el bloque no lo asume, lo detecta).

```js
const rec = ZD.midi.recorder({ ppq: 96, bpm, trackName, bendRange: 2 });
rec.start(ctx.currentTime);
rec.noteOn(60, 110, ctx.currentTime);
rec.noteOff(60, ctx.currentTime);
rec.cc(ZD.midi.CC.mod, 64, ctx.currentTime);
rec.ccNorm(ZD.midi.CC.cutoff, 0.42, ctx.currentTime);   // 0..1 -> 0..127
rec.bend(-1.5, ctx.currentTime);                        // en semitonos
rec.stop(ctx.currentTime);
const blob = rec.blob({ bpm, trackName });
```

Los tiempos entran en **segundos** (`ctx.currentTime` sirve directo) y se
convierten a ticks al cerrar. `rec.allOff()` cierra las notas abiertas.
Acid Bass no usa el recorder: su MIDI sale del patrón de 16 pasos con
`write()`. Lo usan MonoMoon, Nebularp y J4 (SPEC R4).

## `zd-rec` v1 — REC posta y tarjeta de resultado

```js
const rec = ZD.rec.create({
  getContext: () => Engine.ctx,
  getSource:  () => Engine.master,   // el nodo a grabar
  channels: 2,
  maxSec: 600,                       // tope de 10 min (SPEC R4)
  onProgress: s => {},
  onLimit: max => {}
});
await rec.start();      // -> 'worklet' | 'mediarecorder'
const res = await rec.stop();
// res = { blob, duration, bytes, sampleRate, channels, mode }
rec.cancel(); rec.elapsed(); rec.state; rec.mode;
```

Captura por AudioWorklet en chunks `Int16` a la frecuencia real del
`AudioContext`; el nodo va a un `GainNode` en 0 conectado al destino para que
el grafo lo siga procesando sin que se oiga dos veces. Si no hay worklet, cae a
`MediaStreamDestination` + `MediaRecorder` + `decodeAudioData`.

```js
ZD.rec.wavFromBuffer(audioBuffer)                       // -> Blob PCM 16-bit
ZD.rec.wavFromInt16(chunks, channels, sampleRate)
ZD.rec.secs(12.5)                                       // '0:12.5'

ZD.rec.card(mount, {
  blob, duration, bytes, sampleRate, channels,
  filename: ZD.dl.name('acid-bass', 'wav'),
  downloadLabel, discardLabel,
  onDiscard: () => {},    // si falta, no sale el botón
  replace: true           // vacía `mount` antes de insertar
}) // -> { el, destroy() }
```

La tarjeta muestra duración, tamaño, kHz y mono/estéreo, un `<audio controls>`
para escuchar y el botón de descarga (que pasa por `ZD.dl.save`). Acid Bass usa
**solo la tarjeta**, para el resultado de su render offline; la captura en vivo
es para Nebularp y J4.

## `zd-mobile` v2 — shell portrait-first

Reemplaza al shell landscape v1 y a `#zd-rotate`. Barra superior de 48 px →
zona de tocar → tabs de 56 px + `env(safe-area-inset-bottom)` → bottom sheets
(máx. 70dvh, o 45dvh en modo *peek*). Inyecta `<style id="zd-mobile-css">` y
pone la clase `zd-m` en `<html>`.

Se configura entero por `window.ZD_M`:

```js
window.ZD_M = {
  name: 'Acid Bass-303',
  titleParts: ['ACID ', 'BASS-303'],  // los índices impares van en <b>
  logo: '<src>',                      // opcional; por defecto toma .zd-logo del header
  transport: ['#playBtn', '.tempo-box'],   // nodos que van a la barra superior
  keep: ['#seqPanel', '#xyPanel'],         // nodos de la zona de tocar, en orden
  tabs: [                                  // máximo 5 (SPEC R1)
    { id: 'snd', label: 'SONIDO', title: 'OSCILADOR · DISTORSIÓN',
      nodes: ['#oscPanel', '#distPanel'], peek: true }
  ],
  menuTitle: 'MENÚ',
  menu: [
    { label: '← Sitio', href: '../index.html' },
    { label: '↓ Instalar app', id: 'zd-install-btn', hidden: true },
    { label: 'Empezar de cero', onClick() {} }
  ],
  menuNotes: ['Texto chico al pie del menú.'],
  onEnter() {}, onExit() {}
};
```

Reglas del contrato:

- **Lo que no está en `transport`, `keep` ni `tabs[].nodes` no se ve**: el
  shell esconde `.wrap` entera (`display:none`). Los nodos que quedan ahí
  siguen existiendo y consultables por `querySelector` (un `<canvas>` oculto se
  sigue pudiendo dibujar, un `<input type=file>` oculto sigue andando).
- `menu` acepta `href` (sale un `<a rel="noopener">`) o `onClick` (sale un
  `<button>`). `id: 'zd-install-btn'` es el que `zd-pwa` muestra o esconde.
- `peek: true` limita el sheet a 45dvh y **no** pone scrim, así la zona de
  tocar sigue usable mientras se ajusta (SPEC R1).
- El sheet cierra por tap afuera, botón ✕, Escape y swipe hacia abajo sobre el
  handle o la cabecera.

API:

```js
ZD.mobile.active                   // boolean
ZD.mobile.openTab                  // id de la tab abierta o null
ZD.mobile.open(id) / close() / toggle(id)   // id '__menu' para el menú
ZD.mobile.stage() / pane(id)       // nodos del shell
ZD.mobile.mq                       // la media query de activación
```

**Decisión que afecta a los 5 — la activación no mira la orientación:**

```
(pointer:coarse) and (max-width:1024px), (max-width:820px)
```

Un teléfono o tablet cumple la primera rama en vertical **y** en horizontal, así
que rotar no vuelve a mover nodos (SPEC R1: "si se reubican, una sola vez y no
en cada cambio de orientación"). La segunda rama cubre una ventana de escritorio
angosta. Landscape y desktop ≥1024 son mejora progresiva por CSS, no otro
layout.

El CSS instrumento por instrumento (qué tan alto va el pad, cuántas columnas
tienen los steps, qué pasa en landscape) va en un `<style id="zd-mobile-skin">`
propio, colgado de `html.zd-m`. Ese `<style>` **no** es parte del bloque.

## `zd-pwa` v1 — service worker e Instalar

Sin configuración: el slug sale del `<link rel="manifest">` del `<head>`, así
que el bloque es idéntico en los 5 sin ni una línea que cambie. (Es la única
diferencia con el borrador de `docs/pwa.md`, que llevaba `var SLUG` adentro —
eso rompería la verificación byte a byte de SPEC 3.1.2.)

```js
ZD.pwa.install()      // dispara beforeinstallprompt, o el hint de iOS
ZD.pwa.refresh()      // re-evalúa si mostrar el botón
ZD.pwa.active         // pasó las 3 condiciones de activación
ZD.pwa.registered     // el SW quedó registrado
ZD.pwa.manifest       // href del manifest que usó
ZD.pwa.isStandalone()
```

Condiciones de activación (SPEC 3.2), las tres: `http:`/`https:`,
`window.top === window` y `HEAD` al manifest con respuesta OK. En `file://` o
dentro de un iframe el bloque retorna antes de tocar nada: cero
`console.error`, cero service worker. Registra `../sw.js` con `scope: '../'`
resueltos contra `location.href`.

El botón Instalar se resuelve **tarde**, por delegación de `click` sobre
`#zd-install-btn`, así que puede ser creado después por el shell. Queda oculto
si ya corre en standalone, dentro de un iframe, en `file://` o si no hay forma
de instalar.

El toast "Nueva versión · Recargar" sale cuando el SW manda
`{type:'zd-sw-updated'}` **y** ya había un controller (no en el primer
install).


### Glifos

Los bloques y la config usan solo glifos que estén en el bloque Arrows y en
Geometric Shapes (`↓ ↑ ← → ● ▶ ◀ ✕ ⋯`). `⭳` y `⭱` (U+2B73 / U+2B71, Arrows
Supplement-B) **no** sirven: casi ninguna fuente los trae y salen como un
cuadrado vacío.

---

## Checklist para pegarlos en un instrumento nuevo

1. Copiar los 8 archivos de `tools/blocks/` al `<head>`, en el orden de arriba,
   con el `window.ZD_M` del instrumento entre `zd-rec` y `zd-mobile`.
2. Agregar los 4 tags de `zd-pwa` al `<head>` (manifest, apple-touch-icon y los
   dos `apple-mobile-web-app-*`).
3. Borrar el shell v1: `<style id="zd-mobile">`, `<script id="zd-mobile-js">`,
   `#zd-rotate` y su media query de `orientation:portrait`.
4. Escribir el `<style id="zd-mobile-skin">` del instrumento.
5. Cablear: `ZD.audio.attach` + `unlock` en el gesto + `setPlaying`,
   `ZD.store.open` + restauración sin arrancar el audio, los exports por
   `ZD.dl.save`, los `alert/confirm/prompt` a `ZD.modal.*`, los knobs a
   `ZD.ui.a11ySlider`.
6. `node tools/check-blocks.mjs` y `node tools/build-zip.mjs && node tools/check-zip.mjs`.
