# Bloques `ZD` · API y cómo pegarlos

Los 8 bloques compartidos que piden SPEC 3.1.2 y 3.4. Se copian **byte a byte
idénticos** en los 5 `descargables/*.html`: no llevan ni un selector, ni un
texto, ni un slug del instrumento — todo entra por configuración. Se verifican
con `node tools/check-blocks.mjs`.

La copia canónica de cada bloque está en `tools/blocks/<nombre>.html`, lista
para pegar tal cual (incluye el `<script>` que la envuelve). `check-blocks`
compara los 5 HTML entre sí **y** contra esa copia, y
`node tools/sync-blocks.mjs` la vuelve a pegar en los instrumentos que ya la
tengan (ver más abajo).

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

## `zd-midi` v2 — SMF y captura de performance

```js
ZD.midi.write({ ppq: 96, bpm, trackName, events }) // -> Blob audio/midi (formato 0)
// events: { t: <ticks>, type: 'on'|'off'|'cc'|'bend', pitch, vel, cc, val, ch }

ZD.midi.bendValue(semitonos, rango = 2)   // -> 0..16383
ZD.midi.CC                                // { mod:1, cutoff:74, reso:71, volume:7, pan:10 }
ZD.midi.support()                         // { available, ios, reason }
```

`write()` ordena por tick y, a igual tick, resuelve `off → cc → bend → on`
(nunca un note-off después del note-on del mismo tick). Entre varios note-off
del mismo tick ordena por altura ascendente, así el archivo sale igual en cada
corrida; los note-on conservan el orden en que los empujó el instrumento. El
nombre de track se pasa a ASCII imprimible. `support()` es lo que hay que mostrar como
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
`noteOn()` de una altura ya abierta cierra la anterior en el mismo instante: ese
off y el on nuevo caen en el mismo tick y los resuelve el orden de `write()`.

Caso de prueba del orden a igual tick (es el que estaba roto en v1):

```js
ZD.midi.write({ ppq:96, bpm:120, events:[
  { t:0,  type:'on',  pitch:60, vel:100 }, { t:48, type:'off', pitch:60 },
  { t:48, type:'on',  pitch:60, vel:100 }, { t:96, type:'off', pitch:60 } ] })
// track: 00 90 3c 64 · 30 80 3c 00 · 00 90 3c 64 · 30 80 3c 00
// dos notas de 48 ticks, sin solaparse ni quedar de largo 0
```

Lo verifica `node tools/tests/zd-midi-order.test.mjs`.
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

## `zd-mobile` v4 — shell portrait-first

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

**Targets táctiles de la barra superior (v4).** El bloque pone un piso de
44 px en los dos ejes para todo control que termine en `#zd-top`
(`button`, `a`, `input`, `select`), venga del transporte del instrumento, del
ícono de instalar que inyecta `zd-pwa` o del botón de menú propio. La barra mide
48 px, así que 44 entra. Va con `min-width`/`min-height`, que ganan sobre un
`width`/`height` fijo sin importar la especificidad (por eso levanta el
`.zd-pwa-topicon` de 40×40 sin tocar `zd-pwa`), y **sin `!important`**: el
`<style id="zd-mobile-skin">` de un instrumento puede decidir otra cosa a
sabiendas. Ojo con eso: si el skin fija `min-height` con más especificidad, gana
el skin y el control vuelve a quedar corto. Lo chequea el test.

**Entrar y salir son idempotentes y reversibles (v3).** El shell se arma una
sola vez (`build()`), pero los nodos se mueven en cada `enter()` y vuelven a su
lugar en cada `exit()`, con un comentario `<!--zd-m-->` de marcador por nodo: tras
N ciclos el DOM queda idéntico, los nodos son los mismos objetos (el cableado de
eventos y el estado de los `<canvas>` sobreviven) y no queda ningún marcador
suelto. El ciclo además devuelve el foco al elemento que lo tenía y el scroll de
la página a donde estaba antes de entrar. En v2 `moveNodes()` vivía adentro de
`build()`, así que al volver a entrar la barra, el stage, las tabs y los sheets
quedaban vacíos.

Lo verifica `node tools/tests/zd-mobile-cycle.test.mjs`.

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

## `zd-pwa` v2 — service worker, Instalar y la oferta proactiva

Sin configuración: el manifest sale del `<link rel="manifest">` del `<head>`,
el nombre de `document.title` o `apple-mobile-web-app-title`, y — solo para el
aviso de `file://` — la URL de `<link rel="canonical">` si existe. El bloque
es idéntico en los 5 sin ni una línea que cambie.

```js
ZD.pwa.install()      // dispara deferredPrompt.prompt(), el hint de iOS o el
                       // aviso de "abrí esto en Safari/Chrome" segun el caso
ZD.pwa.refresh()      // re-evalua item de menu, icono del header y boton de escritorio
ZD.pwa.active         // pasó las condiciones de activación (http(s) + top window)
ZD.pwa.registered     // el SW quedó registrado
ZD.pwa.manifest       // href del manifest que usó
ZD.pwa.isStandalone()
```

**Banner propio, independiente del shell y del menú.** Al entrar a la página
(o cuando llega `beforeinstallprompt`, aunque sea después de cargar), si
`canInstall()` es cierto y no está en standalone/iframe/`file://`/descartado/
con un sheet abierto, arma un banner descartable y lo monta él mismo:

- Con `ZD.mobile.active` (shell móvil activo): lo inserta como **primer hijo**
  de `ZD.mobile.stage()`. `#zd-stage` es `flex-direction:column` y el panel
  del pad XY vive con `flex:1; min-height:0` — el banner (`flex:none`) nunca
  tapa `PLAY`/transporte (viven en `#zd-top`, fuera del stage) ni el pad XY:
  achica el espacio disponible, no lo superpone. Se probaron las dos
  ubicaciones candidatas (debajo de la barra superior vs. encima de las tabs)
  con capturas a 360×640; "encima de las tabs" tapaba el pad XY porque en esa
  resolución el pad termina a ~10 px del borde de las tabs — se descartó.
- Sin shell activo (escritorio ancho): según la variante — ver abajo.

Tres variantes, elegidas por `variant()`:

| Variante | Cuándo | Contenido |
| --- | --- | --- |
| `install` | hay `deferredPrompt` | "Instalá **{nombre}** como app" + `[↓ Instalar]` + `[Ahora no]`. En escritorio sin shell **no** se muestra el banner: alcanza con el botón del header (abajo). |
| `ios` | `isIOS()` (Safari/CriOS/FxiOS — todos WebKit, se detectan igual) y no standalone | mismo mensaje + ícono de Compartir (SVG inline) + "Compartir → Agregar a inicio". Sin botón Instalar: iOS no tiene API programática. |
| `embedded` | navegador embebido (Instagram/Facebook/TikTok/Line/WeChat/Twitter por user-agent) | "Abrí este link en Safari o Chrome para instalar." + `[Ahora no]`. |

`[Ahora no]` guarda `Date.now()` en `localStorage['zd:pwa:dismissed']`; no
reaparece durante 14 días. El ítem del menú (`#zd-install-btn`) y un ícono
`↓` que el bloque inyecta en `#zd-top` (antes de `#zd-tmenu`, solo con el
shell activo) **no** dependen de ese descarte: siguen disponibles y llaman al
mismo `doInstall()`. `[↓ Instalar]` llama a `deferredPrompt.prompt()` desde el
click (gesto del usuario); si el usuario acepta o dispara `appinstalled`, toast
"App instalada" y el banner no vuelve (al quedar en standalone, `variant()`
da `null` en la próxima carga).

**Escritorio sin shell:** si hay `deferredPrompt`, un botón fijo
`↓ Instalar` arriba a la derecha (propio del bloque, no toca el `<header>`
del instrumento). En Safari/Firefox de escritorio no hay evento, así que no
se muestra nada.

**`file://`:** rama aparte, antes de cualquier otra cosa — cero `fetch`, cero
intento de SW. Si hay `<link rel="canonical">` y no se descartó (clave propia
`zd:pwa:dismissed-local`, mismos 14 días), un aviso de un renglón: "Estás
usando el archivo local..." + `[Abrir web]` (abre el canonical) + `[✕]`. Sin
canonical: nada. El mismo `#zd-install-btn` del menú, bajo `file://`, no
"instala": navega al canonical.

**Iframe:** se detecta primero que nada (`window.top !== window`) y corta
antes de tocar el DOM o `localStorage`: cero banner, cero CSS inyectado, cero
listener. `ZD.pwa.active` queda en `false`.

Condiciones de activación del service worker (SPEC 3.2): `http:`/`https:`,
top window y `HEAD` al manifest con respuesta OK. Registra `../sw.js` con
`scope` resueltos contra `location.href`. El toast "Nueva versión · Recargar"
sale cuando el SW manda `{type:'zd-sw-updated'}` **y** ya había un controller
(no en el primer install).

Accesibilidad: el banner es `role="region"` con `aria-label`; los botones son
`<button>`/`<a>` reales (el `:focus-visible` global del instrumento ya les da
el anillo de foco); al cerrar, si el foco estaba adentro, vuelve a `body`. Las
transiciones quedan anuladas por la regla global
`@media (prefers-reduced-motion:reduce){ *{transition:none!important} }` que
ya tiene cada instrumento. Los colores salen de los tokens `--zd-*` /
`--inst-accent` del propio instrumento (mismos pares que ya usa `zd-ui` para
toasts y diálogos).

### Glifos

Los bloques y la config usan solo glifos que estén en el bloque Arrows y en
Geometric Shapes (`↓ ↑ ← → ● ▶ ◀ ✕ ⋯`). `⭳` y `⭱` (U+2B73 / U+2B71, Arrows
Supplement-B) **no** sirven: casi ninguna fuente los trae y salen como un
cuadrado vacío.

---

## `tools/sync-blocks.mjs` — volver a pegar los bloques

Node >=18, sin dependencias. Para cada archivo de `descargables/*.html` y cada
bloque, reemplaza la región que va de `/* ZD-BLOCK:<nombre> v<n> */` a
`/* /ZD-BLOCK:<nombre> */` (los dos incluidos) por la de `tools/blocks/`. El
número de versión sale de la copia canónica, así que subirlo ahí lo propaga solo.

```
node tools/sync-blocks.mjs                      # escribe
node tools/sync-blocks.mjs --check              # no escribe; exit 1 si hay diferencias
node tools/sync-blocks.mjs --only zd-midi       # un bloque (repetible, o con comas)
node tools/sync-blocks.mjs --file Acid_Bass-303.html   # un archivo (repetible)
```

Reglas:

- **Si el archivo no tiene el bloque, lo reporta como "pendiente" y NO lo
  inserta.** Pegar un bloque por primera vez es trabajo de la sesión de ese
  instrumento: hay que ubicarlo en el `<head>` en el orden de arriba, escribir el
  `<style id="zd-mobile-skin">` y cablearlo (ver el checklist).
- Un bloque abierto o cerrado más de una vez en el mismo archivo es un error y
  corta la corrida (misma regla que `check-blocks`).
- `--check` es lo que va en CI y antes de un commit: no escribe nada y falla si
  algún instrumento quedó con una copia vieja.
- Después de sincronizar, `node tools/check-blocks.mjs` tiene que quedar en verde:
  `sync-blocks` pega y `check-blocks` verifica. Son dos pasos a propósito.

Hoy en `main` solo `descargables/Acid_Bass-303.html` tiene bloques pegados; los
otros 4 instrumentos salen como "pendiente" hasta que su sesión C los integre.

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
6. `node tools/sync-blocks.mjs` (deja de salir como "pendiente"),
   `node tools/check-blocks.mjs` y `node tools/build-zip.mjs && node tools/check-zip.mjs`.

## Tests

```
node tools/tests/run.mjs            # todo
node tools/tests/zd-midi-order.test.mjs     # Node puro
node tools/tests/zd-mobile-cycle.test.mjs   # necesita Playwright + Chromium
node tools/tests/acid-verify.test.mjs       # idem
```

- `zd-midi-order` · el orden de eventos a igual tick en `write()` y en
  `recorder()`, y el MIDI del patrón de Acid parseado como SMF.
- `zd-mobile-cycle` · conformidad de `zd-mobile` para **cualquier** instrumento:
  el ciclo salir/entrar del shell en los tres pares de viewport, el cableado de
  eventos, el foco, el scroll, el banner de `zd-pwa` y los ≥44 px de los
  controles de la barra superior. No sabe nada de un instrumento en particular.
- `acid-verify` · la verificación completa del piloto, la que hay que volver a
  pasar después de tocar un bloque: viewports 360×640 / 390×844 / 768×1024 /
  844×390 / 1440×900, autoguardado, export JSON+MIDI+WAV (con ida y vuelta del
  JSON), audio con suspend/resume, banner de instalación (que no tape PLAY ni el
  pad XY), rotación de tablet 1180×820 ↔ 820×1180 **con el instrumento sonando**,
  `file://`, iframe y registro del service worker sobre http.

### `zd-mobile-cycle` en otro instrumento

Es el test que una sesión C tiene que correr sobre lo suyo después de pegar o
actualizar `zd-mobile`, **sin tocar nada de `tools/`**:

```
node tools/tests/zd-mobile-cycle.test.mjs --file descargables/Nebularp_2035.html
node tools/tests/zd-mobile-cycle.test.mjs --file descargables/J4-Sirens_Station.html --cycles 6
```

Sin `--file` corre sobre el piloto, `descargables/Acid_Bass-303.html`.

No hay nada del instrumento escrito en el test: al arrancar lee el
`window.ZD_M` de la propia página y resuelve `keep`, `transport` y
`tabs[].nodes` con `querySelectorAll`, igual que el bloque, así que las
expectativas salen de la config. Después exige, en cada ciclo, que `#zd-stage`,
`.zd-ttr` y cada pane tengan **exactamente** esos nodos con el shell activo, y
que queden **vacíos** al salir. Imprime lo que resolvió, así se ve de entrada si
un selector de `ZD_M` no matchea nada:

```
  descargables/Acid_Bass-303.html · ZD_M "ACID BASS-303" · zd-mobile v4 · 4 ciclos
  keep=[seqPanel, stepEditPanel, perfPanel] transport=[playBtn, .tempo-box, clipLed]
  tab seq (SEQ) = [tempoKnob, tapBtn, scope, .seq-top, kbPanel]
```

Detalles que conviene saber antes de leer una falla:

- Un instrumento sin el bloque pegado falla con "`window.ZD_M.keep` no resolvió
  ningún nodo". Primero `node tools/sync-blocks.mjs`.
- Los selectores de `ZD_M` que no son strings (una función que devuelve nodos)
  no se pueden predecir: el test los avisa y no los exige.
- El foco se prueba sobre el propio nodo de `keep[0]` (con `tabindex="-1"`), no
  sobre un descendiente: un re-render del instrumento se llevaría puesto al
  descendiente y la falla no sería del bloque.
- El cableado de eventos se prueba con un listener propio enganchado **antes**
  del ciclo, más la identidad del objeto DOM. No depende de ningún control del
  instrumento.

Playwright no es dependencia del runtime ni del build:

```
npm i -D playwright && npx playwright install chromium
```

---

## Changelog de bloques

Cuando sube un bloque, sube también el número del delimitador
(`/* ZD-BLOCK:<nombre> v<n> */`) y hay que volver a pegarlo en los instrumentos
que lo tengan: `node tools/sync-blocks.mjs` y después `node tools/check-blocks.mjs`.

### 2026-10-04 · `zd-mobile` v3 → v4

Los controles de la barra superior medían 40 px de alto y SPEC R1 pide ≥44 px en
el eje corto. La barra mide 48, así que 44 entra sin tocar la métrica del shell.

- `#zd-tmenu` pasa de 44×40 a 44×44.
- Piso genérico: `#zd-top button, #zd-top a, #zd-top input, #zd-top select`
  con `min-width:44px; min-height:44px`. Alcanza a los nodos de `transport` del
  instrumento y al `↓` de `zd-pwa` (40×40 fijos) sin tocar ese bloque, porque
  `min-*` gana sobre `width`/`height` sin importar la especificidad.
- Sin `!important`: un `zd-mobile-skin` con más especificidad sigue mandando.
  **Lo que tiene que hacer cada sesión C:** revisar que su skin no fije un
  `min-height` menor a 44 para los nodos del transporte. En Acid había
  `html.zd-m #zd-top .btn-play{min-height:40px}` y pasó a 44.

Medido en Acid con el ícono de instalar visible (360×640, 390×844, 768×1024 y
844×390): barra 48 px, `#zd-tmenu` 44×44, `#zd-pwa-topbtn` 44×44, PLAY 76×44,
tempo-box 58×44, sin recorte en `.zd-ttr` y sin scroll horizontal.

### 2026-10-03 · `zd-midi` v1 → v2

A igual tick, el note-off salía **después** del note-on, justo al revés de lo que
promete la doc. El comparador usaba `(ORDER[a.type] || 9)` y `ORDER.off` valía
`0`: por falsy, el off se iba a 9 y quedaba último.

- `ORDER` pasa a `{ off:1, cc:2, bend:3, on:4 }` (ningún valor falsy) y el rango
  se resuelve en `rank()`, que devuelve 9 solo para los tipos que no conoce.
- Nuevo desempate: entre note-off del mismo tick, por **altura ascendente**. Los
  note-on siguen en el orden en que los empujó el instrumento.
- Sin cambios en la API pública ni en el formato de los eventos.

Lo que arregla: una nota repetida en la misma altura cuyo off y on caen en el
mismo tick quedaba de duración cero y dejaba la otra colgada hasta el off
siguiente. Afectaba a Acid (`buildMIDI()` con un patrón tipo `0 ~ 0`), al
`recorder()` de MonoMoon, Nebularp y J4 (re-trigger de la misma altura) y al
patrón de fábrica de Acid (`0a 0s 12 ~ …`: `on` de 45 y `off` de 33 en el tick 96).

### 2026-10-03 · `zd-mobile` v2 → v3

Al volver a entrar al shell, `#zd-stage`, la barra superior, las tabs y los
sheets quedaban vacíos: `enter()` llama a `build()`, que corre una sola vez
(`if (built) return;`), y `moveNodes()` vivía adentro de `build()`. `exit()` sí
devolvía los nodos con `restoreNodes()`.

- `build()` guarda la columna de transporte en `trRef` y ya no mueve nodos.
- `enter()` mueve los nodos cuando no hay ninguno movido
  (`if (!moves.length) moveNodes(trRef)`): `restoreNodes()` vacía `moves`, así
  que el ciclo queda simétrico y entrar dos veces seguidas no mueve nada dos veces.
- El ciclo conserva el **foco** (el nodo que lo tenía se vuelve a enfocar con
  `preventScroll`) y el **scroll de la página** (se guarda al entrar, porque el
  shell pone `body{overflow:hidden}`, y se devuelve al salir).
- Sin cambios en la API pública ni en el contrato de `window.ZD_M`.

Lo que arregla: redimensionar una ventana de escritorio de un lado al otro de
820 px, y rotar una tablet cuyo ancho cruza 1024 px (iPad Pro de 12,9": 1024 en
vertical, 1366 en horizontal; en una de 1180×820 el shell entra en vertical y
sale en horizontal).
