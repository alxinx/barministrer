/** @type {import('tailwindcss').Config} */
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
        // Interfaz oscura: el bar opera de noche con poca luz. Una pantalla
        // clara encandila y se lee peor a metro y medio de distancia.
        night: '#0E0C13',
        surface: '#171420',
        raised: '#211D2C',
        edge: '#2E2939',
        ink: '#F2EFE8', // texto principal
        muted: '#9A93A8', // texto secundario
        amber: '#E8A33D', // accion principal: la luz del bar
        amberDim: '#8A6321',
        libre: '#5FD18C',
        ocupada: '#E05252',
        reservada: '#E8A33D',
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Los numeros de mesa son el heroe de la pantalla: se leen de lejos.
        mesa: ['2.25rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '800' }],
      },
      borderRadius: {
        pill: '999px',
      },
    },
  },
  plugins: [],
}
