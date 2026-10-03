// "Probalo acá": en móvil linkea a pantalla completa, en >=1024px carga un iframe
// recién al hacer click (assets/site.js). Sin JS, el link de pantalla completa
// siempre funciona (noscript) y el botón de carga del iframe queda como link también.
import { esc } from './layout.mjs';

export function renderPreviewBlock({ file, name }) {
  return `<div class="preview">
  <div class="preview__mobile">
    <a class="btn btn--accent" href="${esc(file)}" target="_blank" rel="noopener">Abrir en pantalla completa ↗</a>
    <p>Se ejecuta completo en tu navegador. En pantallas grandes (≥1024px) se puede probar acá mismo, en un iframe.</p>
  </div>
  <div class="preview__frame" data-preview-frame data-src="${esc(file)}" data-name="${esc(name)}" hidden>
    <button class="preview__overlay" type="button" data-preview-load>
      <span class="preview__play">▶</span>
      <span style="font-size:14px;letter-spacing:.08em">Cargar ${esc(name)}</span>
      <span class="preview__hint">Clic para interactuar — el primer toque enciende el audio</span>
    </button>
  </div>
  <noscript><p style="padding:16px;margin:0;font-size:12.5px;color:var(--zd-dim)"><a href="${esc(file)}" target="_blank" rel="noopener">Abrir ${esc(name)} en una pestaña nueva →</a></p></noscript>
</div>`;
}

export function renderPreviewTabs({ order, instruments }) {
  const inputs = order
    .map(
      (slug, i) => `<input type="radio" name="previewTab" id="tab-${slug}" class="tab-${slug}"${i === 0 ? ' checked' : ''}>
    <label for="tab-${slug}" style="--tab-accent:${instruments[slug].color}">${esc(instruments[slug].name)}</label>`
    )
    .join('\n    ');
  const panes = order
    .map((slug) => {
      const I = instruments[slug];
      return `<div class="preview-pane" data-pane="${slug}" style="--accent:${I.color};--accent-dark:${I.dark}">
      ${renderPreviewBlock({ file: I.file, name: I.name })}
    </div>`;
    })
    .join('\n    ');
  return `<div class="preview-tabs-wrap" data-preview-tabs aria-label="Elegir instrumento para probar">
    ${inputs}
    ${panes}
  </div>`;
}
