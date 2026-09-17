import * as authService from './auth.service.js'
import { prisma } from '../../config/database.js'
import { getIdentityClaims } from '../../config/auth0.js'
import { AppError } from '../../shared/utils/appError.js'
import { invalidateUserCache } from '../../middleware/auth.middleware.js'
import { createHash } from 'node:crypto'

// POST /api/v1/auth/sync
export async function sync(req, res) {
  const { sub: auth0Id } = req.auth.payload
  const { email, name, picture } = getIdentityClaims(req.auth.payload)

  const { user, isNew } = await authService.syncUser({
    auth0Id,
    email,
    name,
    avatarUrl: picture,
  })

  if (user.role === 'ADMIN' || user.role === 'MARKETING_ADMIN') {
    await prisma.adminSession.create({ data: { userId: user.id } })
  }

  res.status(isNew ? 201 : 200).json({
    success: true,
    message: isNew ? 'Usuario creado' : 'Usuario sincronizado',
    data: user,
  })
}

// GET /api/v1/auth/me
export async function me(req, res) {
  const user = await authService.getProfile(req.user.id)
  res.json({ success: true, data: user })
}

// PATCH /api/v1/auth/me
export async function updateMe(req, res) {
  const { name, phone } = req.body
  const user = await authService.updateProfile(req.user.id, { name, phone })
  res.json({ success: true, data: user })
}

// PATCH /api/v1/auth/users/:id/role
export async function changeRole(req, res) {
  const { role } = req.body
  if (!role) {
    return res.status(400).json({ success: false, message: 'El campo role es requerido' })
  }
  const user = await authService.changeRole(req.params.id, role)
  res.json({ success: true, message: `Rol actualizado a ${role}`, data: user })
}

// POST /api/v1/auth/register-restaurant
export async function registerRestaurant(req, res) {
  const userId = req.user.id
  const {
    name, ruc, category, description,
    address, addressReference, district, phone, latitude, longitude, logoUrl,
  } = req.body
 
  // Validaciones
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!name || !ruc || !category || !address || !district || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({
      success: false,
      message: 'Nombre, RUC, categoría, dirección, distrito y ubicación en el mapa son requeridos',
    })
  }
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({
      success: false,
      message: 'El RUC debe tener exactamente 11 dígitos',
    })
  }
 
  // Verificar que el usuario no tenga ya un restaurante
  const existing = await prisma.restaurant.findUnique({ where: { ownerId: userId } })
  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'Ya tienes un restaurante registrado',
    })
  }
 
  // Verificar que el RUC no esté en uso
  const rucInUse = await prisma.restaurant.findUnique({ where: { ruc } })
  if (rucInUse) {
    return res.status(409).json({
      success: false,
      message: 'Este RUC ya está registrado en la plataforma',
    })
  }
 
  // Crear restaurante y actualizar rol en una sola transacción
  const [restaurant] = await prisma.$transaction([
    prisma.restaurant.create({
      data: {
        ownerId: userId,
        name, ruc, category, description,
        logoUrl: logoUrl || null,
        address, addressReference: addressReference || null, district, phone,
        latitude: lat, longitude: lng,
        status: 'PENDING_VERIFICATION',
        isDeliveryEnabled:    true,
        isReservationEnabled: true,
        deliveryFee:          0,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data:  { role: 'RESTAURANT_OWNER' },
    }),
  ])
 
  res.status(201).json({
    success: true,
    message: 'Restaurante registrado. Pendiente de verificación por el administrador.',
    data: restaurant,
  })
}

// POST /api/v1/auth/register-admin
// El único correo autorizado se configura en ADMIN_EMAIL dentro de Render.
export async function registerAdmin(req, res) {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const currentEmail = String(req.user.email || '').trim().toLowerCase()

  if (!adminEmail) throw new AppError('El correo del administrador no está configurado', 503)
  if (currentEmail !== adminEmail) throw new AppError('Esta cuenta no está autorizada para ser administradora', 403)

  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  })

  if (existingAdmin && existingAdmin.id !== req.user.id) {
    throw new AppError('Ya existe un administrador registrado en la plataforma', 409)
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { role: 'ADMIN' },
    select: { id: true, name: true, email: true, role: true },
  })
  await prisma.adminSession.create({ data: { userId: user.id } })
  invalidateUserCache(req.user.auth0Id)

  res.json({ success: true, message: 'Administrador registrado correctamente', data: user })
}

export async function registerMarketingAdmin(req, res) {
  if (req.user.role === 'ADMIN') throw new AppError('La cuenta ya es administradora principal', 409)
  const email = String(req.user.email || '').trim().toLowerCase()
  const token = String(req.body.inviteToken || '')
  if (!token) throw new AppError('Abre el enlace de invitación que te compartió el administrador', 403)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const invite = await prisma.marketingAdminInvite.findUnique({ where: { tokenHash } })
  if (!invite || invite.status !== 'APPROVED' || !invite.tokenExpiresAt || invite.tokenExpiresAt <= new Date()) throw new AppError('El enlace de invitación no es válido o venció. Pide uno nuevo al administrador.', 403)
  if (invite.email && invite.email.toLowerCase() !== email) throw new AppError('Este enlace ya fue usado con otro correo de Auth0', 403)
  if (req.user.role === 'MARKETING_ADMIN') {
    if (invite.email !== email) throw new AppError('Esta cuenta ya tiene otra invitación de marketing', 409)
    return res.json({ success: true, data: { role: req.user.role } })
  }
  const user = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "marketing_admin_invites" WHERE "id" = ${invite.id} FOR UPDATE`
    const currentInvite = await tx.marketingAdminInvite.findUnique({ where: { id: invite.id } })
    if (!currentInvite || currentInvite.status !== 'APPROVED' || !currentInvite.tokenExpiresAt || currentInvite.tokenExpiresAt <= new Date()) throw new AppError('El enlace de invitación ya no está activo', 403)
    if (currentInvite.email && currentInvite.email.toLowerCase() !== email) throw new AppError('Este enlace ya fue usado con otro correo de Auth0', 403)
    const anotherInvite = await tx.marketingAdminInvite.findFirst({ where: { id: { not: invite.id }, email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
    if (anotherInvite) throw new AppError('Este correo ya está asociado a otra cuenta de marketing', 409)
    await tx.marketingAdminInvite.update({ where: { id: invite.id }, data: { email } })
    const updated = await tx.user.update({ where: { id: req.user.id }, data: { role: 'MARKETING_ADMIN' }, select: { id: true, name: true, email: true, role: true } })
    await tx.adminSession.create({ data: { userId: req.user.id } })
    return updated
  }, { isolationLevel: 'Serializable' })
  invalidateUserCache(req.user.auth0Id)
  res.json({ success: true, message: 'Administrador de marketing registrado', data: user })
}

export async function endAdminSession(req, res) {
  const session = await prisma.adminSession.findFirst({ where: { userId: req.user.id, endedAt: null }, orderBy: { startedAt: 'desc' } })
  if (session) await prisma.adminSession.update({ where: { id: session.id }, data: { endedAt: new Date() } })
  res.json({ success: true })
}
