import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Catalogo fijo de bancos/billeteras de Colombia. `codigo` es un slug interno
// estable (no el codigo ACH real) para no acoplarse a un cambio externo.
// Nadie importa el JSON directo fuera de aqui. Se lee con fs en vez de un
// import JSON para no depender de flags experimentales de Node.
export const ENTIDADES_FINANCIERAS = JSON.parse(
  readFileSync(join(__dirname, '../data/entidadesFinancieras.json'), 'utf-8')
)

export function buscarEntidadFinanciera(codigo) {
  return ENTIDADES_FINANCIERAS.find((e) => e.codigo === codigo) || null
}
