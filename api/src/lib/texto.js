// "Titulo inteligente": cada palabra arranca en mayuscula, salvo conectores
// (de, y, en...) que quedan en minuscula a menos que abran el nombre -- el
// mismo criterio editorial que ya se usa para titulos en espanol. Pensado
// para Insumo.name y Product.name: nombres escritos por distintos operadores
// (a veces TODO MAYUSCULAS, a veces sin cuidar mayusculas/minusculas) quedan
// visualmente consistentes sin importar como se hayan tecleado.
const CONECTORES = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u',
  'en', 'con', 'a', 'al', 'para', 'por', 'sin', 'sobre', 'tras',
])

function capitalizarPalabra(palabra) {
  // Tambien capitaliza tras un guion ("Coca-Cola"), no solo el inicio.
  return palabra
    .split('-')
    .map((parte) => (parte ? parte.charAt(0).toLocaleUpperCase('es') + parte.slice(1) : parte))
    .join('-')
}

export function tituloInteligente(texto) {
  if (!texto) return texto
  const limpio = texto.trim().replace(/\s+/g, ' ')
  if (!limpio) return limpio
  return limpio
    .split(' ')
    .map((palabra, idx) => {
      const minuscula = palabra.toLocaleLowerCase('es')
      if (idx > 0 && CONECTORES.has(minuscula)) return minuscula
      return capitalizarPalabra(minuscula)
    })
    .join(' ')
}
