import { verifyToken, getIdentityClaims } from '../config/auth0.js'
import { prisma }      from '../config/database.js'
import { cacheGet, cacheSet, cacheDel } from '../config/cache.js'

export { verifyToken }

// ── TTL del cache de usuario: 2 minutos ──────────────────────────
// Un usuario autenticado activo hace decenas de requests/minuto.
// Sin cache: cada request = 1-3 queries a Supabase.
// Con cache: 0 queries durante 2 min → ~90% menos carga en BD.
const USER_CACHE_TTL = 120 // segundos

const include = {
  restaurant:      { select: { id: true, name: true, status: true } },
  driverProfile:   { select: { id: true, status: true, isVerified: true } },
  consumerProfile: { select: { id: true } },
}

async function findOrCreateUser(auth0Id, email, name, picture) {
  // 1. Buscar por auth0Id
  let user = await prisma.user.findUnique({ where: { auth0Id }, include })
  if (user) return user

  // 2. Buscar por email (usuario seed / otro proveedor OAuth)
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } })
    if (byEmail) {
      return prisma.user.update({
        where:   { id: byEmail.id },
        data:    { auth0Id, avatarUrl: byEmail.avatarUrl || picture },
        include,
      })
    }
  }

  // 3. Crear nuevo usuario
  return prisma.user.upsert({
    where:  { auth0Id },
    update: { name, avatarUrl: picture },
    create: { auth0Id, email, name, avatarUrl: picture, role: 'CONSUMER' },
    include,
  })
}

export async function loadUser(req, res, next) {
  try {
    const auth0Id = req.auth.payload.sub

    // ── Servir desde cache si está disponible ──────────────────
    const cacheKey = `user:${auth0Id}`
    const cached   = cacheGet(cacheKey)
    if (cached) {
      req.user = cached
      return next()
    }

    // ── Cache miss: ir a la BD ─────────────────────────────────
    const claims  = getIdentityClaims(req.auth.payload)
    const email   = claims.email
    const name    = claims.name || email.split('@')[0] || 'Usuario'
    const picture = claims.picture

    const user = await findOrCreateUser(auth0Id, email, name, picture)

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Cuenta suspendida. Contacta soporte.' })
    }
    if (user.role === 'MARKETING_ADMIN') {
      const invite = await prisma.marketingAdminInvite.findUnique({ where: { email: String(user.email).toLowerCase() }, select: { status: true } })
      if (invite?.status !== 'APPROVED') return res.status(403).json({ success: false, message: 'El acceso de marketing no está aprobado.' })
    }
    if (user.role === 'TECH_ADMIN') {
      const invite = await prisma.techAdminInvite.findUnique({ where: { email: String(user.email).toLowerCase() }, select: { status: true } })
      if (invite?.status !== 'APPROVED') return res.status(403).json({ success: false, message: 'El acceso técnico no está aprobado.' })
    }
    if (user.role === 'FINANCE_ADMIN') {
      const invite = await prisma.financeAdminInvite.findUnique({ where: { email: String(user.email).toLowerCase() }, select: { status: true } })
      if (invite?.status !== 'APPROVED') return res.status(403).json({ success: false, message: 'El acceso financiero no está aprobado.' })
    }

    // Guardar en cache
    cacheSet(cacheKey, user, USER_CACHE_TTL)

    req.user = user
    next()
  } catch (error) {
    next(error)
  }
}

/** Llama a esto cuando el usuario cambia de rol, restaurante, etc. */
export function invalidateUserCache(auth0Id) {
  cacheDel(`user:${auth0Id}`)
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para esta acción' })
    }
    next()
  }
}

export const authenticate = [verifyToken, loadUser]
