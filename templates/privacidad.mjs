import { renderHead, gaSnippet, renderHeader, renderFooter, renderDoc } from './layout.mjs';

export function buildPrivacidadPage(data) {
  const { site } = data;
  const title = `Privacidad — ${site.name}`;
  const description = 'Qué datos pedimos para la descarga, qué medimos de las visitas y cómo pedir que borremos tus datos.';

  const head = renderHead({
    site,
    title,
    description,
    path: 'privacidad.html',
    ogImage: 'assets/og/home.png',
    extraHead: gaSnippet(site.ga)
  });

  const body = `${renderHeader({ site, ctaHref: 'index.html#descargar', nav: [] })}
<main class="page page--plain legal">
  <div class="wrap" style="padding:48px 0 80px;max-width:760px;display:flex;flex-direction:column;gap:36px">
    <div style="display:flex;flex-direction:column;gap:14px">
      <a href="index.html" class="btn-link" style="padding-left:0">← INICIO</a>
      <h1>Privacidad</h1>
      <p class="lede">Qué datos pedimos para la descarga, qué medimos de las visitas y cómo pedir que borremos tus datos.</p>
    </div>

    <section class="legal-section">
      <h2><span>01</span>Qué pedimos</h2>
      <p>Solo tu dirección de mail, para mandarte el código de verificación que habilita las descargas. Opcionalmente, tu permiso para avisarte cuando salga C2 · Sync Master Envelopment.</p>
    </section>

    <section class="legal-section">
      <h2><span>02</span>Para qué lo usamos</h2>
      <p>Para verificar que el mail es tuyo y, si marcaste la opción, para el aviso de lanzamiento. No vendemos ni cedemos tu mail a terceros, y no mandamos publicidad.</p>
    </section>

    <section class="legal-section">
      <h2><span>03</span>Los instrumentos no recolectan nada</h2>
      <p>Los 5 instrumentos corren 100% en tu navegador. Tus patrones, patches, presets y grabaciones se guardan solo en tu dispositivo (localStorage / IndexedDB) y nunca se envían a ningún servidor.</p>
    </section>

    <section class="legal-section">
      <h2><span>04</span>Qué queda en tu navegador</h2>
      <p>Al verificar, este sitio recuerda tu mail en tu navegador para que no tengas que repetir el proceso en cada instrumento. Lo podés borrar con "Usar otro mail" en la sección de descarga o limpiando los datos del sitio.</p>
    </section>

    <section class="legal-section">
      <h2><span>05</span>Estadísticas de visitas</h2>
      <p>Las páginas de este sitio usan Google Analytics para medir visitas de forma agregada: páginas vistas, país aproximado, tipo de dispositivo y navegador. Google usa cookies para esto. No le enviamos tu mail ni lo que hacés dentro de los instrumentos. Podés bloquearlo con el complemento oficial de inhabilitación de Google Analytics o con cualquier bloqueador de rastreo.</p>
    </section>

    <section class="legal-section">
      <h2><span>06</span>Tus derechos</h2>
      <p>Podés pedir acceso, corrección o eliminación de tu mail en cualquier momento, según la Ley 25.326 de Protección de Datos Personales. Para hacerlo, respondé el mail con el que te llegó el código.</p>
    </section>

    <p style="margin:0;font-size:12px;letter-spacing:.1em;color:var(--zd-dim)">ÚLTIMA ACTUALIZACIÓN · OCTUBRE 2026</p>
  </div>
</main>
${renderFooter()}`;

  return renderDoc({ head, body });
}
