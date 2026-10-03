// Markup estático del "gate" de mail (verificación por código). La lógica interactiva
// vive en assets/mail-gate.js, un solo módulo compartido por index y las 5 landings.
// Sin JS, el paso 1 (mail) queda visible y utilizable como formulario; los pasos 2 y 3
// están marcados `hidden` porque dependen de la verificación en el navegador.
import { esc } from './layout.mjs';

export function renderGateForm({ idPrefix, mode, file, downloadName, name, zipHref = 'descargables-zeroday.zip' }) {
  const downloadAction =
    mode === 'all'
      ? `<a class="btn btn--accent btn--block" href="${esc(zipHref)}" download="${esc(zipHref)}" data-gate-download>⭳ DESCARGAR LOS 5 (ZIP)</a>`
      : `<a class="btn btn--accent btn--block" href="${esc(file)}" download="${esc(downloadName)}" data-gate-download>⭳ DESCARGAR — ${esc(name)}</a>`;
  const seeAll = mode === 'all' ? '' : `<a href="index.html#descargar" class="btn-link">Descargar los 5 juntos →</a>`;

  return `<div class="gate-step" data-mail-gate data-mode="${esc(mode)}">
  <div class="steps" data-gate-steps>
    <span class="step step--current" data-step-indicator="email">1 · MAIL</span>
    <span class="step" data-step-indicator="code">2 · CÓDIGO</span>
    <span class="step" data-step-indicator="done">3 · DESCARGA</span>
  </div>

  <form class="gate-form" data-gate-panel="email" novalidate>
    <label class="field-label" for="${idPrefix}-mail">Tu mail</label>
    <input class="text-input" id="${idPrefix}-mail" type="email" autocomplete="email" inputmode="email" placeholder="vos@ejemplo.com" name="email" required>
    <label class="check-row">
      <input type="checkbox" name="news" checked>
      Avisarme cuando salga C2 · Sync Master Envelopment
    </label>
    <a href="privacidad.html" style="font-size:12px;color:var(--zd-dim)">Cómo usamos tu mail →</a>
    <button type="submit" class="btn btn--accent" data-gate-submit-email>ENVIARME EL CÓDIGO</button>
    <p class="gate-error" data-gate-error hidden></p>
    <p class="gate-info" data-gate-info hidden></p>
    <noscript><p class="gate-info">Este paso necesita JavaScript habilitado. Mientras tanto, abrí el instrumento desde "Probalo acá".</p></noscript>
  </form>

  <form class="gate-form" data-gate-panel="code" hidden novalidate>
    <p style="margin:0;font-size:14px;line-height:1.6;color:var(--zd-muted)">Mandamos un código a <strong data-gate-email-echo></strong>. Vence en 10 minutos.</p>
    <label class="field-label" for="${idPrefix}-code">Código de verificación</label>
    <input class="code-input" id="${idPrefix}-code" autocomplete="one-time-code" inputmode="numeric" maxlength="6" placeholder="······" name="code">
    <button type="submit" class="btn btn--accent" data-gate-submit-code>VERIFICAR</button>
    <div class="gate-row">
      <button type="button" class="btn-link" data-gate-change-email>← Cambiar mail</button>
      <button type="button" class="btn-link btn-link--accent" data-gate-resend>Reenviar código</button>
    </div>
    <div class="demo-note" data-gate-demo hidden>
      <strong>MODO DEMO · SIN SERVIDOR DE MAIL</strong>
      <span>El mail que llegaría dice: <strong data-gate-demo-code></strong></span>
    </div>
    <p class="gate-error" data-gate-error hidden></p>
    <p class="gate-info" data-gate-info hidden></p>
  </form>

  <div class="gate-step" data-gate-panel="done" hidden>
    <p style="margin:0;font-size:14px;color:var(--zd-muted)">Verificado: <strong data-gate-email-echo></strong></p>
    ${downloadAction}
    ${seeAll}
    <button type="button" class="btn-link" data-gate-reset>Usar otro mail</button>
  </div>
</div>`;
}
