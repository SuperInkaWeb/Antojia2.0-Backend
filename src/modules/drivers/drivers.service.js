import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'
import { encryptSensitiveData, maskAccount } from '../../shared/utils/sensitiveData.js'

// ── Registrarse como repartidor ───────────────────────────────
export async function register(userId, body) {
  const { vehicleType, licensePlate, dni, licenseNumber, licensePhotoUrl, dniPhotoUrl, vehiclePhotoUrl } = body
  const accountNumber = String(body.accountNumber || '').replace(/\s/g, '')

  // Verificar que no tenga ya un perfil
  const existing = await prisma.deliveryDriver.findUnique({ where: { userId } })
  if (existing) throw new AppError('Ya tienes un perfil de repartidor', 409)

  // El carné de conducir solo es obligatorio para vehículos motorizados
  const requiresLicense = ['MOTORCYCLE', 'CAR'].includes(vehicleType || 'MOTORCYCLE')

  if (requiresLicense && !licenseNumber)   throw new AppError('El número de carné de conducir es requerido', 400)
  if (requiresLicense && !licensePhotoUrl) throw new AppError('La foto del carné de conducir es requerida', 400)
  if (!dni) throw new AppError('El DNI es requerido', 400)
  if (!/^\d{8,20}$/.test(accountNumber)) throw new AppError('El número de cuenta es requerido y debe tener entre 8 y 20 dígitos', 400)

  // Cambiar rol del usuario
  await prisma.user.update({
    where: { id: userId },
    data:  { role: 'DELIVERY' },
  })

  return prisma.deliveryDriver.create({
    data: {
      userId,
      vehicleType:     vehicleType     || 'MOTORCYCLE',
      licensePlate:    licensePlate    || null,
      dni,
      licenseNumber:   licenseNumber   || null,
      licensePhotoUrl: licensePhotoUrl || null,
      dniPhotoUrl:     dniPhotoUrl     || null,
      vehiclePhotoUrl: vehiclePhotoUrl || null,
      bankAccountNumberEncrypted: encryptSensitiveData({ accountNumber }),
      bankAccountNumberMasked: maskAccount(accountNumber),
      status:          'OFFLINE',
      isVerified:      false,
    },
  })
}

// ── Bolsa global de pedidos disponibles ───────────────────────
// Todo repartidor ve los pedidos listos que aún no fueron tomados. La
// asignación se protege de forma atómica en orders.service.assignDriver.
export async function availableOrders() {
  const orders = await prisma.order.findMany({
    where: {
      type:     'DELIVERY',
      status:   'READY',          // listos para recoger
      driverId: null,             // sin repartidor asignado
      restaurant: {
        status:   'ACTIVE',
      },
    },
    include: {
      restaurant: { select: { id: true, name: true, address: true, addressReference: true, district: true, phone: true, latitude: true, longitude: true } },
      user:       { select: { name: true, phone: true } },
      items:      { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return orders.map(({ deliveryCode: _deliveryCode, ...order }) => order)
}

export async function activeOrders(userId) {
  const driver = await prisma.deliveryDriver.findUnique({ where: { userId }, select: { id: true } })
  if (!driver) throw new AppError('Perfil de repartidor no encontrado', 404)

  const orders = await prisma.order.findMany({
    where: { driverId: driver.id, type: 'DELIVERY', status: { in: ['READY', 'ON_THE_WAY'] } },
    include: {
      restaurant: { select: { id: true, name: true, address: true, addressReference: true, district: true, phone: true, latitude: true, longitude: true } },
      user: { select: { id: true, name: true, phone: true } },
      savedAddress: true,
      items: { include: { product: { select: { name: true } } } },
    },
    orderBy: { driverAssignedAt: 'asc' },
  })
  return orders.map(({ deliveryCode: _deliveryCode, ...order }) => order)
}

// ── Actualizar ubicación ──────────────────────────────────────
export async function updateLocation(userId, { latitude, longitude }) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new AppError('Coordenadas inválidas', 400)
  }
  const driver = await prisma.deliveryDriver.findUnique({ where: { userId } })
  if (!driver) throw new AppError('Perfil de repartidor no encontrado', 404)

  return prisma.deliveryDriver.update({
    where: { userId },
    data:  { currentLatitude: lat, currentLongitude: lng, lastLocationAt: new Date() },
  })
}

// ── Cambiar estado (OFFLINE / AVAILABLE) ──────────────────────
export async function updateStatus(userId, status) {
  const driver = await prisma.deliveryDriver.findUnique({ where: { userId } })
  if (!driver) throw new AppError('Perfil de repartidor no encontrado', 404)
  if (!driver.isVerified) throw new AppError('Tu perfil aún no ha sido verificado por el administrador', 403)

  const valid = ['OFFLINE', 'AVAILABLE']
  if (!valid.includes(status)) throw new AppError('Estado inválido', 400)

  return prisma.deliveryDriver.update({ where: { userId }, data: { status } })
}

// ── Actualizar vehículo ──────────────────────────────────────
export async function updateVehicle(userId, { vehicleType, licensePlate, accountNumber, dniPhotoUrl, licensePhotoUrl, vehiclePhotoUrl }) {
  const driver = await prisma.deliveryDriver.findUnique({ where: { userId } })
  if (!driver) throw new AppError('Perfil de repartidor no encontrado', 404)
 
  const valid = ['MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT']
  if (vehicleType && !valid.includes(vehicleType)) {
    throw new AppError('Tipo de vehículo inválido', 400)
  }
  let bankData = {}
  if (accountNumber !== undefined) {
    const cleanAccountNumber = String(accountNumber || '').replace(/\s/g, '')
    if (!/^\d{8,20}$/.test(cleanAccountNumber)) throw new AppError('El número de cuenta debe tener entre 8 y 20 dígitos', 400)
    bankData = {
      bankAccountNumberEncrypted: encryptSensitiveData({ accountNumber: cleanAccountNumber }),
      bankAccountNumberMasked: maskAccount(cleanAccountNumber),
    }
  }
 
  return prisma.deliveryDriver.update({
    where: { userId },
    data: {
      ...(vehicleType  !== undefined && { vehicleType }),
      ...(licensePlate !== undefined && { licensePlate: licensePlate || null }),
      ...(dniPhotoUrl !== undefined && { dniPhotoUrl: dniPhotoUrl || null }),
      ...(licensePhotoUrl !== undefined && { licensePhotoUrl: licensePhotoUrl || null }),
      ...(vehiclePhotoUrl !== undefined && { vehiclePhotoUrl: vehiclePhotoUrl || null }),
      ...bankData,
    },
  })
}
