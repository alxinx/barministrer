import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatformAuth } from '../../context/PlatformAuthContext'

export default function PlataformaLogin() {
  const { login } = usePlatformAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate('/plataforma')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10">
          <span className="w-11 h-11 rounded-xl bg-amber grid place-items-center text-night text-xl font-extrabold">
            L
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-none">LicorPlus</h1>
            <p className="text-sm text-muted mt-1.5">Panel de plataforma</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Correo
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Clave
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-ocupada border border-ocupada/30 bg-ocupada/10 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
