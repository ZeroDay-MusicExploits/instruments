import { esc, renderHead, gaSnippet, renderHeader, renderFooter, renderDoc } from './layout.mjs';
import { renderGateForm } from './gate.mjs';
import { renderPreviewTabs } from './preview.mjs';

const NAV = [
  { href: '#instrumentos', label: 'INSTRUMENTOS' },
  { href: '#probar', label: 'PROBAR' },
  { href: '#compatibilidad', label: 'COMPATIBILIDAD' },
  { href: '#faq', label: 'FAQ' }
];

const COMPAT_ROWS = [
  ['Chrome / Edge', 'Windows, macOS, Linux', 'yes', 'yes'],
  ['Firefox', 'Windows, macOS, Linux', 'yes', 'yes'],
  ['Safari', 'macOS', 'yes', 'no'],
  ['Chrome', 'Android', 'yes', 'yes'],
  ['Safari', 'iOS / iPadOS', 'yes', 'no'],
  ['Cualquier navegador en iOS (Chrome, Firefox…)', 'iOS / iPadOS', 'yes', 'no']
];

const FAQ_ITEMS = [
  {
    q: '¿Por qué no suena en iPhone?',
    a: 'Todos los navegadores en iOS (Safari y también Chrome/Firefox, que ahí corren sobre el mismo motor) necesitan un toque para desbloquear el audio — es una política del navegador, no un bug. Con el switch de silencio físico activado, el comportamiento puede variar según el instrumento: no lo afirmamos como resuelto en los 5 sin probarlo en el dispositivo real.'
  },
  {
    q: '¿Se guardan mis datos?',
    a: 'Lo que tocás queda en tu propio navegador (localStorage / IndexedDB), nunca en un servidor. Hoy el autoguardado automático (tocar → recargar → mismo estado) funciona en CronBeat-8:08; en los otros 4, el respaldo es manual vía exportar/importar JSON — cada landing dice exactamente qué guarda.'
  },
  {
    q: '¿Puedo instalar el HTML descargado?',
    a: 'No directamente: un HTML abierto en file:// no puede registrar service worker ni manifest (los navegadores exigen https o localhost para eso). Instalá desde la web (PWA) o bajá el HTML para usarlo local — un HTML descargado no se instala como app.'
  },
  {
    q: '¿Qué datos recopila el sitio?',
    a: 'El formulario de descarga pide tu mail para un código de verificación (hoy se muestra en pantalla, modo demo) y manda el dominio de ese mail a dns.google para chequear que reciba correo. Las páginas del sitio (no los instrumentos) usan Google Analytics. Nada de esto sale de index.html/landing-*.html hacia los instrumentos. Detalle completo en privacidad.html.'
  }
];

function instrumentCard(slug, I) {
  const chips = [...I.exporta, ...(slug === 'cronbeat' || slug === 'acid' ? ['8 PATRONES'] : [])];
  return `<a class="card" href="${esc(I.page)}" style="--accent:${I.color}">
      <div class="card__top"><span>${esc(I.num)}</span><span>${esc(I.type)}</span></div>
      <h3>${esc(I.name)}</h3>
      <p class="card__tag">${esc(I.tagline)}</p>
      <p class="card__desc">${esc(I.what.split('. ')[0])}.</p>
      <div class="card__chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <span class="card__go">MANUAL Y DESCARGA →</span>
    </a>`;
}

export function buildIndexPage(data) {
  const { site, order, instruments } = data;
  const title = 'ZERO DAY · MUSIC EXPLOITS — Instrumentos web gratis';
  const description = site.description;

  const head = renderHead({
    site,
    title,
    description,
    path: '',
    ogImage: 'assets/og/home.png',
    extraHead: gaSnippet(site.ga)
  });

  const cards = order.map((slug) => instrumentCard(slug, instruments[slug])).join('\n    ');

  const body = `${renderHeader({ site, nav: NAV })}
<main class="page" id="top">
  <section class="wrap hero">
    <div class="hero__copy">
      <span class="eyebrow"><span style="width:8px;height:8px;background:var(--zd-green);border-radius:50%;box-shadow:0 0 10px var(--zd-green)"></span>Laboratorio de instrumentos web · 100% client-side · sin backend</span>
      <h1 class="h1">Cinco instrumentos que suenan en tu navegador.</h1>
      <p class="lede" style="max-width:560px">Sin servidor, sin cuentas, sin conexión requerida una vez cargados. Cada uno es un archivo HTML autocontenido para tocar con teclado de PC, mouse, dedo o MIDI.</p>
      <div class="hero__ctas">
        <a href="#descargar" class="btn btn--accent">DESCARGAR LOS 5 · GRATIS</a>
        <a href="#probar" class="btn btn--outline">▶ Probar ahora</a>
      </div>
    </div>
    <div class="hero__art">
      <div class="hero__art-card">
        <img src="assets/logo-badge.webp" alt="" width="404" height="314">
        <span class="hero__badge">ARGENTINA 2026</span>
      </div>
    </div>
  </section>

  <section class="wrap block" id="instrumentos">
    <div class="section-head">
      <h2 class="h2">La suite</h2>
      <span class="label">5 INSTRUMENTOS · EXPORT WAV/MIDI/JSON · WEB</span>
    </div>
    <div class="cards-grid">
    ${cards}
      <article class="card card--soon">
        <div class="card__top"><span>C2</span><span>EN DESARROLLO</span></div>
        <h3>Sync Master Envelopment</h3>
        <p>La plataforma central que integra los 5 instrumentos como pestañas de una misma sesión, con tempo sincronizado y encendido/apagado conjunto, para sincronizar, mezclar y masterizar.</p>
      </article>
    </div>
  </section>

  <section class="wrap block" id="probar">
    <div class="section-head">
      <h2 class="h2">Probalo acá</h2>
      <span class="label">EL PRIMER TOQUE ENCIENDE EL AUDIO</span>
    </div>
    ${renderPreviewTabs({ order, instruments })}
  </section>

  <section class="wrap block" id="como">
    <div class="section-head" style="margin-bottom:28px"><h2 class="h2">Cómo se usa</h2></div>
    <ol class="how-grid">
      <li><span class="step-label">01 · ABRIR</span><p>Abrí el archivo .html directamente en el navegador (doble clic, o arrastrarlo a una pestaña). No requiere instalación ni servidor.</p></li>
      <li><span class="step-label">02 · ENCENDER</span><p>La primera interacción (clic, tap o tecla) desbloquea el audio del navegador. Es un requisito de los navegadores modernos, no un bug.</p></li>
      <li><span class="step-label">03 · INSTALAR</span><p>Instalá desde la web (PWA) o bajá el HTML para usarlo local. Un HTML descargado no se instala como app.</p></li>
      <li><span class="step-label">04 · GUARDAR Y EXPORTAR</span><p>El trabajo se autoguarda en el navegador y se exporta/importa a JSON. Cada instrumento muestra en su manual qué formatos exporta hoy.</p></li>
    </ol>
  </section>

  <section class="wrap block" id="compatibilidad">
    <div class="section-head" style="margin-bottom:28px">
      <h2 class="h2">Compatibilidad</h2>
      <span class="label">VERIFICADO EN MDN / CANIUSE · OCT 2026</span>
    </div>
    <div class="table-wrap">
      <table class="compat">
        <thead>
          <tr><th>Navegador</th><th>Sistema</th><th>Audio (tocar)</th><th>Web MIDI</th></tr>
        </thead>
        <tbody>
        ${COMPAT_ROWS.map(
          ([browser, os, audio, midi]) =>
            `<tr><td>${esc(browser)}</td><td>${esc(os)}</td><td class="${audio}">${audio === 'yes' ? 'Sí' : 'No'}</td><td class="${midi}">${midi === 'yes' ? 'Sí' : 'No'}</td></tr>`
        ).join('\n          ')}
        </tbody>
      </table>
    </div>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:var(--zd-dim)">Web MIDI no existe en Safari ni en ningún navegador de iOS (todos corren sobre WebKit ahí): MonoMoon'70 detecta que <code>navigator.requestMIDIAccess</code> no está y lo indica en pantalla en vez de fallar en silencio. El resto del audio (Web Audio API) funciona en los seis.</p>
  </section>

  <section class="wrap block" id="faq">
    <div class="section-head" style="margin-bottom:28px"><h2 class="h2">Preguntas frecuentes</h2></div>
    <div class="faq">
    ${FAQ_ITEMS.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n    ')}
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:var(--zd-dim)">¿Encontraste un bug o te falta algo? <a href="https://github.com/ZeroDay-MusicExploits/instruments/issues">Abrí un issue en el repo</a>. <!-- TODO: sumar un contacto directo (mail/formulario) cuando el titular defina uno --></p>
  </section>

  <section class="wrap block" id="descargar">
    <div class="dl-box">
      <div style="display:flex;flex-direction:column;gap:16px">
        <span class="eyebrow">DESCARGA GRATUITA</span>
        <h2 class="h2" style="font-size:clamp(28px,4vw,46px)">Los 5 instrumentos, gratis.</h2>
        <p class="lede">Ingresá tu mail, te mandamos un código de 6 dígitos y con eso se habilitan las descargas. Sin cuentas ni contraseñas.</p>
        <div class="dl-box__points">
          <span>5 archivos HTML autocontenidos (ZIP)</span>
          <span>Funcionan sin conexión</span>
          <span>Uso libre para tocar, grabar y exportar</span>
        </div>
      </div>
      ${renderGateForm({ idPrefix: 'zd-all', mode: 'all' })}
    </div>
  </section>
</main>
${renderFooter()}
<script defer src="assets/site.js"></script>
<script defer src="assets/mail-gate.js"></script>`;

  return renderDoc({ head, body });
}
