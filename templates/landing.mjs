import { esc, renderHead, gaSnippet, renderHeader, renderFooter, renderDoc } from './layout.mjs';
import { renderGateForm } from './gate.mjs';
import { renderPreviewBlock } from './preview.mjs';

const NAV = [
  { href: '#probar', label: 'PROBAR' },
  { href: '#manual', label: 'MANUAL' },
  { href: '#teclado', label: 'TECLADO' }
];

function splitTerm(str) {
  const i = str.indexOf(' — ');
  return i < 0 ? { term: str, desc: '' } : { term: str.slice(0, i), desc: str.slice(i + 3) };
}

function renderManual(I) {
  const links = I.sections
    .map((s, i) => {
      const n = String(i + 1).padStart(2, '0');
      return `<a href="#m-${i + 1}"><span>${n}</span><span>${esc(s.t)}</span></a>`;
    })
    .join('\n        ');

  const articles = I.sections
    .map((s, i) => {
      const n = String(i + 1).padStart(2, '0');
      const p = s.p ? `<p class="manual-p">${esc(s.p)}</p>` : '';
      const items =
        s.items && s.items.length
          ? `<ul class="manual-items">${s.items
              .map((it) => {
                const { term, desc } = splitTerm(it);
                return `<li><strong>${esc(term)}</strong>${desc ? `<span>${esc(desc)}</span>` : ''}</li>`;
              })
              .join('')}</ul>`
          : '';
      const notes = (s.notes || []).map((nt) => `<p class="manual-note"><span>▸</span><span>${esc(nt)}</span></p>`).join('\n        ');
      return `<article class="manual-article" id="m-${i + 1}">
        <h3><span>${n}</span>${esc(s.t)}</h3>
        ${p}
        ${items}
        ${notes}
      </article>`;
    })
    .join('\n      ');

  return `<section class="wrap block" id="manual">
    <div class="section-head">
      <h2 class="h2">Manual de usuario</h2>
      <span class="label">${I.sections.length} SECCIONES</span>
    </div>
    <div class="manual-layout">
      <details class="manual-index manual-index--mobile">
        <summary>Índice · ${I.sections.length} secciones</summary>
        <nav class="manual-index__list" aria-label="Índice del manual">
        ${links}
        </nav>
      </details>
      <nav class="manual-index manual-index--desktop" aria-label="Índice del manual">
        ${links}
      </nav>
      <div class="manual-body">
      ${articles}
      </div>
    </div>
  </section>`;
}

function renderKeys(I) {
  const KEYTOK = /^(\S{1,3}|Espacio|ESPACIO|Shift|…)$/;
  const cards = I.keys
    .map(([k, a]) => {
      const toks = k.split(' ').filter((t) => t !== '/');
      const chipable = toks.every((t) => KEYTOK.test(t));
      const chips = chipable
        ? `<div class="key-card__chips">${toks.map((t) => `<kbd>${esc(t)}</kbd>`).join('')}</div>`
        : `<div class="key-card__chips"><span style="font-size:13px">${esc(k)}</span></div>`;
      return `<div class="key-card">${chips}<span class="key-card__action">${esc(a)}</span></div>`;
    })
    .join('\n      ');

  const behavior = I.behavior
    ? `<div class="behavior-list">
      <span class="label">COMPORTAMIENTO SEGÚN TRANSPORTE</span>
      ${I.behavior.map((b) => `<p class="manual-note" style="max-width:680px"><span>▸</span><span>${esc(b)}</span></p>`).join('\n      ')}
    </div>`
    : '';

  return `<section class="wrap block" id="teclado">
    <div class="section-head">
      <h2 class="h2">Teclado de PC</h2>
      ${I.keysNote ? `<span class="label">${esc(I.keysNote)}</span>` : ''}
    </div>
    <details class="keys-wrap" data-keys-wrap>
      <summary>Ver mapeo de teclado</summary>
      <div class="keys-grid">
      ${cards}
      </div>
      ${behavior}
    </details>
    <div class="roadmap">
      <span class="label">ESTADO DEL ROADMAP</span>
      <p>${esc(I.roadmap)}</p>
    </div>
  </section>`;
}

function renderOthers(order, instruments, currentSlug) {
  const others = order
    .filter((s) => s !== currentSlug)
    .map((s) => {
      const I = instruments[s];
      return `<a class="other-card" href="${esc(I.page)}" style="--card-accent:${I.color}">
        <span class="label">${esc(I.type)}</span>
        <span class="name">${esc(I.name)}</span>
        <span class="go">Ver →</span>
      </a>`;
    })
    .join('\n    ');
  return `<section class="wrap block" style="padding-top:12px">
    <span class="label" style="display:block;margin-bottom:14px">EL RESTO DE LA SUITE</span>
    <div class="others-grid">
    ${others}
    </div>
  </section>`;
}

export function buildLandingPage(data, slug) {
  const { site, order, instruments } = data;
  const I = instruments[slug];
  const title = `${I.name} — ${site.name}`;
  const description = I.what.length > 155 ? I.what.slice(0, 152).trimEnd() + '…' : I.what;
  const path = I.page;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: I.name,
    description: I.what,
    url: site.baseUrl + I.page,
    applicationCategory: 'MusicApplication',
    operatingSystem: 'Any (navegador web con Web Audio API)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    softwareVersion: 'web',
    isAccessibleForFree: true
  };

  const head = renderHead({
    site,
    title,
    description,
    path,
    ogImage: `assets/og/${slug}.png`,
    jsonLd,
    extraHead: gaSnippet(site.ga)
  });

  const specRows = [
    ['ARCHIVO', I.file],
    ['TIPO', I.type.charAt(0) + I.type.slice(1).toLowerCase()],
    ['SE TOCA CON', I.plays],
    ['EXPORTA', I.exporta.join(' · ')],
    ['GUARDA', I.guarda ? 'Autoguardado en el navegador' : 'Export/import JSON manual (autoguardado pendiente)'],
    ['APP', I.app ? 'PWA instalable · sin conexión' : 'Instalable solo cuando se sirve por web (no en el HTML local)']
  ];

  const body = `${renderHeader({ site, ctaHref: '#descargar', nav: NAV, showBack: true })}
<main class="page" style="--accent:${I.color};--accent-dark:${I.dark}">
  <section class="wrap block" style="padding-top:28px">
    <a href="index.html#instrumentos" class="btn-link" style="padding-left:0;margin-bottom:8px;display:inline-flex">← TODOS LOS INSTRUMENTOS</a>
    <div class="hero" style="padding:16px 0 0">
      <div class="hero__copy">
        <span class="eyebrow">${esc(I.num)} · ${esc(I.type)}</span>
        <h1 class="h1">${esc(I.name)}</h1>
        <p class="lede" style="color:var(--accent);font-size:16px">${esc(I.tagline)}</p>
        <div class="hero__ctas hero__ctas--stack">
          <a href="#descargar" class="btn btn--accent">DESCARGAR GRATIS</a>
          <a href="${esc(I.file)}" class="btn btn--outline">▶ Probar ahora</a>
        </div>
        <p class="lede" style="max-width:580px">${esc(I.what)}</p>
      </div>
      <dl class="spec">
        ${specRows.map(([k, v]) => `<div class="spec__row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n        ')}
      </dl>
    </div>
  </section>

  <section class="wrap block" id="probar">
    <div class="section-head">
      <h2 class="h2">Probalo acá</h2>
      <a href="${esc(I.file)}" target="_blank" rel="noopener" class="label" style="padding:10px 0">ABRIR EN PANTALLA COMPLETA ↗</a>
    </div>
    ${renderPreviewBlock({ file: I.file, name: I.name })}
  </section>

  ${renderManual(I)}
  ${renderKeys(I)}

  <section class="wrap block" id="descargar">
    <div class="dl-box">
      <div style="display:flex;flex-direction:column;gap:16px">
        <span class="eyebrow">DESCARGA GRATUITA</span>
        <h2 class="h2" style="font-size:clamp(26px,4vw,42px)">Llevate ${esc(I.name)}.</h2>
        <p class="lede">Ingresá tu mail, te mandamos un código de 6 dígitos y se habilita la descarga. Si ya verificaste tu mail en otro instrumento, descargás directo.</p>
        <div class="dl-box__points">
          <span>${esc(I.downloadName)}</span>
          <span>Un solo archivo HTML, funciona sin conexión</span>
          <span>Instalá desde la web (PWA) o bajá el HTML para usarlo local. Un HTML descargado no se instala como app.</span>
        </div>
      </div>
      ${renderGateForm({ idPrefix: `zd-${slug}`, mode: 'single', file: I.file, downloadName: I.downloadName, name: I.name })}
    </div>
  </section>

  ${renderOthers(order, instruments, slug)}
</main>
${renderFooter()}
<script defer src="assets/site.js"></script>
<script defer src="assets/mail-gate.js"></script>`;

  return renderDoc({ head, body });
}
