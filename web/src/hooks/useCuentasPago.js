import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'

// Bancos/billeteras reales registrados en el modulo de Cajas y bancos, para
// ofrecerlos como medio de pago (ver CerrarCuentaModal.jsx y
// ClienteDetalle.jsx). Sin el modulo activo ni ni una cuenta cargada, la
// lista queda vacia y quien la use cae solo a los medios genericos de
// siempre -- nunca pide confirmacion aparte, es transparente.
export function useCuentasPago() {
  const { session } = useAuth()
  const [cuentas, setCuentas] = useState([])

  useEffect(() => {
    if (!session?.tenant?.moduloCajasBancos) return setCuentas([])
    api('/cajas-bancos/cuentas-pago')
      .then(setCuentas)
      .catch(() => setCuentas([]))
  }, [session?.tenant?.moduloCajasBancos])

  return cuentas
}
