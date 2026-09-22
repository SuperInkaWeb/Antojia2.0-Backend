import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'

// ── Sincronizar usuario de Auth0 con la BD ───────────────────
// Se llama en cada primer login o cuando el frontend necesita
// asegurarse de que el usuario existe en la BD
export async function syncUser({ auth0Id, email, name, avatarUrl }) {
  // Buscar si ya existe
  let user = await prisma.user.findUnique({
    where: { auth0Id },
    include: {
      consumerProfile: true,
      restaurant: { select: { id: true, name: true, status: true } },
      driverProfile: { select: { id: true, status: true, isVerified: true } },
    },
  })

  if (user) {
    // Actualizar datos que pueden cambiar en Auth0 (foto, nombre)
    user = await prisma.user.update({
      where: { auth0Id },
      data: {
        name:      name      || user.name,
        avatarUrl: avatarUrl || user.avatarUrl,
      },
      include: {
        consumerProfile: true,
        restaurant: { select: { id: true, name: true, status: true } },
        driverProfile: { select: { id: true, status: true, isVerified: true } },
      },
    })
    return { user, isNew: false }
  }

  // Crear usuario nuevo
  user = await prisma.user.create({
    data: {
      auth0Id,
      email,
      name: name || email.split('@')[0],
      avatarUrl,
      role: 'CONSUMER',
      // Crear perfil de consumidor automáticamente
      consumerProfile: {
        create: {
          favoriteCuisines: [],
        },
      },
    },
    include: {
      consumerProfile: true,
      restaurant: { select: { id: true, name: true, status: true } },
      driverProfile: { select: { id: true, status: true, isVerified: true } },
    },
  })

  return { user, isNew: true }
}

// ── Obtener perfil completo ───────────────────────────────────
export async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      consumerProfile: {
        include: {
          addresses: { orderBy: { isDefault: 'desc' } },
        },
      },
      restaurant: {
        select: {
          id: true, name: true, status: true, category: true, logoUrl: true,
          description: true, address: true, addressReference: true, district: true,
          latitude: true, longitude: true, phone: true,
          deliveryFee: true, estimatedTime: true,
          bankAccountNumberMasked: true,
        },
      },
      driverProfile: {
        select: {
          id: true, status: true, isVerified: true,
          vehicleType: true, licensePlate: true,
          dni: true, licenseNumber: true, dniPhotoUrl: true,
          licensePhotoUrl: true, vehiclePhotoUrl: true,
          rating: true, ratingCount: true,
          bankAccountNumberMasked: true,
        },
      },
    },
  })

  if (!user) throw new AppError('Usuario no encontrado', 404)
  return user
}

// ── Actualizar perfil ─────────────────────────────────────────
export async function updateProfile(userId, { name, phone }) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(name  && { name }),
      ...(phone && { phone }),
    },
    select: {
      id: true, name: true, email: true,
      phone: true, avatarUrl: true, role: true,
    },
  })
}

// ── Cambiar rol ───────────────────────────────────────────────
export async function changeRole(userId, role) {
  const validRoles = ['CONSUMER', 'RESTAURANT_OWNER', 'DELIVERY', 'ADMIN', 'MARKETING_ADMIN', 'TECH_ADMIN', 'FINANCE_ADMIN']
  if (!validRoles.includes(role)) {
    throw new AppError('Rol inválido', 400)
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError('Usuario no encontrado', 404)

  return prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, name: true, email: true, role: true },
  })
}
