# QA en dispositivos reales

Lista única de lo que **no se pudo probar** en Chromium/Playwright (SPEC 3.1.8:
no se afirma "funciona en iOS" sin haberlo probado). Consolida las listas "A
verificar en dispositivo" de `reports/cronbeat.md`, `reports/monomoon.md`,
`reports/nebularp.md` y `reports/j4.md`, más `docs/pwa.md` y los hallazgos de
`reports/D1-barrido.md`. Acid Bass-303 no tiene reporte propio: sus puntos
salen de las pruebas compartidas y del barrido (apartado "Primer toque").

**Estado: casi ningún punto está probado en un dispositivo.** La excepción: el
usuario instaló los 5 instrumentos en su Android el 2026-10-05, después del
cambio de scope (apartado 4; no se anotó el modelo ni la versión de Chrome, y
no cubre el resto de esa prueba). Tampoco se probó en WebKit ni en Firefox.

**Actualizado por E1 (2026-10-04, `reports/E1.md`).** Cambió lo que hay que
mirar en el primer toque (el golpe ya no se programa con el audio suspendido:
sale al levantar el dedo), en los atajos de teclado de CB y AC, en el MIDI de
MM (ahora con un botón «Conectar MIDI») y en el pad XY de MM (lectores de
pantalla). Se agregaron el favicon de los 5 y el arreglo de Acid que creaba
varios `AudioContext` en el primer gesto. Todo eso está medido en Chromium,
con la regla de gestos de iOS **emulada**: falta el dispositivo. Cuando alguien pruebe, marca la casilla y anota
dispositivo, sistema operativo, navegador y fecha al final de la línea.

**Actualizado con la tabla de instalación del sitio (2026-10-05).** La tabla de
«Instalar en la computadora y en el teléfono» (índice y README) sale de MDN,
caniuse y las notas de Firefox 143; **ninguna fila se probó en el dispositivo**.
Lo que falta mirar está en los apartados 2 (iPhone), 4 (Android) y 5 (escritorio).

**Actualizado con MUTE y BURNOUT de J4 (2026-10-05).** Dos botones nuevos en el
deck: MUTE (silencia la salida mientras se mantiene) y BURNOUT (silencio total
hasta otro toque). Medidos en Chromium (`tools/tests/j4-mute.test.mjs`); falta
el pulgar en el teléfono y el cambio de app (apartados 1 y 3; en Android, lo
mismo que en el 1).

**Actualizado con F3 y F3b (2026-10-06 y 2026-10-07,
`reports/F3-barrido-scroll.md`).** Los sheets de los 5 tienen un carril de
scroll lateral (`zd-mobile` v5: 32 px a la derecha sin controles). Los sliders
de los sheets de los 5 ya no saltan al tocarlos ni frenan el scroll (arrastre
horizontal relativo: CronBeat adentro, los otros 4 con `zd-sheet-input` v1). Los
knobs de los sheets de Acid, Nebularp, MonoMoon y J4 se ajustan con arrastre
**horizontal** y el swipe vertical scrollea (antes un swipe sobre un knob nunca
scrolleaba y cambiaba el valor). El ✕ de la cabecera mide 44×44 (`zd-mobile` v6)
y los botones de onda de MonoMoon OSC miden ≥44 de ancho a 360 px. Medido en
Chromium con toques por CDP; **ningún gesto se probó con un pulgar ni en iOS**:
falta (apartado 1, "Toque y layout", y lo mismo en Android).

**Actualizado con F2b (2026-10-06, `reports/F2b.md`).** El VCA de J4 queda en 0
exacto en reposo: encendido y sin tocar nada ya no sube solo a −14 dBFS.
Medido en Chromium (`tools/tests/j4-reposo.test.mjs`); falta escucharlo en el
teléfono (apartado 1). Sin arreglar: después de una nota el eco se autosostiene.

**Actualizado con F2c (2026-10-06, `reports/F2c.md`).** El eco de J4 se apaga
solo: con ∞ apagado la ganancia del lazo tiene un techo que depende del TIME,
y la perilla FEEDBACK se reescaló para que su máximo sea ese techo. Con ∞ sigue
autooscilando como antes. Medido en Chromium (`tools/tests/j4-cola.test.mjs`);
falta escucharlo en el teléfono (apartado 1).

**Actualizado con F2d (2026-10-06, `reports/F2d.md`).** El filtro ladder de J4
ya no queda en NaN: si el estado pasa √12 se reinicia (antes J4 quedaba mudo
hasta recargar con Acid Scream a 44,1 kHz o con el pad XY en la esquina de
arriba a la derecha). Medido en Chromium (`tools/tests/j4-ladder.test.mjs`);
falta el teléfono (apartado 1, "Persistencia"). En la misma tanda
(`reports/F2d-monomoon.md`): el «colapsa y se reinicia» de MonoMoon era un NaN
del filtro con Mod → Filtro a frecuencia de audio, que lo dejaba mudo hasta
recargar; ahora el filtro se reinicia (el zumbido saturado previo sigue, sin
arreglar). Y el barrido sin arreglos (`reports/F2d-barrido-nan.md`): Acid da
NaN con el `AudioContext` a menos de 32 kHz (su SVF no acota el corte a
Nyquist); Nebularp y CronBeat, finitos.

**Actualizado con F2e (2026-10-07, `reports/F2e.md`).** MonoMoon satura la
realimentación del filtro (para evaluar: se revierte solo): ya no puede quedar
mudo, pero con Mod → Filtro a frecuencia de audio el zumbido saturado sigue
(medido); se iría con otro cambio, todavía no aprobado. Acid acota el corte de
su filtro: ya no da NaN a menos de 32 kHz, y a 44,1 kHz o más suena idéntico.
J4: el final del release ya no tiene el escalón intermitente de −112 dB
(inaudible). Medido en Chromium; falta el teléfono (apartado 1,
"Persistencia").

**Actualizado con los scopes de los manifests y el cierre de F2 y F3
(2026-10-07).** Cada manifest tiene como scope su propio archivo (antes
compartían `"scope": "../"` y, en Android, la app instalada de Acid capturaba
los links a los otros 4 y no dejaba instalarlos; `docs/pwa.md`, test
`pwa-scopes`). Se agregaron al P0-2 la prueba de los 5 en el mismo teléfono
(apartado 4), y quedaron en la lista las verificaciones de `reports/F2b.md` a
`F2e.md` que faltaban (recarga con sesión guardada y nota durante el release,
TIME y FEEDBACK al máximo, sesiones de antes del techo del eco, doble toque de
las macros de MM, WebKit y Firefox) y las de Android de J4, CronBeat y las
demás. `sw.js` pasó a `zd-v5`.

**Actualizado con los íconos y favicons nuevos (2026-10-08).** Los 5
instrumentos tienen íconos nuevos (la ventana de terminal con su número y el
nombre abajo, `icons/`), un favicon de 32 px propio en cada HTML, y el sitio
estrena su favicon «0xD». Medido en Chromium: tamaños, opacidad, fondo y zona
segura del maskable (`tools/check-icons.mjs`), instalabilidad y que los íconos se
sirven (`tools/tests/icons-install.test.mjs`). **Ninguno se vio en un
dispositivo real**: faltan el ícono adaptativo en Android (apartado 4), el
apple-touch en iOS (apartado 2) y la pestaña con el favicon de 32 px (apartado
5). **Una app ya instalada puede tardar en actualizar el ícono** (en Android a
veces hay que reinstalarla): probar con una instalación limpia. `sw.js` pasó a
`zd-v7`.

Instrumentos: **CB** CronBeat-8:08 · **MM** MonoMoon'70 · **NB** Nebularp 2035
· **J4** J4-Sirens Station · **AC** Acid Bass-303. "Todos" = los 5.

## Prioridad

- **P0 — bloquea el lanzamiento.** Si falla, el instrumento no sirve en el
  teléfono: primer toque en iOS con el switch de silencio, instalar y abrir
  offline, rotación de tablet y Web Share de WAV/MIDI/JSON.
- **P1 — se corrige antes de anunciar.** Afecta una función central, pero hay
  rodeo.
- **P2 — conviene ver; puede ir después.**

Los P0 son 4 pruebas (**P0-1 a P0-4**) que se repiten en más de un apartado;
se marcan en cada lugar donde se ejecutan.

## Resumen de los P0

| # | Prueba | Dónde se hace | Qué mirar |
|---|---|---|---|
| P0-1 | Primer toque en iOS con el switch de silencio | iPhone Safari y PWA | Con el switch activado y desactivado, **el primer golpe/nota suena** (no mudo, no tarde) en los 5 |
| P0-2 | Instalar y abrir offline | iPhone PWA, Android Chrome | Se instala con su ícono y nombre; en modo avión real abre y suena. En Android, los 5 en el mismo teléfono: se instalan por separado y cada uno abre en su ventana (el 2026-10-05 el usuario confirmó que se instalaron los 5) |
| P0-3 | Rotación de tablet | iPad / tablet | Rotar vertical ↔ horizontal **sonando**: sin cortes, el shell se rearma, no se pierde la sesión |
| P0-4 | Web Share de WAV, MIDI y JSON | iPhone Safari y PWA | Los tres archivos salen por la hoja de Compartir y se pueden guardar en Archivos |

---

## 1 · iPhone · Safari

### Primer toque y audio

- [ ] **P0-1** · Todos · Primer toque con el switch de silencio **activado** y
      **desactivado** (`audioSession.type = 'playback'` en Safari 16.4+;
      `<audio>` silencioso en versiones anteriores). Casos por instrumento:
  - CB: primer golpe en un pad grande. Desde E1, si el audio no está
    destrabado el golpe **no** se programa en el `pointerdown`: se dispara al
    levantar el dedo, cuando `zd-audio` destraba. Esperado: el primer golpe
    suena (un poco tarde, lo que dura el toque) y una sola vez; ese primer
    golpe va sin *note repeat*, el siguiente ya con repeat. Ningún golpe
    perdido ni ráfaga.
  - NB: primera tecla del piano. Esperado: suena al levantar el dedo como nota
    corta (~180 ms), o sostenida si el dedo sigue apoyado cuando destraba.
  - AC: primera tecla del teclado y un toque muy corto: la nota no puede
    quedar colgada (E1 lo arregló: sale corta) y el primer gesto crea **un
    solo** `AudioContext` (antes creaba 2–4; iOS limita la cantidad).
  - MM: "Pulsá para encender" destraba y la primera tecla suena; probar también
    tocar una tecla directo, sin pasar por el overlay (sale corta al soltar).
  - J4: "TOCÁ PARA ENCENDER" destraba y el SIREN siguiente suena; el overlay no
    queda trabado si `resume()` tarda.
  - Todos (E1): después de una llamada o de volver de segundo plano **sin**
    que aparezca "Tocá para reanudar" (con todo callado), el primer toque de
    un pad/tecla/SIREN suena al levantar el dedo y no sale mudo. Con el audio
    ya andando, nada cambia: el golpe sale en el `pointerdown`.
- [ ] **P1** · Todos · Bloqueo de pantalla con algo sonando, llamada entrante,
      Siri y segundo plano → volver: aparece "Tocá para reanudar" y un toque
      reanuda. (J4: con la sirena latcheada.)
- [ ] **P1** · Todos · Wake lock (iOS 16.4+): la pantalla no se apaga mientras
      suena y se apaga al parar. MM: ~60 s después de la última nota; J4: se
      puede apagar 15 s después de que todo calla.
- [ ] **P1** · Todos · Sample rate: el audio y el WAV funcionan en equipos que
      alternan 44,1/48 kHz.

### Descargas y archivos

- [ ] **P0-4** · Todos · Web Share con archivo: **JSON** y **MIDI** desde el
      botón, **WAV** desde la tarjeta de resultado de REC (o, en CB, del render
      offline); probar "Guardar en Archivos". Nombre `<slug>-YYYYMMDD-HHmm.<ext>`.
- [ ] **P1** · Todos · Importar un JSON desde Archivos (`<input type=file>`); en
      CB, también un `.mid`.
- [ ] **P1** · MM · NB · J4 · REC en Safari: AudioWorklet o fallback
      MediaRecorder; el WAV sale a 44,1 o 48 kHz según el equipo y se escucha en
      la tarjeta.
- [ ] **P2** · MM · NB · J4 · LED de CLIP: el `AnalyserNode` en paralelo no va al
      destino; en Chromium procesa, falta confirmar WebKit. (CB: ídem.)
- [ ] **P2** · J4 · MIDI de la toma en WebKit: el glide aparece en el bend
      (`osc.frequency.value` durante la rampa) y los analizadores sin destino
      procesan.
- [ ] **P2** · CB · Samples OGG/MP3: decodificación y restauración en Safari; el
      aviso aparece si no decodifica.

### Toque y layout

- [ ] **P1** · Todos · Rotación real vertical ↔ horizontal en el teléfono con el
      instrumento sonando: layout correcto, sin cortar el sonido ni perder la
      sesión. (La rotación de tablet es P0-3.)
- [ ] **P1** · Todos · `dvh` y *safe areas*: el alto útil es correcto con la
      barra de Safari visible y oculta, y en un iPhone con notch. Container
      queries (iOS 16+) donde se usan (teclado/piano en dos filas en MM y NB).
- [ ] **P1** · CB · Multitáctil en pads (2–3 dedos), *note repeat* con el dedo
      apoyado (gestos del sistema → `pointercancel`) y velocidad por altura.
- [ ] **P1** · NB · Multitáctil: acordes de 3 a 5 dedos, glissando entre las dos
      filas del piano; sin notas colgadas al apoyar la palma o al salir del
      piano con el dedo.
- [ ] **P1** · MM · Teclado en dos filas a 375/390 px (blancas de ~38–41 px):
      tocable, glissando entre filas, acordes en Duo con dos dedos, sin notas
      colgadas al salir del teclado. Ruedas de 30 px: arrastre cómodo; Pitch
      vuelve al centro.
- [ ] **P1** · J4 · SIREN con el pulgar y el pad con otro dedo; correr el pulgar
      no corta la sirena; throws con dos dedos. El sheet scrollea con el dedo y
      el pad y SIREN no mueven la página; pinch-zoom permitido fuera de las
      superficies.
- [ ] **P1** · J4 · MUTE con el pulgar: mantener, correr el dedo fuera del
      botón y soltar ahí; con SIREN apretada con el otro pulgar. Cambiar de app
      (gesto de inicio, selector de apps), bloquear la pantalla o recibir una
      llamada **con MUTE apretado**: al volver no queda muteado. En Chromium lo
      sueltan `blur`, `visibilitychange`, `pagehide` y `pointercancel`; en iOS
      falta ver cuál llega primero.
- [ ] **P1** · J4 · BURNOUT: un toque silencia todo (también las colas de un
      eco largo con FEEDBACK ∞), el aviso sobre el pad se lee, otro toque
      vuelve y la nota siguiente suena; un toque largo no abre la lupa ni el
      menú. VoiceOver: anuncia «BURNOUT, seleccionado» y el aviso.
- [ ] **P1** · Todos los que tienen knobs · Arrastre, doble tap y long-press sin
      que iOS abra la lupa ni el menú contextual (`-webkit-touch-callout:none`).
- [ ] **P1** · CB · Sliders de los sheets (F3), con el pulgar, sobre todo en
      FX: scrollear con swipes rápidos y lentos que arrancan encima de un
      slider (en el medio y en el carril) no cambia ningún valor; tocar la pista
      no salta el valor; arrastrar de costado desde la perilla o la pista lo
      mueve desde donde estaba; los sliders angostos de la matriz de envíos se
      pueden ajustar; doble toque en un PAN de la mezcla lo centra; un swipe en
      diagonal o scrollea o ajusta, nunca las dos cosas. En iOS, que
      `touch-action:pan-y` en el contenedor deje pasar el vertical y frene el
      horizontal, y que el foco quede en el slider después del toque.
- [ ] **P1** · Todos · Carril de scroll lateral de los sheets (`zd-mobile` v5):
      con el pulgar, scrollear por el borde derecho en todas las pestañas, también
      en *peek*, nunca cambia un parámetro; el indicador se ve, no tapa nada y la
      barra nativa no aparece encima; en Android con navegación por gestos, el
      swipe por el borde no dispara "atrás". El ancho útil es 23 px menor: que no
      se corte ningún texto a 360 px (AC EXPORT, MM OSC con los 6 botones de
      onda en una fila de 44 px de ancho, con menos aire entre ellos). MM en el
      teléfono acostado: los sheets FILTRO y VOZ, a media pantalla, van en una
      columna y no tienen scroll horizontal.
- [ ] **P1** · AC · NB · MM · J4 · Sliders de los sheets (bloque `zd-sheet-input`,
      el manejo de CronBeat): con el pulgar, swipes verticales rápidos y lentos
      que arrancan encima de un slider (en la pista y en la perilla) scrollean
      sin cambiar ningún valor; tocar la pista no salta; arrastrar de costado lo
      mueve desde donde estaba (en las filas de knob el slider mide 60–100 px y
      el recorrido es de 160 px: la perilla va más lenta que el dedo). En AC,
      Swing y Densidad (ahora de 44 px de alto). En iOS, lo mismo que para CB.
- [ ] **P1** · AC · NB · MM · J4 · Knobs de los sheets (F3, decisión A), con el
      pulgar en **cada sheet que tiene knobs** (AC: SEQ —incluye TEMPO—, SONIDO
      y FILTRO; NB: ARP, SONIDO y ESPACIO; MM: OSC, FILTRO, MOD y VOZ; J4:
      SIRENA, ENV·LFO y FX): un swipe vertical que arranca encima de un knob
      scrollea el sheet y no cambia el valor; el knob se ajusta arrastrando de
      costado (sin demora, desde donde estaba); un swipe en diagonal o scrollea
      o ajusta, nunca las dos cosas; doble toque = valor por defecto y
      long-press = entrada numérica siguen andando (sin lupa ni menú de iOS).
      En iOS, que `touch-action:pan-y` en el knob deje pasar el scroll y que
      sacar el `preventDefault()` del `pointerdown` no traiga selección de
      texto. Fuera de los sheets (macros de MM, BPM de NB) sigue el arrastre
      vertical.
- [ ] **P1** · CB · Editor de sample: arrastrar inicio/fin en el canvas dentro
      del sheet sin que el sheet se cierre ni scrollee. BPM editable de la barra
      superior: teclado numérico y layout con el teclado abierto.
- [ ] **P1** · NB · MM · J4 · Sheets en *peek*: tocar con el sheet abierto; swipe
      hacia abajo para cerrar; el scroll del sheet no roba gestos de los
      sliders.
- [ ] **P2** · Todos · Rendimiento: CB con los 16 pads con sample y la canción
      larga; NB y J4, visualizador en modo completo frente a liviano / baja
      carga (batería y temperatura con 10 minutos sonando).

### Persistencia

- [ ] **P1** · Todos · Autoguardado: tocar → recargar → mismo estado.
      `storage.persist()`. Safari puede vaciar el storage de sitios no
      instalados tras ~7 días sin uso: confirmar que la nota del menú se lee y
      que, instalada, persiste. CB: sesión con varios samples grandes.
- [ ] **P1** · MM · Migración: un iPhone que ya tenía patches de la versión
      anterior (`hackwave-minimoog`) los ve en la biblioteca al abrir la nueva
      (una vez). J4: lo mismo con los slots `dubsiren.preset.*`.
- [ ] **P2** · J4 · Nivel con FEEDBACK ∞ en auriculares (`reports/j4.md`,
      riesgos).
- [ ] **P1** · J4 · En reposo (F2b): patch de fábrica (sin sesión guardada, o
      "Empezar de cero"), encender y dejarlo **1 minuto sin tocar nada**, con
      auriculares y el volumen alto: tiene que quedar en silencio (antes subía
      solo a un zumbido fuerte en ~10 s). Después, SIREN y soltar: el final de
      la nota no hace clic (con DRIVE al máximo y el volumen al 100 %, escuchar
      el último segundo del release con auriculares). Lo mismo **después de
      recargar** con la sesión guardada (F2b: el VCA arranca en 0 aunque el patch
      restaurado tenga el lazo > 1). Y **una nota durante el release**: SIREN,
      soltar y volver a tocar enseguida, varias veces; suena entera y no se
      corta al segundo.
- [ ] **P1** · J4 · El eco se apaga solo (F2c): SIREN y soltar con el patch
      de fábrica y en cada uno de los 6 presets; la cola se apaga sola, sin
      crecer en el medio (antes 5 de 7 no se apagaban nunca). FEEDBACK de 0 a
      100 % con la sirena latcheada: hasta ~25 % igual que antes, de ahí la cola
      se alarga de a poco, sin saltos ni tramo muerto. Con FEEDBACK ∞
      mantenido sigue autooscilando fuerte, y al soltarlo se apaga. Anotar si
      alguna cola de preset quedó corta (`reports/F2c.md`, sección 4). Con TIME
      y FEEDBACK al máximo (TIME 1,2 s) la cola dura más pero se apaga antes de
      ~25 s. Abrir un patch o una sesión guardados antes de esta versión: suenan
      igual que antes si su FEEDBACK era bajo, y con cola finita si se
      autosostenía.
- [ ] **P1** · J4 · Acid Scream **20 veces seguidas** (SIREN con pausas
      distintas), y después Police Alarm: J4 tiene que sonar siempre (antes,
      a 44,1 kHz, quedaba mudo hasta recargar en la mayoría de las tomas;
      `reports/F2d.md`). Con auriculares, anotar si en el ataque de alguna toma
      se oye un clic o un hueco de ~3 ms (la guarda; medido como un pozo de
      ~1,5 dB). Anotar el equipo y, si se puede, su frecuencia de muestreo (a
      48 kHz Acid Scream no llega a la zona). Repetir también en Safari
      (iOS) y en Firefox (lo pide `reports/F2d.md`: la guarda es JavaScript puro,
      pero no se probó en WebKit ni en Firefox).
- [ ] **P1** · J4 · Pad XY a la esquina de arriba a la derecha (X = CUTOFF,
      Y = RESO) con cualquier patch, sin tocar notas, y después SIREN: tiene que
      sonar (antes quedaba mudo). Arriba de ~8,4 kHz con RESO alta el sonido
      puede volverse áspero: es el filtro reiniciándose, no un cuelgue.
- [ ] **P1** · MM · **10 minutos con la resonancia alta** (F2d): tocar normal,
      moviendo macros, pad y ruedas, con y sin Mod → Filtro. Si algo «colapsa»
      o «se reinicia», anotar **cuál** de estas pasó: (1) un zumbido saturado
      que vuelve solo (el colapso con Mod → Filtro, sin arreglar: ¿rango del
      Osc3? ¿rueda Mod?); (2) mudo y no vuelve con ninguna nota ni preset (no
      debería pasar más); (3) una perilla o macro vuelve a fábrica (¿doble
      toque?); (4) «TOCÁ PARA ENCENDER» + «Sesión restaurada» (la página se
      recargó: ¿habías salido de la app o bloqueado el teléfono?); (5) «Tocá
      para reanudar» (el sistema suspendió el audio).
      `reports/F2d-monomoon.md`, sección 8. Además, el **doble toque sin
      querer**: tocar las macros con el pulgar como se toca de verdad y anotar
      si alguna vuelve a fábrica sin intención (doble toque = valor de fábrica).
- [ ] **P1** · MM · **Mod → Filtro con el Osc3 a frecuencia de audio durante
      5 minutos** (F2e: Osc3 → teclado, rango 8' a 2', rueda Mod arriba, RESO
      de 30 a 100 %): no tiene que quedar mudo nunca. Con la realimentación
      saturada (F2e, para evaluar) **el zumbido saturado va a seguir** (medido:
      62 tramos de ≥ 100 ms en 60 s); se va con la variante (d) de
      `reports/F2e.md`, sección 1.3, todavía no aprobada. Anotar si con lo de
      ahora es tolerable o si se aprueba (d).
- [ ] **P1** · MM · **Los presets antes y después de F2e** (revertir el commit de
      MonoMoon para escuchar el antes): una nota grave, media y aguda en cada
      uno. Con RESO baja la diferencia medida es ≤ 0,27 dB; mirar sobre todo
      «Resonante zumbón» en notas agudas (+0,66 dB) y «Órgano hueco» (+0,27 dB).
- [ ] **P2** · AC · Con la salida a menos de 32 kHz (por ejemplo, un auricular
      Bluetooth en modo llamada): CUTOFF y ENV MOD altos con el secuenciador
      sonando. Ya no tiene que quedar mudo (F2e acota el corte del SVF). Anotar
      el equipo y la frecuencia de muestreo de un WAV grabado con REC.
- [ ] **P2** · J4 · El final de las notas con auriculares (SIREN y soltar,
      varias veces): ningún clic. F2e cambió cómo se ancla la rodilla del
      release, a −100 dBFS o menos: no debería oírse nada distinto.

---

## 2 · iPhone · PWA instalada

- [ ] **P0-2** · Todos · "Compartir → Agregar a inicio": hint del banner con el
      ícono de Compartir real, ícono apple-touch correcto, nombre corto
      (CronBeat, MonoMoon, Nebularp, J4-Sirens, Acid), abre en *standalone* sin
      la barra de Safari. **Modo avión real:** abrir y tocar.
- [ ] **P2** · Todos · iOS 16.4 o más nuevo: «Compartir → Agregar a inicio» también
      desde Chrome, Edge y Firefox (lo dice MDN y la tabla del sitio lo repite;
      sin probar). Instalar desde «▶ Probar» (ventana principal), no desde el
      iframe de «Probalo acá».
- [ ] **P1** · Todos · Ícono apple-touch (íconos nuevos): en «Compartir →
      Agregar a inicio», la vista previa del diálogo y la pantalla de inicio
      muestran el ícono de cada instrumento (ventana de terminal con el número y
      el nombre abajo, sobre el color de acento) sin recortes ni bordes negros; iOS
      le pone sus esquinas redondeadas. Los 5 se distinguen entre sí a simple vista.
      Aparte, el del **sitio** (`assets/favicon-180.png`, «0xD»): al agregar el
      índice a inicio, ese PNG tiene las esquinas transparentes y iOS pinta de
      negro lo transparente de un `apple-touch-icon`: ver si se nota. Una app ya
      agregada guarda el ícono de cuando se agregó; se espera que haga falta
      quitarla y volver a agregarla para ver el nuevo (sin probar).
- [ ] **P1** · Todos · En *standalone* real (no emulado) no aparecen el banner,
      el "↓" ni el ítem de menú "Instalar app".
- [ ] **P0-1** · Todos · Repetir el primer toque con el switch de silencio **en
      la app instalada** (el comportamiento de audio puede diferir del de la
      pestaña).
- [ ] **P0-4** · Todos · Web Share de WAV, MIDI y JSON desde la app instalada
      ("Guardar en Archivos").
- [ ] **P1** · Todos · Bloqueo, llamada, Siri, segundo plano y wake lock en
      *standalone* (ver apartado 1).
- [ ] **P1** · Todos · Actualización: subir `VERSION` en `sw.js` y reabrir con
      conexión → toast "Nueva versión · Recargar" (no debe aparecer en una
      instalación limpia).
- [ ] **P1** · Todos · Autoguardado en la app instalada tras días sin uso.

---

## 3 · iPad y tablet girando

- [ ] **P0-3** · Todos · **Rotación sonando** en iPad Pro 12,9" (cruza los 1024
      px) y en una tablet Android: vertical ↔ horizontal varias veces con el
      instrumento sonando (CB, NB, J4, AC: transporte/arpegio/sirena/secuencia;
      MM: nota sostenida). Sin cortes, el shell se rearma, el stage no queda
      vacío, no se pierde la sesión. En Chromium da 8 rotaciones 1180×820 ↔
      820×1180 sin corte (`*-verify`); falta el dispositivo.
- [ ] **P1** · Todos · Vertical 768×1024: NB piano en una fila (~54 px por tecla),
      MM una fila de 14 blancas, J4 pad de ~754×688 con el deck debajo; sheets
      en dos columnas.
- [ ] **P1** · Todos · Teclado físico: mapeos de cada instrumento (NB A–;, Z/X,
      Espacio; MM A–Ñ / W–P; J4 filas Z y Q, Espacio = SIREN, 1/4/8 = throws,
      9 = MUTE mientras se mantiene, 0 = BURNOUT);
      que no toque notas mientras se escribe en un modal (nombre de patch/banco;
      E1 lo arregló en AC y CB, medido en Chromium).
- [ ] **P2** · Todos · Ventana/tablet que cruza 820 px de ancho: el shell se
      vuelve a armar bien.

---

## 4 · Android · Chrome

- [ ] **P0-2** · Todos · `beforeinstallprompt` real: banner dentro del stage,
      diálogo nativo con ícono y nombre correctos; aceptar → toast "App
      instalada" y no vuelve; el "↓" y el ítem de menú se esconden. **Abrir
      instalada en modo avión real.**
- [x] **P0-2** · Todos · **Instalar los 5 en el mismo teléfono** (scope propio de
      cada manifest, `docs/pwa.md`): los 5 se instalan, uno por uno. *Verificado
      por el usuario el 2026-10-05 en su Android, después del cambio de scope;
      modelo y versión de Chrome sin anotar.* Solo cubre que se instalan.
- [ ] **P0-2** · Todos · Con los 5 instalados en el mismo teléfono: **cada uno
      abre en su propia ventana** (no dentro de la de otro), un link de un
      instrumento a otro no se abre dentro de la ventana de la app (sale al
      navegador), y **«Abrir en pantalla completa»** (Probalo acá) y **«▶ Probar»**
      (índice y landing) abren el instrumento correcto, también con la app de
      otro ya instalada. Si una instalación hecha antes del cambio de scope sigue
      con el scope viejo, anotar si Chrome la actualiza sola o hay que
      reinstalar.
- [ ] **P1** · Todos · Pantalla de inicio con ícono adaptativo (íconos nuevos):
      instalar cada instrumento y mirar su ícono con las tres formas que ofrezca el
      launcher: **círculo**, **cuadrado redondeado** y **«gota»**. En las tres, que se vean la ventana de terminal, el número y el
      nombre sin recortes (el contenido del maskable llega a 197 px del centro y la
      zona segura mide 204,8 de 512) y que el color de acento llene la forma. Mirar
      también la pantalla de carga al abrir (el fondo es `#070b06`).
- [ ] **P1** · Todos · Un instrumento **ya instalado** de antes de los íconos
      nuevos: anotar si Chrome le cambia el ícono solo y cuánto tarda. Una app ya
      instalada puede tardar en actualizar el ícono; en Android a veces hay que
      desinstalarla y reinstalarla.
- [ ] **P2** · Todos · Chrome ⋮ → «Instalar app» (WebAPK, con su entrada en el
      cajón de apps) y, si se puede, Firefox, Edge u Opera: según MDN solo agregan
      un acceso directo que abre el sitio en el navegador (la tabla del sitio lo
      dice; sin probar).
- [ ] **P1** · Todos · "Ahora no" en uso normal: el banner no vuelve durante 14
      días. Cerrar el diálogo nativo sin instalar (`zd-pwa` v3): el banner se va
      en el acto y no vuelve, como con "Ahora no" (las listas de MM y CB, de
      antes de la v3, decían que el banner quedaba visible: ya no).
- [ ] **P1** · Todos · Primer toque, segundo plano, llamada y bloqueo: overlay
      "Tocá para reanudar" y reanudar.
- [ ] **P1** · J4 · MUTE y BURNOUT (apartado 1, "Toque y layout"), en Android:
      **MUTE: ver que no quede colgado al cambiar de app** (gesto de inicio,
      selector de apps, bloqueo de pantalla, llamada, botón o gesto «atrás») con
      el botón apretado; al volver no queda muteado. BURNOUT: un toque silencia
      todo, el aviso sobre el pad se lee y otro toque vuelve.
- [ ] **P1** · CB · Sliders de los sheets en Android (apartado 1, F3): swipes
      verticales (rápidos y lentos, y en diagonal) que arrancan encima de un slider
      de FX (en la pista, en la perilla y en el carril) scrollean el sheet **sin
      cambiar ningún valor**; tocar la pista no salta; arrastrar de costado lo
      mueve desde donde estaba; doble toque en el PAN de la mezcla lo centra.
- [ ] **P1** · AC · NB · MM · J4 · Sliders y knobs de los sheets en Android
      (apartado 1, F3): swipes verticales que arrancan encima de un slider o de
      un knob scrollean sin cambiar nada; de costado ajustan desde donde estaba;
      tocar no cambia nada.
- [ ] **P1** · J4 · MM · AC · Las pruebas de F2b a F2e del apartado 1
      ("Persistencia") también en Android: J4 en reposo y el eco que se apaga
      solo, Acid Scream 20 veces y el pad XY en la esquina; MM 10 minutos con la
      resonancia alta y con Mod → Filtro; Acid con la salida a menos de 32 kHz.
- [ ] **P1** · Todos · Multitáctil real; gesto de "atrás" del sistema con un
      sheet abierto (no está manejado: sale de la página).
- [ ] **P1** · Todos · Web Share / descarga de WAV, MIDI y JSON (Android usa
      descarga directa o la hoja de Compartir según `navigator.canShare`).
- [ ] **P1** · MM · Web MIDI con un controlador USB, desde el botón «Conectar
      MIDI» de la barra (PATCHES en el teléfono): el pedido de permiso aparece
      recién al tocarlo, no al abrir; notas, bend, CC1; la toma de REC los
      registra con la velocity. Negar el permiso deja «MIDI bloqueado» y el
      botón para reintentar.
- [ ] **P2** · MM · NB · J4 · REC de varios minutos: memoria y tamaño del WAV
      (~10 MB/min; tope de 10 min ≈ 115 MB).
- [ ] **P2** · Lighthouse móvil sobre el sitio publicado: Accesibilidad ≥90,
      Best Practices ≥90, instalable.

---

## 5 · Escritorio · Safari y Firefox (y Chrome/Edge para instalar)

- [ ] **P1** · Todos · Safari y Firefox: audio, REC (en Firefox el AudioWorklet
      debería estar), exportaciones, sesión/autoguardado, modo liviano (NB, J4)
      y migración (MM).
- [ ] **P1** · Todos · Atajos de teclado (E1 los arregló en CB y AC con el
      criterio de MM): en Safari y Firefox, Espacio sobre un botón activa ese
      botón y no da play; Espacio sobre un knob abre su valor y no da play; ←→
      sobre un botón no cambian el tempo de CB; tipear en un prompt no toca
      notas; con el foco en la página, las letras tocan y Espacio da play. (NB y
      J4: con foco puesto con el mouse, Espacio sigue siendo play/SIREN a
      propósito.)
- [ ] **P1** · Todos · Favicon de 32 px (E1; íconos nuevos): la pestaña muestra el
      ícono del instrumento (la ventana de terminal con el número, sin el nombre,
      sobre su color de acento) en Chrome, Safari y Firefox, y en `file://`; sin
      pedido a `/favicon.ico`. Mirarlo a 16 px reales y en una pantalla de alta
      densidad, con los 5 instrumentos abiertos en pestañas contiguas: tienen que
      distinguirse por el color y el número. Y el del sitio («0xD» en el índice,
      las landings, privacidad y la 404).
- [ ] **P2** · MM · VoiceOver (macOS/iOS) y TalkBack: el pad XY se anuncia como
      grupo con su nombre, al enfocarlo se lee el valor ("Corte … Hz, énfasis
      N") y cada flecha anuncia el valor nuevo (E1).
- [ ] **P2** · Todos · Chrome/Edge reales: botón "↓ Instalar" del header
      dispara el flujo nativo y desaparece al instalar desde la barra de
      direcciones (`appinstalled`). En Safari/Firefox de escritorio no debe
      aparecer ningún botón ni banner.
- [ ] **P1** · Todos · Instalar desde el sitio con «▶ Probar» (ventana principal, no
      el iframe): Chrome y Edge, ícono de la barra de direcciones y botón
      «↓ Instalar»; **Brave** (MDN no lo nombra; la tabla lo da por Chromium).
      Cada instrumento se instala por separado, con su ícono, y abre en su
      ventana. **Safari 17+ en macOS:** Archivo → Agregar al Dock abre el
      instrumento en su ventana (sin `beforeinstallprompt`: no hay botón).
- [ ] **P1** · Todos · **Firefox 143+ en Windows**: «Agregar pestaña a la barra de
      tareas» aparece en la barra de direcciones para un instrumento y abre una
      ventana propia. Confirmar cómo se llama el botón en el Firefox en español
      (la tabla pone el texto en inglés entre paréntesis) y que en macOS y Linux
      no aparece (el sitio dice que ahí se use el HTML descargado).
- [ ] **P2** · Todos · «← Sitio» de un instrumento abierto con «▶ Probar» vuelve
      al **índice** (`../index.html`), no a la landing de donde se vino.
- [ ] **P2** · Todos · Doble clic en el HTML descargado (`file://` real): solo el
      aviso "Estás usando el archivo local…", sin errores en consola ni SW.
- [ ] **P2** · Todos · Iframe de "Probalo acá" del sitio: sin SW ni banner.
- [ ] **P2** · Todos · Arrastrar el borde de la ventana cruzando 820 px, a mano,
      en Chrome, Safari y Firefox.

---

## 6 · MIDI y WAV en un DAW / reproductor

- [ ] **P0-4 (cierre)** · Los archivos que salen por Compartir se abren después
      en el DAW/reproductor.
- [ ] **P1** · CB · AC · Abrir el `.mid` del patrón/canción en un DAW (Ableton,
      Reaper o GarageBand): tempo, notas sobre la grilla, ninguna nota colgada.
- [ ] **P1** · MM · NB · J4 · Abrir el `.mid` de una toma: tempo (MM y J4 a 120
      BPM fijos, NB con el tempo de la toma), notas, bend, CC1 (MM), CC74/CC71
      (MM, J4); sin notas colgadas. Se validó con `lib/smf.mjs`, no en un DAW.
- [ ] **P1** · Todos · Abrir el WAV en un reproductor y en un DAW (PCM 16-bit
      estéreo, frecuencia real del contexto).
- [ ] **P2** · MM · Escuchar la propuesta del limitador (`reports/monomoon.md`,
      4.1) contra la cadena actual; y CB, la propuesta de master por defecto o
      limitador (`reports/cronbeat.md`, riesgos). Ninguna está aplicada.

---

## 7 · Navegadores embebidos

- [ ] **P1** · Instagram, Facebook y TikTok en iOS y Android: el aviso "Abrí este
      link en Safari o Chrome" aparece (la detección es por user-agent; algunas
      apps lo cambian entre versiones) y no hay banner de instalar.
- [ ] **P1** · CriOS y FxiOS (Chrome y Firefox en iOS 16.4+): el hint de iOS
      aparece igual (WebKit por debajo) y "Agregar a inicio" desde su
      Compartir funciona.
- [ ] **P2** · Abrir un instrumento desde un link de WhatsApp/Telegram/Mail: ¿se
      abre en el navegador del sistema? Audio, descargas y almacenamiento
      pueden estar limitados en un WebView.
- [ ] **P2** · Todos · Dentro del hub **C2** (`window.HOST`): fuera de este repo;
      el autoguardado queda apagado a propósito. Verificar con el hub real que
      nadie depende de `iframe.contentWindow.ZD_M` y que Acid, que engancha
      `zd-audio` aun con hub, no entra en conflicto (`reports/D1-barrido.md`, d y f).
