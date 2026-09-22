import express        from 'express'
import cors           from 'cors'
import helmet         from 'helmet'
import morgan         from 'morgan'
import compression    from 'compression'
import rateLimit      from 'express-rate-limit'
import 'express-async-errors'
import authRouter        from './modules/auth/auth.routes.js'
import restaurantsRouter from './modules/restaurants/restaurants.routes.js'
import productsRouter    from './modules/products/products.routes.js'
import ordersRouter      from './modules/orders/orders.routes.js'
import paymentsRouter    from './modules/payments/payments.routes.js'
import { mpWebhook }     from './modules/payments/payments.controller.js'
import adminRouter       from './modules/admin/admin.routes.js'
import marketingRouter   from './modules/admin/marketing.routes.js'
import financeRouter     from './modules/admin/finance.routes.js'
import driversRouter     from './modules/drivers/drivers.routes.js'
import uploadsRouter     from './modules/storage/uploads.routes.js'
import reportsRouter     from './modules/reports/reports.routes.js'

const app = express()

// ── 0. Confiar en el proxy (Render / Railway / Fly.io) ────────────
// CRÍTICO: sin esto, Express ve la IP del proxy reverso para TODAS las
// requests (siempre la misma), no la IP real de cada visitante. Eso hace
// que el rate limiter de abajo agrupe a TODOS los usuarios bajo un solo
// "cliente" — con 100 usuarios reales, la app entera se quedaría sin cuota
// (300 req/min) casi de inmediato, sin que sea un problema de capacidad real.
// '1' = confiar en el primer proxy (correcto para Render/Railway, que están
// detrás de un único balanceador). En local no afecta nada.
app.set('trust proxy', 1)

// ── 1. Compresión gzip — reduce hasta 70% el payload ─────────────
app.use(compression({ level: 6, threshold: 1024 }))

// ── 2. Seguridad ──────────────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// ── 3. Rate limiting ──────────────────────────────────────────────
// Límite global: 300 req / min por IP — protege contra picos
const globalLimiter = rateLimit({
  windowMs:          60 * 1000,
  max:               300,
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { success: false, message: 'Demasiadas solicitudes. Intenta en un momento.' },
})
// Límite estricto para auth (evita brute force)
const authLimiter = rateLimit({
  windowMs:          15 * 60 * 1000,
  max:               30,
  standardHeaders:   true,
  legacyHeaders:     false,
  message:           { success: false, message: 'Demasiados intentos. Intenta en 15 minutos.' },
})

app.use(globalLimiter)

// ── 4. Parsers ────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// ── 5. Logger — solo en desarrollo ───────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'))
} else {
  // En producción: formato mínimo para no saturar I/O
  app.use(morgan('tiny'))
}

// ── 6. Cache HTTP para endpoints públicos ─────────────────────────
// Los browsers/CDN cachearán la lista de restaurantes por 30s
app.use('/api/v1/restaurants', (req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
  }
  next()
})
app.use('/api/v1/products', (req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  }
  next()
})

// ── 7. Health check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ status: 'ok', pid: process.pid, timestamp: new Date().toISOString() })
})

// ── 8. Rutas ──────────────────────────────────────────────────────
app.use('/api/v1/auth',        authLimiter, authRouter)
app.use('/api/v1/restaurants', restaurantsRouter)
app.use('/api/v1/products',    productsRouter)
app.use('/api/v1/orders',      ordersRouter)

// Webhook de Mercado Pago — PÚBLICO, sin JWT (lo llaman los servidores de MP).
// Debe registrarse antes que el router autenticado de payments para no
// pasar por el middleware authenticate().
app.post('/api/v1/payments/mercadopago/webhook', mpWebhook)

app.use('/api/v1/payments',    paymentsRouter)
app.use('/api/v1/admin',       adminRouter)
app.use('/api/v1/admin-marketing', marketingRouter)
app.use('/api/v1/admin-finance', financeRouter)
app.use('/api/v1/drivers',     driversRouter)
app.use('/api/v1/uploads',     uploadsRouter)
app.use('/api/v1/reports',     reportsRouter)

// ── 9. 404 ────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` })
})

// ── 10. Error handler global ──────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.status === 401) return res.status(401).json({ success: false, message: 'Token inválido o expirado' })
  if (err.status === 403) return res.status(403).json({ success: false, message: 'Sin permisos' })
  if (err.code   === 'P2002') return res.status(409).json({ success: false, message: 'Ya existe un registro con esos datos' })
  if (err.code === 'P2021' || err.code === 'P2022') return res.status(503).json({ success: false, message: 'Falta actualizar el esquema de la base de datos. Ejecuta npm run db:migrate en el backend.' })
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code && { code: err.code }),
    })
  }
  console.error('Error inesperado:', err)
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Error interno' : err.message,
  })
})

export default app
