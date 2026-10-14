import 'dotenv/config'
import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import { authRoutes } from './routes/auth.js'
import { catalogRoutes } from './routes/catalog.js'
import { layoutRoutes } from './routes/layout.js'
import { shiftRoutes } from './routes/shifts.js'
import { customerRoutes } from './routes/customers.js'
import { orderRoutes } from './routes/orders.js'
import { inventoryRoutes } from './routes/inventory.js'
import { userRoutes } from './routes/users.js'
import { tenantRoutes } from './routes/tenant.js'
import { reportRoutes } from './routes/reports.js'
import { requireAuth } from './middleware/auth.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { initRealtime } from './lib/realtime.js'

const app = express()

// El navegador llama la API en un origen distinto al que sirve nginx (ver
// web/nginx.conf: no hace proxy de /api), asi que no puede ir sin CORS. Pero
// "sin opciones" acepta cualquier origen: se restringe a los que de verdad
// sirven el frontend (el propio deploy + localhost en dev), no a internet
// entero. CORS_ORIGIN es una lista separada por comas.
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim())
app.use(cors({ origin: corsOrigins }))
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use('/api', apiLimiter)
app.use('/api/auth', authRoutes)
app.use('/api', requireAuth, catalogRoutes)
app.use('/api', requireAuth, layoutRoutes)
app.use('/api', requireAuth, shiftRoutes)
app.use('/api', requireAuth, customerRoutes)
app.use('/api', requireAuth, orderRoutes)
app.use('/api', requireAuth, inventoryRoutes)
app.use('/api', requireAuth, userRoutes)
app.use('/api', requireAuth, tenantRoutes)
app.use('/api', requireAuth, reportRoutes)

app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Algo fallo en el servidor' })
})

const httpServer = createServer(app)
initRealtime(httpServer)

const port = process.env.PORT || 4000
httpServer.listen(port, () => console.log(`API en http://localhost:${port}`))
