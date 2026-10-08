// Piezas compartidas de layout (head/header/footer) para todas las páginas del sitio.
// Generador: tools/build-site.mjs. No se usa en los instrumentos (descargables/).

export function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderHead({ site, title, description, path, ogImage, ogType = 'website', jsonLd, robots, base = '', extraHead = '' }) {
  const canonical = site.baseUrl + path;
  const image = site.baseUrl + (ogImage || 'assets/og/home.png');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${base ? `<base href="${esc(base)}">` : ''}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="64x64" href="assets/favicon.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/favicon-180.png">
<link rel="stylesheet" href="assets/site.css">
<meta name="theme-color" content="${esc(site.themeColor)}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="es_AR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
${extraHead}`;
}

export function gaSnippet(ga) {
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ga}');
</script>`;
}

export function renderHeader({ site, ctaHref = '#descargar', ctaLabel = 'DESCARGAR GRATIS', nav = [], showBack = false }) {
  const navLinks = nav.map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join('\n      ');
  return `<header class="site-header">
  <div class="wrap site-header__bar">
    <a href="index.html" class="site-logo">
      <img src="assets/logo-badge.webp" alt="Zero Day · Music Exploits" width="404" height="314">
      <span class="site-logo__word">ZERO DAY<em> · </em>MUSIC EXPLOITS</span>
    </a>
    <nav class="site-nav" aria-label="Principal">
      ${navLinks}
      <a href="${esc(ctaHref)}" class="btn btn--accent btn--sm">${esc(ctaLabel)}</a>
    </nav>
    <details class="site-menu">
      <summary aria-label="Abrir menú">☰</summary>
      <nav class="site-menu__panel" aria-label="Menú">
        ${navLinks}
        ${showBack ? '<a href="index.html" rel="noopener">← Sitio</a>' : ''}
        <a href="${esc(ctaHref)}" class="btn btn--accent btn--sm">${esc(ctaLabel)}</a>
      </nav>
    </details>
  </div>
</header>`;
}

export function renderFooter({ extraLink = '' } = {}) {
  return `<footer class="site-footer">
  <div class="wrap">
    <img src="assets/logo-badge.webp" alt="" width="404" height="314">
    <span>ZERO DAY · MUSIC EXPLOITS - Argentina 2026</span>
    ${extraLink}
    <a href="privacidad.html" class="push">PRIVACIDAD</a>
  </div>
</footer>`;
}

export function renderDoc({ lang = 'es', head, body, bodyClass = '' }) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${head}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
${body}
</body>
</html>
`;
}
