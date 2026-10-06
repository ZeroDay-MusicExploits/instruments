// Instalar como app: la tabla completa del índice (#instalar) y el resumen corto
// que va junto a «Descargar» en cada landing. Todo el texto sale de `install` en
// data/instrumentos.json (verificado contra MDN, caniuse y las notas de Firefox).
import { esc } from './layout.mjs';

export function renderInstallSection(install) {
  const rows = install.rows
    .map((r) => `<tr><th scope="row"><span class="install__os">${esc(r.os)}</span><span class="install__browser">${esc(r.browser)}</span></th><td>${esc(r.how)}</td></tr>`)
    .join('\n          ');
  const notes = install.notes.map((n) => `<p class="install__note">${esc(n)}</p>`).join('\n    ');
  return `<section class="wrap block" id="instalar">
    <div class="section-head" style="margin-bottom:28px">
      <h2 class="h2">${esc(install.title)}</h2>
      <span class="label">${esc(install.verified)}</span>
    </div>
    <p class="install__rule">${esc(install.rule)}</p>
    <div class="table-wrap">
      <table class="install">
        <thead>
          <tr><th scope="col">Sistema y navegador</th><th scope="col">Cómo se instala</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${notes}
  </section>`;
}

export function renderInstallSummary(install) {
  const lines = install.summary.map((s) => `<li><strong>${esc(s.t)}.</strong> ${esc(s.d)}</li>`).join('\n          ');
  return `<div class="install-mini">
        <span class="label">INSTALAR COMO APP</span>
        <ul>
          ${lines}
        </ul>
        <p>${esc(install.rule)}</p>
        <a href="index.html#instalar" class="install-mini__more">Todos los sistemas y navegadores →</a>
      </div>`;
}
