# Pedido de cambio a bloques ZD — desde la sesión C de Nebularp

Fecha: 2026-10-03 · rama `c-nebularp`

No toqué ningún bloque: los 8 están pegados byte a byte desde `tools/blocks/`
(`node tools/check-blocks.mjs` sin diferencias). Encontré dos bugs que afectan
a los 5 instrumentos, incluido el piloto. Ninguno me bloqueó: en Nebularp el
primero queda esquivado desde el código del instrumento y el segundo es un
caso borde. Los dos se arreglan en el bloque, y por lo tanto en los 5.

---

## 1 · `zd-midi` v1 — a igual tick, el note-off sale DESPUÉS del note-on

**Qué promete** (docs/zd-blocks.md): `write()` "ordena por tick y, a igual
tick, resuelve `off → cc → bend → on` (nunca un note-off después del note-on
del mismo tick)".

**Qué hace:** el comparador usa `(ORDER[a.type] || 9)`. Como `ORDER.off`
vale `0` (falsy), el off pasa a valer 9 y queda **después** de `on` (3).

**Cómo reproducirlo** (en cualquier instrumento que tenga el bloque, por
ejemplo el piloto):

```js
ZD.midi.write({ ppq:96, bpm:120, events:[
  { t:0,  type:'on',  pitch:60, vel:100 }, { t:48, type:'off', pitch:60 },
  { t:48, type:'on',  pitch:60, vel:100 }, { t:96, type:'off', pitch:60 } ] })
```

Track resultante (después del tempo y el nombre):
`00 90 3c 64 · 30 90 3c 64 · 00 80 3c 00 · 30 80 3c 00`. En el tick 48 sale el
on de la segunda nota y **después** el off de la primera: la segunda nota
queda de largo 0 y, según el DAW, la primera se corta mal o la segunda queda
colgada hasta el off siguiente.

**A quién afecta:**

- Acid Bass (piloto): `buildMIDI()` pone `active.end = tickStart` cuando una
  nota ligada (`~`) termina justo donde arranca la siguiente. Si las dos
  tienen la misma altura (por ejemplo `0 ~ 0`), cae en este caso.
- MonoMoon y J4, cuando usen el recorder de performance (SPEC R4): cualquier
  nota que se repita en la misma altura con el off y el on redondeados al
  mismo tick. El `recorder()` además cierra solo una nota abierta cuando
  entra otra de la misma altura, y ese off cae justo en el tick del on.
- Nebularp: notas repetidas en la misma altura del arpegio (gate > 100 %,
  ratchet). **Lo esquivé en el instrumento**: entre una nota y la siguiente
  de la misma altura se deja un hueco de 1,5 ticks, así nunca comparten tick
  (`endTake()` en Nebularp). Cuando se arregle el bloque, el hueco sigue
  siendo inofensivo.

**Arreglo propuesto** (una línea en `write()`):

```js
var ORDER = { off: 1, cc: 2, bend: 3, on: 4 };   // ninguno falsy
```

o bien conservar `ORDER` y comparar con
`(a.type in ORDER ? ORDER[a.type] : 9)`. Conviene agregar a la doc el caso de
prueba de arriba.

---

## 2 · `zd-mobile` v2 — al volver a entrar al shell, el stage queda vacío

**Qué pasa:** `enter()` llama a `build()`, que corre una sola vez (`if
(built) return;`), y `moveNodes(tr)` vive **adentro** de `build()`. `exit()`
devuelve los nodos con `restoreNodes()`. Si después la media query vuelve a
cumplirse, `enter()` ya no mueve nada: barra, stage, tabs y sheets aparecen
vacíos.

**Cómo reproducirlo** (probado en el piloto y en Nebularp con Playwright):
ventana de escritorio a 1200 px → 700 px (entra el shell, `stage` con 3
hijos) → 1200 px (sale) → 700 px (entra): `ZD.mobile.stage().children.length
=== 0`.

**Cuándo pasa en la vida real:** al redimensionar una ventana de escritorio
de un lado al otro de 820 px y, por la rama `(pointer:coarse) and
(max-width:1024px)`, al rotar una tablet cuyo ancho cruza 1024 px (por
ejemplo un iPad Pro de 12,9": 1024 en vertical y 1366 en horizontal). Lo del
iPad Pro no lo probé en un dispositivo.

**Arreglo propuesto:** guardar la referencia de la columna de transporte y
mover los nodos en cada `enter()`:

```js
var trRef = null;
// en build():   trRef = tr;   (y sacar el moveNodes(tr) del final)
function enter() {
  if (active) return;
  build();
  if (!moves.length) moveNodes(trRef);
  active = true;
  ...
}
```

`restoreNodes()` ya vacía `moves`, así que el ciclo enter/exit queda
simétrico.
