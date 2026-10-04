# QA en dispositivos reales

Lista única de lo que **no se pudo probar** en Chromium/Playwright (SPEC 3.1.8:
no se afirma "funciona en iOS" sin haberlo probado). Consolida las listas "A
verificar en dispositivo" de `reports/cronbeat.md`, `reports/monomoon.md`,
`reports/nebularp.md` y `reports/j4.md`, más `docs/pwa.md` y los hallazgos de
`reports/D1-barrido.md`. Acid Bass-303 no tiene reporte propio: sus puntos
salen de las pruebas compartidas y del barrido (apartado "Primer toque").

**Estado: ningún punto está probado en un dispositivo.** Tampoco se probó en
WebKit ni en Firefox.

**Actualizado por E1 (2026-10-04, `reports/E1.md`).** Cambió lo que hay que
mirar en el primer toque (el golpe ya no se programa con el audio suspendido:
sale al levantar el dedo), en los atajos de teclado de CB y AC, en el MIDI de
MM (ahora con un botón «Conectar MIDI») y en el pad XY de MM (lectores de
pantalla). Se agregaron el favicon de los 5 y el arreglo de Acid que creaba
varios `AudioContext` en el primer gesto. Todo eso está medido en Chromium,
con la regla de gestos de iOS **emulada**: falta el dispositivo. Cuando alguien pruebe, marca la casilla y anota
dispositivo, sistema operativo, navegador y fecha al final de la línea.

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
| P0-2 | Instalar y abrir offline | iPhone PWA, Android Chrome | Se instala con su ícono y nombre; en modo avión real abre y suena |
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
- [ ] **P1** · Todos los que tienen knobs · Arrastre, doble tap y long-press sin
      que iOS abra la lupa ni el menú contextual (`-webkit-touch-callout:none`).
- [ ] **P1** · CB · AC · Sliders dentro de un sheet: un arrastre vertical que
      empieza sobre un slider no hace scroll del sheet (`touch-action:none` en
      todos los `input[type=range]`); NB lo resolvió con `pan-y`. Ver
      `reports/D1-barrido.md`, a.
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

---

## 2 · iPhone · PWA instalada

- [ ] **P0-2** · Todos · "Compartir → Agregar a inicio": hint del banner con el
      ícono de Compartir real, ícono apple-touch correcto, nombre corto
      (CronBeat, MonoMoon, Nebularp, J4-Sirens, Acid), abre en *standalone* sin
      la barra de Safari. **Modo avión real:** abrir y tocar.
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
      Espacio; MM A–Ñ / W–P; J4 filas Z y Q, Espacio = SIREN, 1/4/8 = throws);
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
- [ ] **P1** · Todos · "Ahora no" en uso normal: el banner no vuelve durante 14
      días. Cerrar el diálogo nativo sin instalar (`zd-pwa` v3): el banner se va
      en el acto y no vuelve, como con "Ahora no" (las listas de MM y CB, de
      antes de la v3, decían que el banner quedaba visible: ya no).
- [ ] **P1** · Todos · Primer toque, segundo plano, llamada y bloqueo: overlay
      "Tocá para reanudar" y reanudar.
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
- [ ] **P2** · Todos · Favicon (E1): la pestaña muestra el ícono del instrumento
      (isotipo sobre su color de acento) en Chrome, Safari y Firefox, y en
      `file://`; sin pedido a `/favicon.ico`.
- [ ] **P2** · MM · VoiceOver (macOS/iOS) y TalkBack: el pad XY se anuncia como
      grupo con su nombre, al enfocarlo se lee el valor ("Corte … Hz, énfasis
      N") y cada flecha anuncia el valor nuevo (E1).
- [ ] **P2** · Todos · Chrome/Edge reales: botón "↓ Instalar" del header
      dispara el flujo nativo y desaparece al instalar desde la barra de
      direcciones (`appinstalled`). En Safari/Firefox de escritorio no debe
      aparecer ningún botón ni banner.
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
