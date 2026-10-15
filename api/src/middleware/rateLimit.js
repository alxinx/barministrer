import rateLimit from 'express-rate-limit'

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

// El PIN son 5 digitos (100.000 combinaciones). Se verifica en tres sitios
// (verify-pin, devolver un item, descuento al cerrar) y los tres necesitan
// el mismo freno: sin esto, cualquier sesion ya autenticada -hasta una
// mesera, que es justo a quien el PIN esta pensado para frenar- puede
// recorrerlas todas en minutos. La cuenta es por usuario autenticado
// (req.auth ya existe: requireAuth corre antes), no por IP, porque todo el
// equipo comparte la IP del bar. Solo los intentos fallidos cuentan: un PIN
// correcto nunca gasta cuota.
export const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.auth.userId,
  message: { error: 'Demasiados intentos de PIN. Espera unos minutos.' },
})

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
