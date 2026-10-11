import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, money } from '../lib/api'
import { Icon } from '../components/Icons'
import ClienteForm from '../components/ClienteForm'

export default function Clientes() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState(undefined) // undefined = cerrado, null = nuevo cliente

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setCustomers(await api('/customers'))
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((c) =>
      [c.firstName, c.lastName, c.alias, c.idNumber].filter(Boolean).join(' ').toLowerCase().includes(term)
    )
  }, [customers, search])

  function cerrar() {
    setTarget(undefined)
  }
  function guardado(saved) {
    cerrar()
    load()
    if (saved?.id) navigate(`/clientes/${saved.id}`)
  }

  return (
    <div className="p-5 md:p-7 max-w-[1100px] mx-auto">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-muted text-sm mt-1">
            Datos de contacto, crédito en el bar y el historial de lo que deben.
          </p>
        </div>
        <button onClick={() => setTarget(null)} className="btn-primary">
          <Icon.plus />
          Nuevo cliente
        </button>
      </header>

      <div className="relative mb-5 max-w-sm">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon.search />
        </span>
        <input
          className="field pl-10"
          placeholder="Buscar por nombre, alias o cédula"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {visible.map((c) => {
              const ultimoAbono = [...c.payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
              const diasSinAbono = diasDesde(ultimoAbono?.createdAt || c.createdAt)
              const atrasado = c.creditEnabled && c.balance > 0 && diasSinAbono >= 15

              return (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clientes/${c.id}`)}
                  className="border-b border-edge/60 last:border-0 cursor-pointer hover:bg-raised/60"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full shrink-0 grid place-items-center text-[11px] font-bold text-night bg-amber">
                        {c.firstName.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium">
                          {c.firstName} {c.lastName}
                          {c.alias && <span className="text-muted font-normal"> · {c.alias}</span>}
                        </p>
                        <p className="text-xs text-muted">
                          {[c.whatsapp, c.email].filter(Boolean).join(' · ') || 'Sin contacto registrado'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.creditEnabled && (
                      <span className="text-[10px] font-bold text-amber border border-amber/40 rounded-pill px-2 py-0.5">
                        Crédito
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {atrasado && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ocupada border border-ocupada/40 bg-ocupada/10 rounded-pill px-2 py-0.5">
                        <Icon.alert width={11} height={11} />
                        Sin abono hace {diasSinAbono}d
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span
                      className={`text-xs font-semibold px-3 py-1.5 rounded-pill border ${
                        c.balance > 0
                          ? 'text-ocupada border-ocupada/40 bg-ocupada/10'
                          : c.balance < 0
                            ? 'text-reservada border-reservada/40 bg-reservada/10'
                            : 'text-libre border-libre/40 bg-libre/10'
                      }`}
                    >
                      {c.balance === 0
                        ? 'Al día'
                        : c.balance > 0
                          ? `Debe ${money(c.balance)}`
                          : `A favor ${money(-c.balance)}`}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-4 py-10 text-center text-muted text-sm">No hay clientes con ese filtro.</p>
        )}
      </div>

      {target !== undefined && <ClienteForm customer={target} onClose={cerrar} onSaved={guardado} />}
    </div>
  )
}

function diasDesde(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}
