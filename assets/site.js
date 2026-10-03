// ZERO DAY · MUSIC EXPLOITS — mejoras progresivas del sitio (no de los instrumentos).
// Nada de lo que hay acá es necesario para leer el contenido de la página: todo se degrada con gracia sin JS.
(function () {
  'use strict';

  // Teclado de PC: abierto por defecto solo con puntero preciso (mouse). En touch queda colapsado.
  try {
    if (window.matchMedia && matchMedia('(pointer:fine)').matches) {
      document.querySelectorAll('[data-keys-wrap]').forEach(function (d) { d.open = true; });
    }
  } catch (e) {}

  // Preview "Probalo acá": en >=1024px, carga el iframe recién al hacer click (ahorra la descarga del instrumento).
  document.querySelectorAll('[data-preview-frame]').forEach(function (el) {
    var btn = el.querySelector('[data-preview-load]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.src = el.getAttribute('data-src');
      iframe.title = el.getAttribute('data-name') || '';
      iframe.allow = 'autoplay; midi';
      iframe.loading = 'lazy';
      el.innerHTML = '';
      el.appendChild(iframe);
    }, { once: true });
  });

  // Menú móvil: cerrar al elegir un link.
  document.querySelectorAll('.site-menu').forEach(function (menu) {
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { menu.removeAttribute('open'); });
    });
  });
})();
