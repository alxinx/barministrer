import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { authRoutes } from './routes/auth.js'
import { catalogRoutes } from './routes/catalog.js'
import { layoutRoutes } from './routes/layout.js'
import { shiftRoutes } from './routes/shifts.js'
import { requireAuth } from './middleware/auth.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use('/api/auth', authRoutes)
app.use('/api', requireAuth, catalogRoutes)
app.use('/api', requireAuth, layoutRoutes)
app.use('/api', requireAuth, shiftRoutes)

app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Algo fallo en el servidor' })
})

const port = process.env.PORT || 4000
app.listen(port, () => console.log(`API en http://localhost:${port}`))
