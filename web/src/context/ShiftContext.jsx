// El turno abierto lo necesitan tanto Nueva venta (para saber si puede
// vender) como Caja (para mostrarlo y cerrarlo). Antes cada pantalla lo
// pedia por su cuenta al montarse, asi que rebotar entre las dos repetia la
// misma llamada a /shifts/current. Un solo fetch por sesion, compartido.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from './AuthContext'

const ShiftContext = createContext(null)

export function ShiftProvider({ children }) {
  const { session } = useAuth()
  const [shift, setShift] = useState(undefined) // undefined = cargando, null = sin turno abierto

  const reload = useCallback(() => {
    if (!session) return
    api('/shifts/current').then(setShift)
  }, [session])

  useEffect(() => {
    if (session) reload()
    else setShift(undefined)
  }, [session, reload])

  return <ShiftContext.Provider value={{ shift, setShift, reload }}>{children}</ShiftContext.Provider>
}

export const useShift = () => useContext(ShiftContext)
