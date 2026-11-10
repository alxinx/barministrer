/** @type {import('tailwindcss').Config} */

// Cada token lee una CSS var "R G B" (ver :root y [data-theme] en index.css),
// para que un mismo nombre de color siga funcionando con modificadores de
// opacidad (bg-amber/10, border-edge/60...) en todos los temas.
function conVariable(variable) {
  return ({ opacityValue }) =>
    opacityValue !== undefined ? `rgb(var(${variable}) / ${opacityValue})` : `rgb(var(${variable}))`
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      screens: {
        // Punto donde el sidebar se retrae a solo iconos (ver Shell.jsx). No
        // es ninguno de los breakpoints estandar de Tailwind.
        nav: '900px',
      },
      colors: {
        // Paleta del login (ver Login.jsx): un mundo visual propio para la
        // pantalla de acceso, separado de los tokens operativos de arriba.
        // "lime" vive dentro de brand a proposito: Tailwind ya trae su
        // propia escala lime (lime-400/500) y no conviene pisarla.
        brand: {
          navy: '#0F172A',
          navyDark: '#090D16',
          navyCard: '#131D31',
          navyBorder: '#1E293B',
          lime: '#84CC16',
          limeHover: '#65A30D',
          limeDim: '#4D7C0F',
        },
        // night se mantiene fijo como texto de contraste sobre el acento.
        night: conVariable('--color-night'),
        amber: conVariable('--color-amber'),
        amberHover: conVariable('--color-amber-hover'),
        focus: conVariable('--color-focus'),
        // El resto SI cambia con el tema (ver index.css).
        // "canvas" (no "base"): Tailwind ya usa "base" como paso de su
        // escala de tamaños de letra (text-base = 1rem). Un color con ese
        // mismo nombre generaba una regla .text-base que le ponia color
        // ademas de tamano a CUALQUIER texto con esa clase en todo el sitio.
        canvas: conVariable('--color-canvas'),
        surface: conVariable('--color-surface'),
        raised: conVariable('--color-raised'),
        edge: conVariable('--color-edge'),
        ink: conVariable('--color-ink'),
        muted: conVariable('--color-muted'),
        // amberText es el tono de acento con contraste suficiente para texto
        // e iconos sobre superficies claras.
        amberText: conVariable('--color-amber-text'),
        amberDim: conVariable('--color-amber-dim'),
        warning: conVariable('--color-warning'),
        warningText: conVariable('--color-warning-text'),
        libre: conVariable('--color-libre'),
        ocupada: conVariable('--color-ocupada'),
        reservada: conVariable('--color-reservada'),
        // El menu lateral tiene su propio fondo para admitir variantes con
        // sidebar claro u oscuro sin cambiar las tarjetas.
        sidebar: conVariable('--color-sidebar'),
        sidebarRaised: conVariable('--color-sidebar-raised'),
        sidebarEdge: conVariable('--color-sidebar-edge'),
        sidebarInk: conVariable('--color-sidebar-ink'),
        sidebarMuted: conVariable('--color-sidebar-muted'),
        sidebarOcupada: conVariable('--color-sidebar-ocupada'),
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        jakarta: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        jbmono: ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        // Los numeros de mesa son el heroe de la pantalla: se leen de lejos.
        mesa: ['2.25rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '800' }],
      },
      borderRadius: {
        pill: '999px',
      },
      boxShadow: {
        'panel-card': '0 20px 40px -15px rgba(0, 0, 0, 0.7)',
      },
    },
  },
  plugins: [],
}
