import { renderHead, gaSnippet, renderDoc, esc } from './layout.mjs';

// 404.html puede servirse para cualquier ruta anidada bajo /instruments/ (GitHub Pages lo usa
// como fallback), así que no puede depender de rutas relativas: todo va absoluto vía <base>.
export function build404Page(data) {
  const { site, order, instruments } = data;
  const title = `404 — ${site.name}`;
  const description = 'Esta página no existe o cambió de lugar.';

  const head = renderHead({
    site,
    title,
    description,
    path: '404.html',
    ogImage: 'assets/og/home.png',
    robots: 'noindex',
    base: '/instruments/',
    extraHead: gaSnippet(site.ga)
  });

  const chips = order
    .map((slug) => {
      const I = instruments[slug];
      return `<a href="${esc(I.page)}" class="jump-chip"><span class="jump-dot" style="--dot:${I.color}"></span>${esc(I.name)}</a>`;
    })
    .join('\n        ');

  const body = `<header class="site-header">
  <div class="wrap site-header__bar">
    <a href="index.html" class="site-logo">
      <img src="src/logo-badge.jpg" alt="Zero Day · Music Exploits">
      <span class="site-logo__word">ZERO DAY<em> · </em>MUSIC EXPLOITS</span>
    </a>
  </div>
</header>
<main class="page page--plain" style="justify-content:center">
  <div class="wrap" style="padding:56px 0;display:flex;flex-direction:column;gap:36px">
    <div class="terminal-card">
      <span style="font-size:12px;letter-spacing:.14em;color:var(--zd-faint)">$ GET <span data-404-path>/pagina-perdida</span></span>
      <p class="code-404">404</p>
      <p style="margin:0;font-size:clamp(17px,2.2vw,22px);line-height:1.4">Señal perdida. Esta página no existe o cambió de lugar.</p>
      <span style="font-size:14px;color:var(--zd-muted)">&gt; volviendo al patrón A<span class="blink">_</span></span>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <a href="index.html" class="btn btn--accent">VOLVER AL INICIO</a>
      <a href="index.html#descargar" class="btn btn--outline">Descargar los 5</a>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <span class="label">O SALTÁ DIRECTO A UN INSTRUMENTO</span>
      <div class="jump-list">
        ${chips}
      </div>
    </div>
  </div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>ZERO DAY · MUSIC EXPLOITS - Argentina 2026</span>
    <a href="privacidad.html" class="push">PRIVACIDAD</a>
  </div>
</footer>
<script>
(function(){
  try {
    var p = decodeURIComponent(location.pathname)
      .replace(/^\\/instruments\\//, '')
      .replace(/^\\/+/, '');
    if (!p || p === '404.html') p = 'pagina-perdida';
    var el = document.querySelector('[data-404-path]');
    if (el) el.textContent = '/' + p;
  } catch (e) {}
})();
</script>`;

  return renderDoc({ head, body });
}
