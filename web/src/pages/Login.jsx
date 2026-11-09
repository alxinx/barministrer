import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const THEME_KEY = 'barminister-login-theme'
const THEME_UNTIL_KEY = 'barminister-login-theme-until'

function isDaytime(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes >= 6 * 60 && minutes < 18 * 60
}

function nextThemeBoundary(now = new Date()) {
  const next = new Date(now)
  const minutes = now.getHours() * 60 + now.getMinutes()

  if (minutes < 6 * 60) {
    next.setHours(6, 0, 0, 0)
  } else if (minutes < 18 * 60) {
    next.setHours(18, 0, 0, 0)
  } else {
    next.setDate(next.getDate() + 1)
    next.setHours(6, 0, 0, 0)
  }

  return next
}

function initialTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY)
  const savedUntil = Number(localStorage.getItem(THEME_UNTIL_KEY))
  if ((savedTheme === 'light' || savedTheme === 'dark') && savedUntil > Date.now()) {
    return savedTheme === 'light'
  }

  localStorage.removeItem(THEME_KEY)
  localStorage.removeItem(THEME_UNTIL_KEY)
  return isDaytime()
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLight, setIsLight] = useState(initialTheme)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const now = new Date()
    const boundary = nextThemeBoundary(now)
    const timeout = window.setTimeout(() => {
      localStorage.removeItem(THEME_KEY)
      localStorage.removeItem(THEME_UNTIL_KEY)
      setIsLight(isDaytime())
    }, boundary.getTime() - now.getTime() + 50)

    return () => window.clearTimeout(timeout)
  }, [isLight])

  function toggleTheme() {
    const nextIsLight = !isLight
    localStorage.setItem(THEME_KEY, nextIsLight ? 'light' : 'dark')
    localStorage.setItem(THEME_UNTIL_KEY, String(nextThemeBoundary().getTime()))
    setIsLight(nextIsLight)
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate('/venta')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`login-shell ${isLight ? 'login-light' : ''} login-pos-pattern relative flex min-h-screen flex-col overflow-hidden ${
        isLight ? 'text-slate-900' : 'text-slate-100'
      }`}
    >
      <div
        aria-hidden="true"
        className={`${isLight ? 'login-light-glow' : ''} login-ambient-glow pointer-events-none absolute left-1/2 top-12 h-[28rem] w-[36rem] max-w-[110vw] -translate-x-1/2`}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-center gap-3">
          <img
            src={isLight ? '/img/Logotipo.webp' : '/img/Logotipo blanco y verde.webp'}
            alt="Barminister"
            className="h-auto w-28 sm:w-32"
          />
          <span
            className={`hidden border-l pl-3 font-jbmono text-[10px] uppercase tracking-[0.16em] sm:block ${
              isLight ? 'border-slate-300 text-slate-600' : 'border-brand-navyBorder text-slate-400'
            }`}
          >
            Punto de venta
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-jbmono text-[10px] shadow-sm ${
              isLight
                ? 'border-slate-200 bg-white/90 text-slate-600'
                : 'border-brand-navyBorder/80 bg-brand-navy/70 text-slate-300'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
            <span className="hidden sm:inline">Acceso del Negocio</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isLight}
            aria-label={`Tema ${isLight ? 'claro' : 'oscuro'}. Cambiar a tema ${isLight ? 'oscuro' : 'claro'}`}
            onClick={toggleTheme}
            className={`relative inline-flex h-8 w-[4.25rem] shrink-0 items-center rounded-full border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime focus-visible:ring-offset-2 ${
              isLight
                ? 'border-slate-200 bg-slate-100 focus-visible:ring-offset-[#f7f9fc]'
                : 'border-brand-navyBorder bg-brand-navy focus-visible:ring-offset-[#090d16]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute grid h-5 w-5 place-items-center ${
                isLight ? 'right-1 text-slate-500' : 'left-1 text-slate-500'
              }`}
            >
              {isLight ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
                  <path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
              )}
            </span>
            <span
              aria-hidden="true"
              className={`relative z-10 grid h-6 w-6 place-items-center rounded-full bg-brand-lime text-brand-navyDark shadow-sm transition-transform ${
                isLight ? 'translate-x-0' : 'translate-x-8'
              }`}
            >
              {isLight ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z" />
                </svg>
              )}
            </span>
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10">
        <section
          className={`w-full max-w-[26rem] rounded-2xl border px-6 py-7 shadow-[0_18px_48px_rgba(15,23,42,0.08)] sm:px-7 sm:py-8 ${
            isLight
              ? 'border-slate-200 bg-white'
              : 'border-brand-navyBorder bg-brand-navy/90 shadow-[0_24px_70px_rgba(0,0,0,0.38)]'
          }`}
        >
          <div className="mb-6 flex justify-center">
            <img
              src={isLight ? '/img/Logotipo.webp' : '/img/Logotipo blanco y verde.webp'}
              alt="Barminister"
              className="h-auto w-48"
            />
          </div>

          <div className="mb-6 text-center">
            <h1 className={`font-jakarta text-xl font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Iniciar sesión
            </h1>
            <p className={`mx-auto mt-2 max-w-xs text-[13px] leading-5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              Accede a la operación de tu negocio.
            </p>
            <div
              className={`mx-auto mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-jbmono text-[10px] ${
                isLight
                  ? 'border-slate-200 bg-slate-50 text-slate-700'
                  : 'border-brand-navyBorder bg-brand-navyDark/70 text-slate-300'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand-lime" />
              Personal autorizado
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label
                className={`mb-1.5 block text-[10px] font-medium uppercase tracking-[0.08em] ${
                  isLight ? 'text-slate-700' : 'text-slate-300'
                }`}
                htmlFor="email"
              >
                Usuario operativo / correo
              </label>
              <div className="relative">
                <svg
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="12" cy="8" r="3.25" />
                  <path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20z" />
                </svg>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  className={`h-11 w-full rounded-xl border pl-10 pr-3 text-sm transition placeholder:text-slate-500 focus:border-brand-lime focus:outline-none focus:ring-2 focus:ring-brand-lime/20 ${
                    isLight
                      ? 'border-slate-300 bg-slate-50 text-slate-900'
                      : 'border-brand-navyBorder bg-brand-navyDark/55 text-slate-100'
                  }`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  className={`block text-[10px] font-medium uppercase tracking-[0.08em] ${
                    isLight ? 'text-slate-700' : 'text-slate-300'
                  }`}
                  htmlFor="password"
                >
                  Contraseña
                </label>
              </div>
              <div className="relative">
                <svg
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${
                    isLight ? 'text-slate-500' : 'text-slate-400'
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <rect x="5.5" y="10" width="13" height="10" rx="2" />
                  <path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3" />
                  <path d="M12 14v2" />
                </svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className={`h-11 w-full rounded-xl border pl-10 pr-11 text-sm transition placeholder:text-slate-500 focus:border-brand-lime focus:outline-none focus:ring-2 focus:ring-brand-lime/20 ${
                    isLight
                      ? 'border-slate-300 bg-slate-50 text-slate-900'
                      : 'border-brand-navyBorder bg-brand-navyDark/55 text-slate-100'
                  }`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((shown) => !shown)}
                  className={`absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-lime ${
                    isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {showPassword ? (
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    >
                      <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                      <path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.5 0 9 7 9 7a15.7 15.7 0 0 1-3.1 3.9M6.2 6.3C4.1 7.7 3 12 3 12s3.5 7 9 7a9.9 9.9 0 0 0 4-.8" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    >
                      <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p
                id="login-error"
                role="alert"
                className={`rounded-xl border px-3 py-2.5 text-sm ${
                  isLight
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-red-400/25 bg-red-950/45 text-red-200'
                }`}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-lime px-4 text-sm font-bold text-brand-navyDark shadow-[0_8px_24px_rgba(132,204,22,0.2)] transition hover:bg-brand-limeHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-lime focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Ingresando…' : 'Ingresar al sistema'}
              {!busy && (
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
          </form>

          <div className={`mt-5 border-t pt-4 text-center ${isLight ? 'border-slate-200' : 'border-brand-navyBorder/80'}`}>
            <p className={`text-[11px] leading-5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              ¿No puedes entrar? Pídele ayuda al administrador.
            </p>
          </div>
        </section>
      </main>

      <footer
        className={`relative z-10 mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-6 py-4 font-jbmono text-[9px] uppercase tracking-[0.08em] sm:px-8 ${
          isLight ? 'border-slate-200 text-slate-600' : 'border-brand-navyBorder/70 text-slate-400'
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <rect x="5.5" y="10" width="13" height="10" rx="2" />
            <path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3" />
          </svg>
          Acceso de personal
        </span>
        <span>Barminister · Punto de venta</span>
      </footer>
    </div>
  )
}
