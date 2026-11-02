import rateLimit, { MemoryStore } from 'express-rate-limit'

const PIN_WINDOW_MS = 10 * 60 * 1000
const PIN_MAX_INTENTOS = 3

// Freno general para toda /api, aparte de los especificos de login/PIN: un
// tope generoso por IP para que un script (o un bug con un loop) no tumbe el
// servidor, sin molestar el uso normal de un bar (el POS consulta seguido,
// pero ni de cerca 1000/min por IP). No cuenta por tenant ni por usuario:
// esto es proteccion de infraestructura, no de negocio.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento.' },
})

// Clave y correo son faciles de teclear mal, pero un script no tiene ese
// limite: sin esto, /login acepta intentos ilimitados. La clave combina IP +
// correo (no solo IP) porque todo el bar sale a internet por una sola IP de
// router: limitar solo por IP bloquearia a todo el equipo por un intento de
// forzar UNA cuenta. Los logins correctos no cuentan contra la cuota.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase().trim()}`,
  message: { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' },
})

// El PIN son 5 digitos (100.000 combinaciones). Se verifica en varios sitios
// (devolver un item, descuento/fiado al cerrar, merma, suspender producto,
// abrir/cerrar turno) y todos necesitan el mismo freno: sin esto, cualquier
// sesion ya autenticada -hasta una mesera, que es justo a quien el PIN esta
// pensado para frenar- puede recorrerlos todos en minutos. La cuenta es por
// usuario autenticado (req.auth ya existe: requireAuth corre antes), no por
// IP, porque todo el equipo comparte la IP del bar. Solo los intentos
// fallidos cuentan: un PIN correcto nunca gasta cuota. Maximo 3 intentos y
// bloqueo de 10 minutos, decision de Alejo (nov-2026): antes eran 8 en 15
// minutos.
//
// Store propio (en vez de dejar que rateLimit() cree el suyo por dentro):
// asi plataforma puede leer y escribir directamente el contador de un
// usuario (ver estadoPin/bloquearPinManual mas abajo) para mostrar "esta
// bloqueado" en /plataforma/tenants/:id y poder forzar el bloqueo a mano,
// sin inventar un segundo mecanismo de conteo aparte de este.
export const pinStore = new MemoryStore()

export const pinLimiter = rateLimit({
  windowMs: PIN_WINDOW_MS,
  max: PIN_MAX_INTENTOS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.auth.userId,
  store: pinStore,
  // Handler propio en vez de `message`: el frontend necesita segundosRestantes
  // para mostrar una cuenta regresiva en vivo, no solo el texto fijo (ver
  // usePinVerificado.js, que arma el cronometro con este numero).
  handler: async (req, res) => {
    const { segundosRestantes } = await estadoPin(req.auth.userId)
    res.status(429).json({
      error: 'Demasiados intentos de PIN incorrectos. Espera unos minutos antes de volver a intentar.',
      segundosRestantes,
    })
  },
})

// Estado actual del contador de un usuario, para que plataforma sepa si
// mostrar "Desbloquear PIN" o "Bloquear PIN" sin adivinar, y para que el
// handler de arriba arme la cuenta regresiva del lado del frontend.
export async function estadoPin(userId) {
  const client = await pinStore.get(userId)
  // >=, no >: al 3er fallo ya no quedan intentos (ver pinIncorrecto), asi
  // que la siguiente peticion -- sea cual sea el PIN -- va a fallar en
  // pinLimiter antes de llegar a verificarPin. Reportarlo como bloqueado
  // desde ese momento, no desde el intento extra que lo confirmaria, evita
  // que plataforma muestre "no bloqueado" mientras el usuario ya no puede
  // operar.
  const bloqueado = Boolean(client && client.totalHits >= PIN_MAX_INTENTOS)
  const segundosRestantes = bloqueado
    ? Math.max(1, Math.ceil((client.resetTime.getTime() - Date.now()) / 1000))
    : 0
  return { bloqueado, segundosRestantes }
}

// Bloqueo manual desde plataforma (ej. sospecha de que alguien esta
// probando PINs ajenos): mismo mecanismo que el bloqueo automatico por 3
// fallos, no un flag aparte, para que estadoPin/pinLimiter sigan viendo una
// sola fuente de verdad. Arranca en limpio y sube el contador mas alla del
// maximo para que la ventana completa de 10 minutos (PIN_WINDOW_MS) aplique
// desde ya, igual que si la persona hubiera fallado 3 veces justo ahora.
export async function bloquearPinManual(userId) {
  await pinStore.resetKey(userId)
  for (let i = 0; i <= PIN_MAX_INTENTOS; i++) {
    await pinStore.increment(userId)
  }
}

// Respuesta estandar cuando el PIN no coincide con ningun encargado: nunca
// 401 -ese codigo dispara el interceptor global de "sesion expirada" en el
// frontend (ver web/src/lib/api.js) y saca a la persona de la app como si se
// hubiera deslogueado, cuando en realidad su sesion sigue siendo valida y
// solo fallo la autorizacion puntual. Avisa cuantos intentos quedan en la
// ventana de pinLimiter (ya corrio antes en la misma request). Si este era
// el ultimo, responde 429 con segundosRestantes -- igual que el handler de
// pinLimiter arriba -- para que el frontend muestre la cuenta regresiva de
// una vez, en vez de esperar a que una peticion extra se lo confirme.
export async function pinIncorrecto(req, res) {
  const restantes = req.rateLimit?.remaining
  if (restantes === 0) {
    const { segundosRestantes } = await estadoPin(req.auth.userId)
    return res.status(429).json({
      error: 'Demasiados intentos de PIN incorrectos. Espera unos minutos antes de volver a intentar.',
      segundosRestantes,
    })
  }
  const error =
    restantes != null
      ? `PIN incorrecto. Te queda${restantes === 1 ? '' : 'n'} ${restantes} intento${restantes === 1 ? '' : 's'}.`
      : 'PIN incorrecto.'
  res.status(403).json({ error })
}

// Para usarlo a mitad de un handler (ej. el descuento al cerrar cuenta, que
// solo pide PIN si de verdad hay descuento) en vez de como middleware de toda
// la ruta. Si excede el limite, el limiter ya mando el 429 el solo (nunca
// llama next) y esto resuelve true para que el caller corte ahi sin mandar
// una segunda respuesta.
export function pinLimitExcedido(req, res) {
  return new Promise((resolve) => {
    let resuelto = false
    res.once('finish', () => {
      if (!resuelto) {
        resuelto = true
        resolve(true)
      }
    })
    pinLimiter(req, res, () => {
      if (!resuelto) {
        resuelto = true
        resolve(false)
      }
    })
  })
}
