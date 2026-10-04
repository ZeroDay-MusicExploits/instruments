# D1 · barrido de problemas comunes (auditoría)

Sesión D1 · 2026-10-04 · rama `main`. Alcance: los 5 `descargables/*.html`
después del sync de la tarea 2 (`zd-ui` v2, `zd-audio` v2, `zd-rec` v2,
`zd-pwa` v3; commit `0941527`). **Los números de línea son de ese commit.**

Regla de esta auditoría: arreglar solo lo que fuera una línea sin cambio de
comportamiento, en un commit aparte; el resto, reportado acá. **No se aplicó
ningún arreglo**: todo lo encontrado cambia comportamiento (aunque sea para
bien), toca el criterio de HOST/C2 o es una decisión de diseño. Las propuestas
de sonido de los reportes (DC-block/WaveShaper de MonoMoon, techo del FEEDBACK ∞
de J4, limitador o master por defecto de CronBeat) quedan sin tocar.

Las mediciones de b y c se reproducen con `node reports/D1-barrido-verify.mjs`
(Playwright + Chromium; imprime lo que mide, no falla).

| # | Tema | Resultado | Severidad | Propuesta |
|---|---|---|---|---|
| a | `touchstart/touchmove` no pasivos en `window`/`document` | **Ninguno** en los 5 | — | Observación menor sobre sliders en sheets |
| b | Atajos globales que se roban teclas | **Acid** (Espacio en knobs y botones, letras en el prompt) y **CronBeat** (Espacio y ←→ en botones) | Media (Acid), baja (CronBeat) | Guard común en `zd-ui` v3; MonoMoon como referencia |
| c | Sonido en `pointerdown` antes del destrabe | CronBeat y Nebularp programan sobre un contexto suspendido; **Acid deja una nota colgada** (medido, no depende de iOS) | Media (Acid), a verificar en iPhone (resto) | Guard en Acid; criterio puerta / golpe pendiente; `zd-audio` v3 |
| d | `zd-audio` con hub C2 | Acid es el único que lo engancha con `HOST` | Baja | Con `HOST`, nada de `zd-audio` |
| e | Peso | Logo de 39,9 KB duplicado en J4 y MonoMoon | Baja | Una copia + copiar el `src` en runtime |
| f | Claves v1 de `ZD_M` | Nadie las lee; solo J4 las conserva | Baja | Enmendar SPEC 3.1.3 y sacarlas en J4 |

---

## a · Listeners táctiles no pasivos en `window`/`document`

**Ninguno de los 5 tiene listeners `touchstart` ni `touchmove` en `window` o
`document`**, pasivos o no. Lo único táctil a nivel global es el `touchend` de
`ZD.audio.bindGesture()` (bloque `zd-audio`, en captura, sin `preventDefault`):
no afecta el scroll.

El equivalente en CSS (`touch-action:none` amplio, que era el bug de J4 con
`body{touch-action:none}`) también está limpio: en los 5, `touch-action:none`
queda en superficies de tocar (knobs, pads, teclados, pad XY, editor de onda).
J4 ya tiene el arreglo: `body{touch-action:manipulation}` y `none` solo en
`.xypad,.bigtrig,.scopewrap,.dial,.strip` (`J4-Sirens_Station.html:36-42`).

**Observación (no es de `window`/`document`):** dos instrumentos le ponen
`touch-action:none` a **todos** los `input[type=range]`:

- `descargables/Acid_Bass-303.html:131`
- `descargables/CronBeat-808.html:139-140`

En un sheet con varios sliders apilados, un arrastre vertical que empieza sobre
un slider no hace scroll del sheet: el gesto queda para el slider (por lectura
del CSS; no lo probé en un teléfono). Nebularp resolvió lo mismo
con `touch-action:pan-y` en `.kslider` (`Nebularp_2035.html:372`): el slider
sigue arrastrándose en horizontal y el sheet scrollea en vertical.
**Propuesta:** `pan-y` en los sliders horizontales de Acid y CronBeat. Cambia
cómo responde el arrastre, así que queda para la sesión de cada uno (y a
verificar en un teléfono).

## b · Atajos de teclado globales

Los 5 escuchan el teclado en `window` (fase de burbuja). Tres ya tienen un
guard completo; Acid y CronBeat no.

| Instrumento | Dónde | Qué mira antes de actuar | Qué se roba (medido) |
|---|---|---|---|
| MonoMoon | `MonoMoon70.html:3454-3464` (`pcKeysOff`) | `defaultPrevented`, Ctrl/Meta/Alt, input/select/textarea/contenteditable, **un `.zd-scrim` en el DOM** (modal abierto), Espacio sobre botones | nada · es la referencia |
| Nebularp | `Nebularp_2035.html:3336-3363` | Ctrl/Meta/Alt, `defaultPrevented`, campos, `.zd-dlg` abierto; Espacio sobre un control con foco **de teclado** es del control | nada |
| J4 | `J4-Sirens_Station.html:4167-4172` (`keysBlocked`), `:4182-4202` | `defaultPrevented`, Ctrl/Meta/Alt, campos, `.zd-scrim`; Espacio con navegación por teclado es del control | nada |
| CronBeat | `CronBeat-808.html:3946` (`typingTarget`), `:3947-3959` | campos (no `range`), select, `.zd-dlg` **alrededor del target**; ←→ sobre un `range` | **Espacio y ←→ con el foco en cualquier botón**: foco en un botón de patrón, `→` sube el tempo (128 → 129) y Espacio da play; el botón no recibe su activación. No mira `defaultPrevented` ni si hay un modal abierto con el foco afuera. |
| Acid | `Acid_Bass-303.html:3353-3357` | Espacio: solo si `activeElement` es un `INPUT`. Letras, `z` y `x`: **nada** | **Espacio en un knob** (`TEMPO`): abre la entrada numérica (el `onEnter` de `a11ySlider`, `:2957`) **y además** da play. Espacio sobre cualquier botón, también los de un modal, da play y le saca la activación al botón. **Letras mientras se escribe**: en el prompt del nombre del banco (`:3383`), tipear `kassdf zz` dispara 6 notas por el teclado de PC (`KB_KEYMAP`, `:3332`) y baja la octava 2 → 0 (además marca la sesión como modificada). El texto llega igual al input porque no hay `preventDefault`. |

`zd-ui` v2 no cambia nada de esto: el modal atrapa Tab y Escape en captura,
pero deja pasar el resto, y es el instrumento el que tiene que no actuar. El
test nuevo `tools/tests/zd-ui-prompt.test.mjs` tipea dígitos y Enter en los 5 y
pasa (ninguno los usa como atajo); las letras de Acid no las cubre.

**Propuesta: un guard único**, el de MonoMoon generalizado, en `zd-ui` v3
(sin implementar):

```js
ZD.ui.keysFree(e)  // false si: e.defaultPrevented · Ctrl/Meta/Alt · target editable
                   // (input que no sea range/button, textarea, select, contenteditable)
                   // · hay un .zd-scrim en el DOM (modal abierto, tenga o no el foco)
```

y una regla escrita en `docs/zd-blocks.md`: los atajos globales llaman a
`ZD.ui.keysFree(e)` primero; Espacio, Enter y flechas sobre un control con
foco de teclado (`button`, `a[href]`, `[role=button|slider|switch]`,
`input[type=range]`) son del control. Con foco puesto por el mouse, Espacio
puede seguir siendo play/stop (como ya hacen Nebularp y J4; es lo que espera
quien toca).

Aplicarlo en Acid (dos `if` al principio de `keydown`/`keyup`) y en CronBeat
cambia comportamiento: queda para la sesión de cada uno.

## c · Primer golpe en iOS: sonido en `pointerdown`

La regla: para la entrada **táctil**, `pointerdown`/`touchstart` no dan
activación de usuario y `pointerup`/`touchend` sí (estándar HTML; WebKit lo
aplica al audio desde iOS 9). `ZD.audio.bindGesture()` destraba justamente en
`pointerup`/`click`/`keydown`/`touchend`. Hasta ese primer destrabe, lo que el
instrumento programe en un `pointerdown` cae en un contexto suspendido, con
`currentTime` congelado.

Medido con `reports/D1-barrido-verify.mjs`. Chromium headless arranca todo
`AudioContext` en `running`, así que la regla se **emula** envolviendo el
`AudioContext`: nace suspendido y `resume()` solo se cumple con activación
transitoria. Primer tap en 390×844:

| Instrumento | Suena en `pointerdown` | Puerta de encendido | Medido | Riesgo |
|---|---|---|---|---|
| CronBeat | pads grandes `CronBeat-808.html:3311`, pads de fila `:3264`, nombre de pista `:3364` → `livePlay()` `:3489` | no | 2 `start(0)` con el contexto suspendido y `t=0.000`; `resume()` permitido recién en el `pointerup` | el primer golpe suena tarde, lo que dure el toque (~80–150 ms en un dedo real); con *note repeat*, posible ráfaga al destrabar |
| Nebularp | piano `Nebularp_2035.html:3748-3751`: `unlockAudio()` sin esperar + `noteOn` | no | 12 `start()` con el contexto suspendido; dos `resume()` pendientes; destraba en el `pointerup` | note-on y note-off caen sobre el mismo reloj congelado: primer toque mudo o muy corto (a verificar) |
| **Acid** | teclado `Acid_Bass-303.html:3339` → `keyDownSemi()` `:3346`, que hace `await ZD.audio.unlock()` | no | **nota colgada**: `Engine.triggerAmp` corre 19 ms **después** del `pointerup`; al terminar, `activeSemi=0` y la tecla sigue `.down`. Pasa igual **sin** la emulación | **no depende de iOS**: cualquier primer toque o clic más corto que el arranque del motor (carga del worklet) deja la nota sonando hasta tocar otra tecla. Mismo camino con el teclado de PC (`:3357`) |
| MonoMoon | teclas `MonoMoon70.html:3443-3445` → `startAudioThen()` `:3605` | sí, `#powerOvl` (`:2574`) | no medido: el primer toque lo toma la pantalla de encendido | sin la puerta, el primer toque sería mudo pero sin nota colgada (el guard `ptrDown` lo cubre) |
| J4 | pad XY `J4-Sirens_Station.html:3745`, SIREN `:4135`, throws `:3341` | sí, `#power` (`:257`) | no medido: la puerta toma el primer toque | ninguno con la puerta |

**Propuesta:**

1. **Acid, primero** (es el único que queda en un estado malo): en
   `keyDownSemi()`, después del `await`, si la tecla ya se soltó no dejar la
   nota abierta (no dispararla, o dispararla corta con
   `auditionNote(midi, true)`). Es el guard que ya tiene MonoMoon (`ptrDown`).
   Sesión de Acid.
2. **Criterio común**: ninguna superficie programa sonido antes de que el audio
   esté destrabado. Hay dos formas válidas: **puerta de encendido** (J4,
   MonoMoon: el primer toque es del overlay) o **golpe pendiente** (sin puerta:
   en `pointerdown`, si el contexto no está `running`, guardar el golpe y
   dispararlo en el `pointerup` del mismo dedo, después del destrabe; suena
   tarde, pero con su envolvente entera). Para pads (CronBeat) conviene el golpe
   pendiente; para teclados con sostenido (Nebularp, Acid), la puerta o una nota
   corta al soltar.
3. **`zd-audio` v3** (propuesta, sin implementar): `ZD.audio.whenReady(fn)`
   corre `fn` en el acto si el contexto está `running`; si no, la guarda (la
   última por puntero) y la corre apenas `unlock()` lo pase a `running`. Así los
   instrumentos sin puerta lo resuelven igual.

**A verificar en un iPhone** (Safari y PWA): primer toque de un pad en
CronBeat, del piano en Nebularp y de una tecla en Acid, con el switch de
silencio activado y sin activar.

## d · `zd-audio` con el hub C2

Cómo engancha cada uno `zd-audio` (destrabe, `audioSession`, `<audio>`
silencioso, wake lock, overlay "Tocá para reanudar") cuando corre adentro del
hub C2 (`window.HOST`):

| Instrumento | `attach` + `bindGesture` | `setPlaying` | `unlock()` desde controles | Con `HOST` |
|---|---|---|---|---|
| Acid | siempre (`Acid_Bass-303.html:3443-3447`) | siempre, en `Seq.start/stop` (`:2858`, `:2860`) | siempre: knob `:2963`, slider `:2974`, pad XY `:2991`, chip MIDI `:3199`, banco `:3372`, teclado `:3346` | **engancha todo** sobre `HOST.ctx` |
| CronBeat | `if(!HOST …)` (`CronBeat-808.html:4189`) | `if(!HOST …)` (`:3908`) | por `ensureAudio()`, que con `HOST` no hace `resume` | nada |
| J4 | `if(!HOST …)` (`J4-Sirens_Station.html:4365`) | sale con `HOST` (`:4379`) | `if(!HOST …) unlock() else boot()` | nada |
| MonoMoon | `if(!HOST …)` (`MonoMoon70.html:3622`) | `activityOn()` sale con `HOST` (`:3613`) | `startAudioThen()` → `ensureAudio()` | nada |
| Nebularp | `const ZA = (!HOST && …) ? ZD.audio : null` (`Nebularp_2035.html:2900`) | `ZA && …` | `ZA ? ZA.unlock() : resumeAudio()` | nada |

Qué hace Acid de más con `HOST`: cada gesto llama a `HOST.ctx.resume()` desde
el iframe, arranca un `<audio>` silencioso y fija `audioSession` dentro del
iframe, pide wake lock al dar play y, si el contexto del hub se suspende con el
secuenciador andando, muestra su propio overlay "Tocá para reanudar" adentro del
iframe. Nada de eso rompe el hub hoy (`resume()` sobre un contexto corriendo no
hace nada), pero contradice lo que dicen los otros cuatro ("con el hub el
contexto es del host") y lo que ya decidió `zd-store` (con `HOST` el
autoguardado va apagado porque el host es el dueño del estado).

**Criterio propuesto (uno solo para los 5):** con `HOST`, el instrumento **no
usa `zd-audio`**: ni `attach`, ni `bindGesture`, ni `unlock`, ni `setPlaying`.
El hub es dueño del `AudioContext`, del destrabe, de `audioSession`, del wake
lock y del aviso de reanudar; el instrumento solo arma su grafo sobre
`HOST.ctx`. El patrón más limpio es el de Nebularp
(`const ZA = (!HOST && window.ZD && ZD.audio) ? ZD.audio : null` y usar `ZA`).
Habría que dejarlo escrito en `docs/zd-blocks.md` junto a la decisión de
`zd-store`.

**Para alinear Acid** hay que tocar ~9 lugares (los de la tabla). No es una
línea, son líneas que dependen de `HOST` y el hub vive fuera de este repo: lo
tiene que hacer la sesión de Acid, verificando con el hub real que nadie dependa
hoy del overlay de reanudar adentro del iframe (SPEC 3.1.3: si afecta al
adaptador C2, parar y avisar; este cambio no toca el adaptador, pero sí su
contexto).

## e · Peso

Medido sobre `main` después del sync (bytes del archivo y gzip -9 de Node):

| Instrumento | Archivo | gzip | `data:` grandes |
|---|---|---|---|
| Acid | 243,2 KB | 89,3 KB | 1 logo (39,9 KB) |
| CronBeat | 292,9 KB | 101,5 KB | 1 logo |
| J4 | 306,1 KB | **129,5 KB** | **2 logos** (79,7 KB) |
| MonoMoon | 310,2 KB | **127,3 KB** | **2 logos** (79,7 KB) |
| Nebularp | 253,4 KB | 93,1 KB | 1 logo |

El logo es el **mismo JPEG** en los 5 (sha1 `590eebf790…`): 420×316, 30 598
bytes, 40 800 caracteres en base64. En J4 y MonoMoon va dos veces:

- MonoMoon: pantalla de encendido (`MonoMoon70.html:2575`, `#powerOvl`, 130 px
  de alto) y header (`:2586`, `.brand`, 64 px).
- J4: header (`J4-Sirens_Station.html:2641`, `.brand`) y pantalla de encendido
  (`:2811`, `#power`).

gzip no ayuda: las dos copias están a más de 32 KB una de otra (la ventana de
deflate), así que la segunda viaja entera (~30 KB más). Por eso J4 y MonoMoon
pesan ~30 KB más que los otros comprimidos. El ZIP lleva 7 copias del logo.

**Propuesta (en orden de preferencia):**

1. **Una sola copia por archivo, la segunda toma el `src` en runtime.** El
   `<img>` del header queda como está (`zd-mobile` lo busca con
   `document.querySelector('.zd-logo, .brand img').getAttribute('src')` para el
   logo de la barra). El de la pantalla de encendido pasa a
   `<img class="zd-logo" data-zd-logo alt="Zero Day · Music Exploits">` y un
   `<script>` inline, justo después del último de los dos, copia el `src`:
   `document.querySelectorAll('img[data-zd-logo]').forEach(i => i.src = document.querySelector('.brand .zd-logo').src)`.
   Sigue siendo un HTML autocontenido, el `alt` no cambia y la pantalla de
   encendido no parpadea (el script corre en la misma pasada del parser).
   Ahorra 39,9 KB (−13 %) en J4 y MonoMoon y ~30 KB comprimido.
2. **Re-codificar el logo** (decisión de marca, cambia los bytes de la imagen):
   el tamaño más grande al que se muestra es 130 px de alto (MonoMoon), o sea
   260 px en pantallas 2×. Un 346×260 en JPEG q≈80 o WebP (Safari 14+) debería
   quedar en 10–18 KB; serían ~15–25 KB menos por copia en los 5 y ~100 KB menos
   en el ZIP. Hay que mirarlo antes de aplicarlo.
3. Descartada: definir el logo una vez como `--zd-logo:url(data:…)` en CSS y
   usar `background-image`. Ahorra lo mismo que la 1, pero cambia el `<img alt>`
   por `role="img"` y rompe la búsqueda del logo que hace `zd-mobile` (habría que
   pasar `ZD_M.logo`).

La 1 es un cambio de markup en dos instrumentos: queda para sus sesiones C.

## f · Claves v1 de `window.ZD_M`

**Nada lee `title`, `slots`, `place` ni `menus`** en los 5:

- `zd-mobile` v4 lee de `window.ZD_M` solo `name`, `titleParts`, `logo`,
  `logoAlt`, `transport`, `keep`, `tabs` (y de cada tab `id`, `label`, `title`,
  `nodes`, `peek`), `menuTitle`, `menu`, `menuNotes`, `onEnter`, `onExit`
  (`grep -o "C\.[a-zA-Z]*" tools/blocks/zd-mobile.html`). `menus` ≠ `menu`.
- Ningún otro bloque menciona `ZD_M`. En el código propio de los 5, la única
  aparición es la definición. Los 5 adaptadores C2 (`const api = {…}` y
  `HOST.registerInstrument(api)`) no lo exponen.
- Fuera de los instrumentos: `assets/mail-gate.js` solo lo nombra en un
  comentario; `legacy/` no lo menciona; lo leen además
  `tools/tests/zd-mobile-cycle.test.mjs` (`keep`, `transport`, `tabs`, `name`).

Historial: los 5 tenían la config del shell v1
(`{name, title, slots, place, menus}`, ver `618d8a5`). **Acid, CronBeat,
MonoMoon y Nebularp** sacaron `title/slots/place/menus` al pasar a v4; **J4** las
conserva (`J4-Sirens_Station.html:1815-1825`) y agrega las v2 con
`Object.assign` (`:1826`), citando SPEC 3.1.3 ("se le pueden agregar claves,
pero no se renombra ni se quita ninguna existente").

O sea: J4 cumple la letra de la SPEC y los otros cuatro su intención (no romper
C2: el nombre `window.ZD_M` se mantiene en los 5).

**Criterio propuesto:** enmendar SPEC 3.1.3 para que diga qué es contrato:
"`window.ZD_M` no se renombra, y no se quita ninguna clave que lea `zd-mobile`
o C2. Las del shell v1 (`title`, `slots`, `place`, `menus`) ya no las lee nadie
y se pueden borrar." Con eso, la sesión de J4 borra las líneas 1815-1825 y deja
un solo literal. Antes de cerrar el punto, confirmar con quien mantiene el hub
C2 (está fuera de este repo) que no lee `iframe.contentWindow.ZD_M`; acá no se
puede verificar.

## Otros hallazgos de la sesión (bloques)

Cosas que aparecieron al escribir los tests de la tarea 1. Ninguna rompe nada
hoy; ninguna se tocó (cambiarlas es subir otra versión de bloque).

- **`zd-store` · `load()` llama dos veces a `migrate` si rechaza**
  (`tools/blocks/zd-store.html:114` y `:118`). Si la Promise de `migrate`
  rechaza en la rama `.then`, cae al `.catch`, que la vuelve a llamar. Quedó
  documentado en `docs/zd-blocks.md` ("que no rechace"); el arreglo de fondo
  sería no reintentar en el `.catch` cuando el error vino de `migrate`.
- **`zd-rec` · el worklet de captura se cachea por página, no por contexto**
  (`tools/blocks/zd-rec.html:65-68`, `tapReady`). Un `addModule()` vale para
  un solo `AudioContext`: si un instrumento cerrara y recreara su contexto, la
  segunda toma no encontraría `zd-rec-tap` y caería en silencio a
  MediaRecorder. Ninguno de los 5 recrea el contexto hoy: es latente.
- **`zd-ui` · al cerrar un modal, si el foco volvía a `<body>`, se queda 180 ms en
  el input del modal que se va** (`tools/blocks/zd-ui.html:138-139`:
  `body.focus()` no hace nada y el scrim se saca con un `setTimeout`). Un
  segundo modal abierto en esa ventana recibe la primera tecla en el input
  viejo. Lo encontró el test `zd-ui-prompt` (lo esquiva esperando a que no
  quede ningún `.zd-scrim`). Arreglo posible: `prevFocus.blur()` del input o
  sacar el scrim del DOM sin esperar la transición cuando se abre otro.
- **SPEC desactualizada en versiones:** `docs/SPEC.md:23`, `:53` y `:115`
  citan `zd-pwa` (v2) (y la lista de `:115` no tiene versiones nuevas). La SPEC
  remite a `docs/zd-blocks.md` para versiones; no la toqué.
- **Comentarios que quedaron viejos:** J4 (`getRecorder()`,
  `J4-Sirens_Station.html:3597-3598`) y MonoMoon (`startTake()`,
  `MonoMoon70.html:3797-3798`) dicen que `zd-rec` descarta la toma del tope;
  con v2 ya no. El workaround sigue siendo válido. J4 además selecciona el
  input del prompt a mano (doble `requestAnimationFrame`), redundante con
  `zd-ui` v2.
