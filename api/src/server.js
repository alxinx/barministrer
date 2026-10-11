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
import { requireAuth } from './middleware/auth.js'
import { initRealtime } from './lib/realtime.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use('/api/auth', authRoutes)
app.use('/api', requireAuth, catalogRoutes)
app.use('/api', requireAuth, layoutRoutes)
app.use('/api', requireAuth, shiftRoutes)
app.use('/api', requireAuth, customerRoutes)
app.use('/api', requireAuth, orderRoutes)
app.use('/api', requireAuth, inventoryRoutes)
app.use('/api', requireAuth, userRoutes)
app.use('/api', requireAuth, tenantRoutes)

app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Algo fallo en el servidor' })
})

const httpServer = createServer(app)
initRealtime(httpServer)

const port = process.env.PORT || 4000
httpServer.listen(port, () => console.log(`API en http://localhost:${port}`))
