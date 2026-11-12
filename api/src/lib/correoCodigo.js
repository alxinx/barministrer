// Plantilla del correo de codigo de verificacion (activacion del agente de
// sincronizacion offline, ver POST /api/agent/activar en routes/agent.js).
// Usa los mismos colores de marca que web/src/pages/Login.jsx (navy/lime,
// definidos en web/tailwind.config.js) y el logo real ya publicado en
// produccion -- un correo no puede ejecutar JS ni animar nada, asi que no
// lleva boton de "copiar codigo" ni cuenta regresiva en vivo: serian
// elementos muertos en la bandeja de entrada real.
const LOGO_URL = 'https://app.barministrer.com/img/Logotipo.webp'

const COLOR = {
  navy: '#0F172A',
  lime: '#84CC16',
  limeHover: '#65A30D',
  limeBg: '#ECFCCB',
  limeBorder: '#BEF264',
  texto: '#334155',
  textoSuave: '#64748B',
  borde: '#E2E8F0',
  fondo: '#F1F5F9',
  advertenciaBg: '#FEFCE8',
  advertenciaBorde: '#FDE68A',
  advertenciaTexto: '#854D0E',
}

function cajaDigito(d) {
  return `<td style="width:44px;height:52px;background:${COLOR.fondo};border:1px solid ${COLOR.borde};border-radius:10px;text-align:center;vertical-align:middle;font:700 26px/52px 'Courier New',monospace;color:${COLOR.navy};">${d}</td>`
}

export function renderCorreoCodigoHtml({ codigo, minutos = 10 }) {
  const digitos = String(codigo).split('').map(cajaDigito).join(`<td style="width:8px;"></td>`)

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:32px 16px;background:${COLOR.fondo};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#FFFFFF;border:1px solid ${COLOR.borde};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 20px;text-align:center;">
                <img src="${LOGO_URL}" alt="Barminister" height="44" style="display:inline-block;height:44px;width:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px;text-align:center;">
                <span style="display:inline-block;background:${COLOR.limeBg};border:1px solid ${COLOR.limeBorder};color:#365314;font-size:11px;font-weight:700;letter-spacing:.04em;padding:5px 10px;border-radius:999px;">
                  ACTIVACIÓN DEL AGENTE DE SINCRONIZACIÓN OFFLINE
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 4px;text-align:center;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                  <tr><td style="width:56px;height:56px;background:${COLOR.limeBg};border:1px solid ${COLOR.limeBorder};border-radius:14px;text-align:center;vertical-align:middle;font-size:24px;">🔑</td></tr>
                </table>
                <h1 style="margin:0 0 8px;font-size:22px;color:${COLOR.navy};">Tu código de verificación</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${COLOR.textoSuave};">
                  Pon este código en tu ventana de ejecución para poder enlazar tus datos.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px;text-align:center;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>${digitos}</tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 0;">
                <p style="margin:0;font-size:13px;color:${COLOR.textoSuave};text-align:center;">
                  Vence en <strong style="color:${COLOR.navy};">${minutos} minutos</strong> desde el envío de este correo.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.advertenciaBg};border:1px solid ${COLOR.advertenciaBorde};border-radius:12px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:1.5;color:${COLOR.advertenciaTexto};">
                      Si no reconoces esta solicitud, ignora este correo. Nadie del equipo de Barminister te pedirá este código por llamada, WhatsApp o mensaje.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 24px;border-top:1px solid ${COLOR.borde};margin-top:24px;">
                <p style="margin:24px 0 0;font-size:11px;line-height:1.6;color:#94A3B8;text-align:center;">
                  Este es un mensaje automático del sistema de sincronización offline de Barminister.<br />
                  Por favor no respondas a este correo.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function renderCorreoCodigoTexto({ codigo, minutos = 10 }) {
  return `Tu código de verificación es ${codigo}.

Pon este código en tu ventana de ejecución para poder enlazar tus datos.

Vence en ${minutos} minutos desde el envío de este correo.

Si no reconoces esta solicitud, ignora este correo. Nadie del equipo de Barminister te pedirá este código por llamada, WhatsApp o mensaje.`
}
