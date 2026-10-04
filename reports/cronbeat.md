# CronBeat-8:08 — reporte de la sesión C (rama `c-cronbeat`)

Archivo: `descargables/CronBeat-808.html` (slug `cronbeat`). Base de la rama:
`8bef265`. Requisitos SPEC R1–R7 y Anexo 3.4 cumplidos y verificados en
Chromium (Playwright); los cuatro extras del anexo también, en commits aparte.
**Nada se probó en un iPhone, un iPad ni un Android reales**: todo lo que
depende del dispositivo está en "A verificar en dispositivo", al final.

No toqué el ZIP, `data/instrumentos.json`, `sw.js`, `manifests/`, `icons/`,
`docs/`, `tools/` ni otros instrumentos. Los bloques ZD van byte a byte.

## Flags para el sitio (`data/instrumentos.json`, lo aplica la sesión D)

| Flag | Antes | Ahora | Por qué |
|---|---|---|---|
| `exporta` | `["WAV","MIDI","JSON"]` | `["WAV","MIDI","JSON"]` | Los tres se mantienen, ahora por `zd-dl` (Web Share en iOS) y con nombre con fecha. |
| `guarda` | `true` | `true` | Autoguardado local, ahora con `zd-store` (R3) y migración sin pérdida. |
| `app` | `false` | **`true`** | Manifest estático + SW por `zd-pwa` v2. Chromium sobre http: `Page.getInstallabilityErrors` → `[]`, manifest sin errores, SW controlando. |

Para el manual y el roadmap de esa misma entrada (sugerencia, no lo toqué):

- El `roadmap` dice que los choke groups están pendientes: ya están (opcional,
  "Choke hats").
- Faltan en el manual: el teléfono (la pista elegida en 2×8 arriba de los pads;
  tocar un pad elige su pista; ◀ ▶; ACENTO; pestañas PADS/SEQ/FX/SAMPLE/CANCIÓN),
  deshacer/rehacer (↶ ↷, Ctrl+Z), velocidad por altura, note repeat, choke de
  hats, el LED de CLIP y "Empezar de cero" (que reemplaza a "Reiniciar
  proyecto" en el menú del teléfono; en escritorio el botón sigue igual).

## Commits

| Commit | Requisito | Qué |
|---|---|---|
| `8ef497a` | bloques + R1 | 8 bloques pegados; shell portrait v4; fuera shell v1, `#zd-rotate`, `maximum-scale`/`user-scalable=no`. |
| `87d985e` | R2 | Manifest estático, canonical, íconos, `theme-color` #fab72a; fuera el manifest `blob:`. |
| `0105be0` | R5 | `zd-audio` (destrabe en el gesto, interrupciones, wake lock), `latencyHint`, decode en forma Promise. |
| `25de66d` | R3 | Autoguardado envuelto con `zd-store`, migración, restauración sin audio, "Empezar de cero" con modal. |
| `7bc3e16` | R4 | JSON/MIDI/WAV por `zd-dl`, nombres con fecha, envoltorio JSON y validación al importar. |
| `569840f` | R6 | ARIA, `innerHTML`, atajos de teclado, errores en modal, tipografía y contraste. |
| `e983231` | R7 | Marca y copy. |
| `efc5da9` | R5 | Indicador de clip (solo mide). Quedó después de los extras porque lo detecté al revisar R5 contra el piloto. |
| `132c2f7`, `79e8d6e` | verificación | `tools/tests/cronbeat-verify.test.mjs`. |
| `3fb0cb4` | extra | Deshacer / rehacer. |
| `4856d1f`, `137eba6` | extra | Velocidad por altura del dedo y note repeat (+ ajuste de timing). |
| `59c0786` | extra | Choke de hats. |

El commit `8ef497a` deja un error de consola conocido (el `HEAD` de `zd-pwa`
contra el manifest `blob:`), que se va en `87d985e`. Lo dice el mensaje del
commit.

## Decisiones

**Zona de tocar (R1).** El desktop tiene 16 pistas × 16 pasos: no entra en
360 px. En el shell, `#zd-stage` muestra **una** pista del secuenciador en 2
filas de 8 (38×48 px a 360 px de ancho) arriba de los 16 pads (4×4, cerca del
pulgar). Tocar un pad lo hace sonar y elige su pista. ◀ ▶ cambian de pista sin
sonar. "A" abre la pestaña SEQ. ACENTO reemplaza al shift, que no existe en
táctil. Es CSS sobre los mismos nodos: las filas no elegidas se esconden, y
los 4 grupos de pasos pasan a `display:contents` para que los 16 botones sean
celdas de una grilla de 8 sin perder el color de su tiempo (la variable CSS se
hereda por el DOM). Landscape: pasos a la izquierda y pads a la derecha, en
grid (con flex-wrap, la línea medía lo que pedía el contenido y los pads se
iban debajo de las tabs).

**Pestañas.** PADS = opciones de ejecución + mezcla por pad (M/S/VOL/PAN/sample)
+ ayuda. SEQ (*peek*) = patrones A–H, copiar/pegar, ↶ ↷, metrónomo, aleatorio,
limpiar, tempo ± / tap, swing, master. FX (*peek*) = las 4 tarjetas y los
envíos por pista. SAMPLE = el editor (canvas de 150 px, `touch-action:none`,
redibuja al abrir el sheet o al rotar). CANCIÓN = canción + archivo (JSON,
abrir, MIDI, compases, WAV). La mezcla por pad no tiene estado propio: cada
control dispara el control equivalente de la fila del secuenciador, así hay un
solo estado.

**Barra superior.** TOCAR (solo ▶/■ en el shell), REC y BPM editable, todos de
44 px. Tempo ± y tap van a SEQ. El LED de CLIP aparece encima del logo, para no
robarle ancho a la barra (a 360 px, con el ↓ de instalar, sobran ~14 px).

**Selectores de `ZD_M`.** Solo ids: `#run #rec #bpmBox #clipLed`,
`#seq #pads`, `#padOpts #padMix #padsHint`, `#patbar #seqActs #tempoBox
#globKnobs`, `#fxView`, `#editorView`, `#songView #fileGrp`. `keep[0]` es
`#seq`. En un táctil sin shell (más de 1024 px) la vista de escritorio por
defecto es "Pads en vivo", así que `#seq` no tiene caja ahí: `zd-mobile-cycle`
lo avisa ("descartados: div#seq") y prueba el foco sobre `#pads`. Es lo
esperado. Ninguno es `display:contents`.

**`.wrap`.** El bloque esconde `.wrap` y el chasis de CronBeat era `.machine`:
quedó `<div class="machine wrap">`. Ver el pedido 1.

**Autoguardado (R3).** No reescribí el formato: el dato sigue siendo
`buildProject()` (patrones, canción, FX, mezcla y samples en base64), ahora en
`zd:cronbeat:session` con `{app:'cronbeat-808', version:4, savedAt, data}`.
`migrate()` lee `caja-ritmos-db/projects/autosave` sin crear la DB si no existe,
restaura, copia a la clave nueva y deja la anterior intacta. Solo "Empezar de
cero" la borra (si no, volvería por la migración). Para restaurar **sin crear
el AudioContext**, los samples se decodifican en un `OfflineAudioContext` a 48
kHz y `resyncSamples()` los vuelve a decodificar a la frecuencia real en el
primer gesto (`onResumed` de `zd-audio`). `setSampleFromBytes` ahora fija los
parámetros del editor antes de decodificar. Antes, un guardado durante la
decodificación los pisaba con los de fábrica. Una sesión de versión más nueva
no se restaura ni se pisa.

**Con el hub C2 el autoguardado queda apagado** (decisión de
`docs/zd-blocks.md`). Es un cambio de comportamiento dentro del rig: antes, la
caja embebida restauraba su propio autoguardado, y con eso le pisaba al hub el
tempo que acababa de alinear. Además, dos cajas en el rig escribían la misma
clave. Ahora, lo que se carga dentro del rig (por ejemplo, samples) no lo
persiste CronBeat. `api.getState()` solo lleva la grilla del patrón activo, así
que lo tiene que decidir quien mantiene el hub.

**Exportación (R4).** `cronbeat-YYYYMMDD-HHmm.json`,
`cronbeat-patron-a-….mid` / `cronbeat-cancion-….mid`, `cronbeat-patron-a-….wav`:
empiezan con el slug y llevan qué es. El JSON exportado es el mismo envoltorio
que la sesión; el import acepta ese envoltorio y el proyecto suelto de
versiones anteriores (`app:'caja-de-ritmos'` adentro se mantiene a propósito),
y rechaza en un modal otra app, una versión más nueva, un JSON roto o un MIDI
ilegible. El WAV se renderiza igual que antes, pero el resultado queda en la
tarjeta de `zd-rec` (escuchar + ↓ DESCARGAR WAV): en iOS el gesto vence durante
el render offline y Web Share lo rechazaría. Fuera de iOS además se descarga
directo, como antes. El MIDI sigue saliendo del escritor SMF propio (canal 10,
GM); de `zd-midi` solo se usa `support()`. Saqué las ramas
`window.claude.use('downloads')` y el zip que armaban: eran de otro entorno.

**Audio (R5).** `zd-audio` solo en standalone. Con hub no se engancha, porque
el contexto es del hub (el piloto lo engancha siempre: ver hallazgos). El wake
lock entra por `setRunUI()`, así no toqué `start()`/`stop()`. AudioContext
propio con `ZD.audio.options()`: `latencyHint:'interactive'` es el valor por
defecto, así que el sonido no cambia. Indicador de clip: un `AnalyserNode` en
la salida del compresor del master. `buildEngine()` solo expone `E.comp`.
**Sin limitador**, ver riesgos.

**R6.** `aria-pressed` en pasos, M/S, REC, TOCAR, metrónomo, loop, patrones,
drive, toggles del editor, ACENTO y vistas. Los pads grandes son
`role=button` + teclado. Su `aria-pressed` marca el **pad elegido** (en el
shell, su pista es la que se edita arriba): es el único estado persistente que
tiene un disparador momentáneo. Los atajos ya no le roban teclas a quien las
necesita: antes ←/→ sobre un slider cambiaba el tempo y el slider no se movía.
`toast()` delega en `ZD.toast`. Quitar un sample deja "Deshacer". Ninguna
declaración por debajo de 11/12 px. `--zd-ink-faint` y `--zd-phosphor-txt`
como en el piloto.

**Extras.** *Deshacer/rehacer* cubre pasos, operaciones de patrón, MIDI
importado, REC y canción (no samples/FX/mezcla); una ráfaga de REC es un paso.
*Velocidad por altura* (arriba fuerte, abajo suave) y *note repeat* (1/8, 1/16,
1/32) son preferencias del dispositivo (`localStorage zd:cronbeat:prefs`), no
del proyecto. El repeat va con el look-ahead del secuenciador; sonando cae en la
grilla con swing, y con REC graba sin disparar dos veces un paso. *Choke hats*
(hat cerrado ↔ abierto, rampa de 8 ms) va apagado por defecto y **se guarda con
el proyecto** (campo nuevo `choke`; los proyectos anteriores abren apagados).
Apagado, `trigger()` conecta la voz directo, igual que antes.

## Verificación

```
node tools/check-blocks.mjs                       # sin diferencias (Acid y CronBeat)
node tools/sync-blocks.mjs --check                # 16 idénticos, 0 diferencias
node tools/tests/run.mjs                          # 3 archivos en verde (Acid sin cambios)
node tools/tests/zd-mobile-cycle.test.mjs --file descargables/CronBeat-808.html --cycles 4   # 7/7
node tools/tests/cronbeat-verify.test.mjs [--shots <dir>]  # 24/24, tres corridas seguidas en verde
```

Lo que cubre `tools/tests/cronbeat-verify.test.mjs` (molde: `acid-verify`, helpers de
`tools/tests/lib/` sin modificar):

- **R1.** 360×640, 390×844, 430×932, 768×1024, 844×390, 1440×900 y 1024×768:
  shell sí/no, sin scroll horizontal, sin `#zd-rotate`, barra ≥44 px, pasos
  38–89 × 48–104 px, pads ≥62 px, nada debajo de las tabs, 0 errores ni
  warnings. Las 5 pestañas y el menú a 360×640, sin scroll horizontal y con
  targets ≥44 (patrones A–H 39×48 en grilla de 8). Pad → pista, ◀ ▶ y ACENTO.
- **R2.** Banner a 360×640 (82 px; pads quedan en 82×62) y 390×844, primer
  hijo de `#zd-stage`, sin superposición con TOCAR/REC/BPM/menú/barra de
  pista/pasos/pads. `beforeinstallprompt` sintético: Instalar → `prompt()` ×1
  (aceptado: el banner se va; rechazado: un segundo clic no vuelve a llamar a
  `prompt()`, ver pedido 3). "Ahora no" → no vuelve; a los 15 días, sí. El ítem del menú sigue disponible. Standalone: nada. Iframe sin hub:
  `zd-pwa` inerte, 0 CSS, 0 errores. `file://`: solo el aviso con [Abrir web] →
  canonical y 0 pedidos de red. http: SW `../sw.js` registrado. Capturas
  (`--shots`) revisadas a mano.
- **R3.** Patrones A y C, canción, FX, drive, mezcla y un sample con edición →
  recargar → idéntico, con `ctx === null` tras restaurar y re-decodificado
  48000 → 44100 Hz en el primer gesto. Envoltorio verificado en IndexedDB.
  Migración desde `caja-ritmos-db` (la anterior intacta) y "Empezar de cero" con
  modal → limpio y sin toast.
- **R4.** JSON con sample; MIDI parseado con `tools/tests/lib/smf.mjs` (32
  notas, 0 defectos); WAV RIFF PCM 16-bit estéreo a la frecuencia del contexto,
  con tarjeta. Ida y vuelta del JSON (sample incluido) y del MIDI. JSON de otra
  app → modal. Con UA de iPhone, las tres salen por Web Share con archivo.
- **R5.** Sin autoplay: sin gesto no hay contexto; tocar → `running`; wake lock
  pedido/soltado; suspend → overlay → tocar → `running`; `visibilitychange`
  reanuda. Rotación 1180×820 ↔ 820×1180 ×4 sonando: no se corta, el
  secuenciador avanza, el stage se rearma. CLIP: apagado con el patrón inicial,
  prendido con un patrón denso, se apaga al parar.
- **C2.** Hub simulado (`window.parent.C2`): registra una vez, usa el contexto y
  el tempo del hub, TOCAR va por `HOST.transport`, sin `setTimeout` propio, 72
  ticks = 3 pasos, no escribe sesión, `zd-audio`/`zd-pwa` inertes.
- **Extras.** Deshacer/rehacer; velocidades 0,99 / 0,63 / 0,26; repeat a 117 ms
  (1/16 a 128 BPM) que se corta al soltar; REC + repeat sin duplicados; choke
  que corta la cola en un render offline y se guarda.

**El adaptador C2 no cambió.** El test compara contra `8bef265`: el `<script>`
del adaptador entero, `const HOST`…`SLOT_ID`…`C2_*`, la rama HOST de
`ensureAudio()` y `scheduler()`…`start()`…`stop()` son idénticos. Diff
filtrado (`git diff 8bef265 -- descargables/CronBeat-808.html | grep -E
"HOST|zeroday_sync|registerInstrument|transport\."`, fuera de los bloques ZD):
0 líneas borradas, y solo agregados que **leen** `HOST` para apagar lo propio
cuando hay hub:

```
+  if(!HOST && window.ZD && ZD.audio) ZD.audio.setPlaying(p); }
+  if(HOST || !(window.ZD && ZD.store)) return;
+if(!HOST && window.ZD && ZD.audio){
+  const div=repeatDiv(), grid=isPlaying && !HOST;
+    if(isPlaying && !HOST){
```

Conteos: `zeroday_sync` 1 → 1, `registerInstrument` 1 → 1, `transport.` 4 → 4.

No corrí Lighthouse (no hay red en este entorno). Queda para la sesión D o
para hacerlo con el sitio publicado.

## Pedidos de cambio a bloques

En `reports/cronbeat-block-request.md`. Los tres son de prioridad baja y no
bloquearon nada:

1. `zd-mobile`: el contenedor que se esconde está fijo en `.wrap`. Basta con
   documentarlo o hacerlo configurable.
2. `zd-audio`: `onResumed` corre en cada gesto, no solo al reanudar (medido: 6
   clics → 12 llamadas).
3. `zd-pwa`: después de rechazar el prompt nativo, el banner sigue ofreciendo
   "↓ Instalar" y un segundo clic solo muestra un toast. Pasa igual en Acid.

## Riesgos

- **Clipping.** Medido en el WAV: patrón inicial -1,6 dBFS (master 82) y -0,8
  dBFS (master 100); con las 16 pistas con acento en cada negra satura. El
  DynamicsCompressor del master ya estaba y no lo toqué. Propuesta, sin
  aplicar: un limitador real al final o bajar el master por defecto. Se decide
  con quien apruebe cambios de sonido.
- **Autoguardado grande.** Con muchos samples la sesión pesa varios MB en
  IndexedDB (el base64 ahora se cachea por sample). Si IndexedDB no está
  disponible, el fallback a `localStorage` (~5 MB) puede fallar en silencio:
  `zd-store` no avisa.
- **Hub.** Ver la decisión de autoguardado. Además, ya antes de esta sesión,
  `quantizedStep()` usa `playStartTime`, que `onTransport('play')` no actualiza:
  REC dentro del rig graba en pasos corridos. No lo toqué porque es transporte
  C2; lo dejo anotado. El note repeat embebido corre libre, sin alinearse al
  reloj del hub.
- **Primer golpe en iOS.** Los pads disparan en `pointerdown` y el destrabe
  completo de `zd-audio` ocurre en `pointerup`/`touchend`: en iOS el primer
  golpe podría salir mudo.
- **Tamaño.** El HTML pasó de 178.877 a 296.353 bytes; casi todo son los 8
  bloques.
- **El render offline de Chromium no es bit-exacto entre corridas** (1,4e-7
  entre dos renders del mismo original). Para el choke apagado comparé con esa
  tolerancia: la diferencia es la misma.

## Hallazgos para otros instrumentos

- El contenedor principal tiene que llevar la clase `.wrap`, o el shell no lo
  esconde.
- **Atajos de teclado globales** que hacen `preventDefault` de ←/→ o espacio le
  roban las teclas a los sliders y a los diálogos. Conviene revisarlo en los
  otros cuatro.
- **WAV después de un render async en iOS**: el gesto vence. Hay que mostrar el
  resultado en la tarjeta de `zd-rec` (como Acid y ahora CronBeat). MonoMoon
  ("WAV mantener") va a necesitar lo mismo.
- **Restaurar samples sin crear el AudioContext**: `OfflineAudioContext` +
  re-decodificar en `onResumed`. Sirve para cualquier instrumento con buffers
  propios.
- **`zd-audio` con hub**: Acid hace `attach` + `bindGesture` siempre, así que
  sus gestos llaman a `resume()` sobre el contexto del hub. CronBeat no lo
  engancha con `HOST`. Habría que unificar el criterio.
- **Landscape**: si el stage pasa a fila con flex-wrap, la línea no se achica.
  Mejor grid, con una fila `auto` para el banner de `zd-pwa`.
- **Sliders táctiles**: caja del `<input type=range>` de 44 px con la pista
  dibujada por pseudo-elementos; si la pista es el propio input (6 px), el dedo
  no lo agarra.
- **Grillas de steps agrupados**: `display:contents` en los grupos conserva las
  variables CSS heredadas.
- **`zd-store`**: `migrate` puede devolver una Promise (`load()` la encadena).
  La doc lo muestra sincrónico.

## A verificar en dispositivo

En iPhone (Safari **y** PWA instalada), iPad y Android Chrome:

- [ ] Primer toque: ¿suena el primer golpe en un pad (`pointerdown`) o sale
      mudo hasta el `pointerup`?
- [ ] Switch de silencio activado: suena (`audioSession` / `<audio>`
      silencioso).
- [ ] Bloqueo de pantalla, llamada entrante, Siri y segundo plano: aparece
      "Tocá para reanudar" y vuelve a sonar.
- [ ] Wake lock: la pantalla no se apaga mientras suena y se apaga al parar.
- [ ] Rotación real (iPhone; iPad Pro 12,9", que cruza los 1024 px) sonando.
- [ ] Multitouch en pads (dos o tres dedos), note repeat con el dedo apoyado
      (gestos del sistema → `pointercancel`) y velocidad por altura.
- [ ] Editor de sample: arrastrar inicio/fin en el canvas dentro del sheet sin
      que el sheet se cierre ni scrollee.
- [ ] BPM editable en la barra superior: teclado numérico y layout con el
      teclado abierto.
- [ ] Web Share de JSON y MIDI desde el botón, y de WAV desde la tarjeta, en
      iOS Safari y standalone.
- [ ] Instalación: Android (banner y prompt), iOS (hint Compartir → Agregar a
      inicio), abrir offline (modo avión) y actualizar versión (toast "Nueva
      versión").
- [ ] Persistencia: `storage.persist()`, sesión con varios samples grandes y el
      vaciado de Safari a los ~7 días sin instalar.
- [ ] Samples OGG/MP3 en Safari (decodificación y restauración); aviso si no
      decodifica.
- [ ] LED de CLIP en Safari (AnalyserNode con rama muda al destino).
- [ ] Rendimiento con los 16 pads con sample y la canción larga.
- [ ] Lighthouse móvil sobre el sitio publicado: Accesibilidad ≥90, Best
      Practices ≥90, instalable.
