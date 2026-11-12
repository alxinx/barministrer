import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

// Cuenta de AWS real (no Cloudflare como R2): recoge credenciales de las
// variables de entorno, o del rol IAM de la instancia en produccion si no
// hay variables explicitas -- mismo comportamiento por defecto del SDK.
const client = new SESv2Client({ region: process.env.AWS_REGION })

// Usado por el flujo de activacion del agente de sincronizacion offline
// (ver POST /api/agent/activar en routes/agent.js y
// contexto-sincronizacion-offline.md). SES_FROM_EMAIL debe ser una
// identidad verificada en SES -- si la cuenta sigue en modo sandbox,
// tambien el destinatario tiene que estar verificado.
export async function enviarCorreo({ to, subject, text, html }) {
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            ...(html && { Html: { Data: html, Charset: 'UTF-8' } }),
          },
        },
      },
    })
  )
}
