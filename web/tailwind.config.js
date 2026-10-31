/** @type {import('tailwindcss').Config} */

// Cada token lee una CSS var "R G B" (ver :root y [data-theme="sepia"] en
// index.css), para que un mismo nombre de color siga funcionando con
// modificadores de opacidad (bg-amber/10, border-edge/60...) sin tocar cada
// clase del proyecto al agregar el tema claro.
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
        // "night" y "amber" quedan fijos en ambos temas a proposito: night
        // es el oscuro de contraste detras del acento (texto de boton,
        // chips sobre fondo oscuro); amber es el relleno audaz del acento.
        // Si cambiaran con el tema, un boton ambar con texto oscuro
        // perderia su contraste justo en el tema donde mas se nota.
        night: conVariable('--color-night'),
        amber: conVariable('--color-amber'),
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
        // amberText: el ambar usado como texto/icono directo sobre una
        // superficie clara. Separado de "amber" (el relleno) porque el
        // mismo tono que se ve bien como fondo de boton no alcanza
        // contraste 4.5:1 como texto sobre el tema sepia.
        amberText: conVariable('--color-amber-text'),
        amberDim: conVariable('--color-amber-dim'),
        libre: conVariable('--color-libre'),
        ocupada: conVariable('--color-ocupada'),
        reservada: conVariable('--color-reservada'),
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
