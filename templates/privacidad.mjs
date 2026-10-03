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
      <p>Tu dirección de mail, para un código de verificación de 6 dígitos que habilita las descargas. Opcionalmente, tu permiso para avisarte cuando salga C2 · Sync Master Envelopment (un checkbox que queda guardado junto con tu mail en tu propio navegador, no en ningún servidor nuestro).</p>
      <p>Hoy el sitio funciona en <strong>modo demo</strong>: el código no se envía por mail, se muestra directamente en pantalla, en tu navegador. No hay ningún servidor de mail conectado de nuestro lado.</p>
      <!-- TODO revisar con el titular -->
      <p class="legal-note">Si en algún momento se conecta un servicio de envío real (vía el hook <code>window.ZD_SEND_CODE</code>), esta sección se actualiza para reflejarlo — el resto del flujo (mail → código → descarga) no cambia.</p>
    </section>

    <section class="legal-section">
      <h2><span>02</span>Para qué lo usamos</h2>
      <p>El código serviría para confirmar que el mail es tuyo antes de habilitar la descarga. Mientras el sitio esté en modo demo (sección 01), ese código nunca sale de tu navegador: no hay backend que lo reciba, lo registre ni lo reenvíe. Si marcaste el aviso de C2, esa preferencia también queda solo en tu navegador — no se transmite a ningún servidor nuestro ni de terceros.</p>
      <!-- TODO revisar con el titular -->
      <p class="legal-note">No vendemos ni cedemos tu mail a terceros, y no mandamos publicidad: es un compromiso del proyecto, no algo que hoy el código fuerce técnicamente (porque hoy no hay ningún servidor que pudiera hacerlo). Confirmar que se mantiene así el día que haya un backend real.</p>
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
      <p>Las páginas de este sitio (no los instrumentos) usan Google Analytics para medir visitas de forma agregada: páginas vistas, país aproximado, tipo de dispositivo y navegador. Google usa cookies para esto. No le enviamos tu mail ni lo que hacés dentro de los instrumentos. Podés bloquearlo con el complemento oficial de inhabilitación de Google Analytics o con cualquier bloqueador de rastreo.</p>
      <p>Aparte, cuando escribís tu mail en el formulario de descarga, el sitio consulta si el dominio (la parte después del @, no tu casilla completa) puede recibir correo. Esa consulta se manda a <code>dns.google</code>, el resolver DNS público de Google — es lo único que sale de tu navegador en todo el proceso de descarga.</p>
    </section>

    <section class="legal-section">
      <h2><span>06</span>Tus derechos</h2>
      <p>Como hoy tu mail queda guardado únicamente en tu propio navegador (localStorage, ver sección 04) y no en un servidor nuestro, la forma más directa de acceder, corregir o eliminar ese dato es hacerlo vos mismo: "Usar otro mail" en la sección de descarga, o limpiar los datos del sitio desde la configuración del navegador.</p>
      <!-- TODO revisar con el titular -->
      <p class="legal-note">Esta sección todavía no define un canal de contacto formal para ejercer estos derechos conforme a la Ley 25.326 de Protección de Datos Personales. Si en el futuro el mail o las descargas pasan por un servidor propio, acá va a sumarse una vía de contacto concreta (y, de corresponder, inscripción ante el organismo de control).</p>
    </section>

    <p style="margin:0;font-size:12px;letter-spacing:.1em;color:var(--zd-dim)">ÚLTIMA ACTUALIZACIÓN · OCTUBRE 2026</p>
  </div>
</main>
${renderFooter()}`;

  return renderDoc({ head, body });
}
