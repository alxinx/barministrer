import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: { usePolling: true },
    // Permite exponer el dev server vía ngrok (ej. para probar en el celular
    // o mostrarle algo a Alejo sin desplegar). El subdominio cambia cada vez
    // que se reinicia el túnel gratuito, así que se permite el dominio entero.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
    // El frontend llama a /api con ruta relativa (ver web/src/lib/api.js) y
    // el dev server la reenvia al contenedor de la API. Asi funciona igual
    // desde el Mac, desde el celular en la misma red o desde un tunel de
    // ngrok, sin hardcodear "localhost" (que en el celular apuntaria al
    // celular, no al servidor).
    proxy: {
      '/api': { target: 'http://api:4000', changeOrigin: true },
    },
  },
})
