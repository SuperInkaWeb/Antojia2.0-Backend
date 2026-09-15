import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'
import { randomInt } from 'node:crypto'
import axios from 'axios'

// ── Include reutilizable ──────────────────────────────────────
const ORDER_INCLUDE = {
  user:       { select: { id: true, name: true, email: true, phone: true, consumerProfile: { select: { totalOrders: true } } } },
  restaurant: { select: { id: true, name: true, address: true, addressReference: true, district: true, phone: true, latitude: true, longitude: true, ownerId: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, type: true, imageUrl: true } },
    },
  },
  savedAddress: true,
  driver: {
    include: {
      user: { select: { id: true, name: true, phone: true } },
    },
  },
  payment: {
    select: { id: true, status: true, method: true, amount: true, paidAt: true },
  },
  driverRating: {
    select: { score: true, comment: true, createdAt: true },
  },
}

// ── Transiciones permitidas por rol ──────────────────────────
const TRANSITIONS = {
  RESTAURANT_OWNER: {
    PENDING:   ['CONFIRMED', 'PREPARING', 'CANCELLED'],
    CONFIRMED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY'],
  },
  DELIVERY: {
    READY:      ['ON_THE_WAY'],
    ON_THE_WAY: ['DELIVERED'],
  },
  ADMIN: {
    PENDING:    ['CONFIRMED', 'CANCELLED'],
    CONFIRMED:  ['PREPARING', 'CANCELLED'],
    PREPARING:  ['READY'],
    READY:      ['ON_THE_WAY', 'DELIVERED'],
    ON_THE_WAY: ['DELIVERED'],
  },
}

// ── Calcular precio con descuento ─────────────────────────────
function calcFinalPrice(price, discountPct) {
  if (!discountPct) return price
  return parseFloat((price * (1 - discountPct / 100)).toFixed(2))
}

const RESTAURANT_ORDER_INCLUDE = {
  ...ORDER_INCLUDE,
  payment: { select: { ...ORDER_INCLUDE.payment.select, metadata: true } },
}

function generateDeliveryCode() {
  return String(randomInt(100000, 1000000))
}

function hideDeliveryCode(order) {
  if (!order) return order
  const { deliveryCode: _deliveryCode, ...safeOrder } = order
  return safeOrder
}

// ── Convertir coordenadas en dirección de entrega ─────────────
export async function reverseGeocode({ latitude, longitude }) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new AppError('Coordenadas inválidas', 400)
  }

  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { format: 'jsonv2', lat, lon: lng, addressdetails: 1 },
      timeout: 8000,
      headers: { 'User-Agent': 'FoodinkaDelivery/1.0' },
    })
    const location = data?.address || {}
    const address = [location.road, location.house_number].filter(Boolean).join(' ')
      || String(data?.display_name || '').split(',').slice(0, 2).join(',').trim()
    const district = location.city_district || location.suburb || location.neighbourhood || location.municipality || location.district || location.city || ''

    if (!address) throw new Error('Sin dirección disponible')
    return { address, district, rawAddress: data.display_name || '' }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('No se pudo obtener la dirección del punto seleccionado. Intenta nuevamente.', 502)
  }
}

// ── Crear pedido ──────────────────────────────────────────────
export async function create(userId, body) {
  const {
    restaurantId, type, items, notes,
    savedAddressId, deliveryAddress, deliveryDistrict, deliveryPhone, deliveryNotes,
    deliveryLatitude, deliveryLongitude,
    reservationDate, reservationTime, partySize,
  } = body

  if (!['DELIVERY', 'RESERVATION'].includes(type)) {
    throw new AppError('El tipo debe ser DELIVERY o RESERVATION', 400)
  }
  if (!items || items.length === 0) {
    throw new AppError('El pedido debe tener al menos un producto', 400)
  }

  // Validar campos por tipo
  if (type === 'DELIVERY' && !savedAddressId && !deliveryAddress) {
    throw new AppError('Se requiere una dirección de entrega', 400)
  }
  if (type === 'DELIVERY' && !savedAddressId && (deliveryLatitude == null || deliveryLongitude == null)) {
    throw new AppError('Se requiere marcar la ubicación exacta de entrega en el mapa', 400)
  }
  if (type === 'RESERVATION' && (!reservationDate || !reservationTime || !partySize)) {
    throw new AppError('Para reservas se requiere fecha, hora y número de personas', 400)
  }
  console.log('Buscando restaurante:', restaurantId)
  const test = await prisma.restaurant.findUnique({ where: { id: restaurantId } })
  console.log('Sin filtro status:', test?.id, test?.status)

  // Verificar restaurante
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId, status: 'ACTIVE' },
    select: {
      id: true, name: true,
      isDeliveryEnabled: true, isReservationEnabled: true,
      deliveryFee: true, minOrderAmount: true,
    },
  })
  if (!restaurant) throw new AppError('Restaurante no disponible', 404)

  if (type === 'DELIVERY'    && !restaurant.isDeliveryEnabled)    throw new AppError('Este restaurante no acepta delivery', 400)
  if (type === 'RESERVATION' && !restaurant.isReservationEnabled) throw new AppError('Este restaurante no acepta reservas', 400)

  // Resolver dirección guardada
  let addressData = {}
  if (savedAddressId) {
    const saved = await prisma.savedAddress.findUnique({
      where: { id: savedAddressId },
      include: { profile: { select: { userId: true } } },
    })
    if (!saved) throw new AppError('Dirección no encontrada', 404)
    if (saved.profile.userId !== userId) throw new AppError('Esta dirección no te pertenece', 403)
    addressData = {
      savedAddressId,
      deliveryAddress:  saved.address,
      deliveryDistrict: saved.district,
      deliveryLatitude: saved.latitude,
      deliveryLongitude: saved.longitude,
    }
  } else if (type === 'DELIVERY') {
    addressData = {
      deliveryAddress, deliveryDistrict, deliveryPhone, deliveryNotes,
      deliveryLatitude: deliveryLatitude == null ? null : Number(deliveryLatitude),
      deliveryLongitude: deliveryLongitude == null ? null : Number(deliveryLongitude),
    }
  }
  if (type === 'DELIVERY' && (addressData.deliveryLatitude == null || addressData.deliveryLongitude == null || !Number.isFinite(Number(addressData.deliveryLatitude)) || !Number.isFinite(Number(addressData.deliveryLongitude)))) {
    throw new AppError('La dirección de entrega no tiene una ubicación válida en el mapa', 400)
  }

  // Resolver productos
  const productIds = items.map(i => i.productId)
  const products   = await prisma.product.findMany({
    where: { id: { in: productIds }, restaurantId, isAvailable: true },
    select: { id: true, price: true, discountPct: true },
  })
  if (products.length !== productIds.length) {
    throw new AppError('Uno o más productos no están disponibles', 400)
  }

  const productMap = Object.fromEntries(products.map(p => [p.id, p]))
  let subtotal = 0
  const orderItems = items.map(item => {
    const product   = productMap[item.productId]
    const unitPrice = calcFinalPrice(product.price, product.discountPct)
    const itemTotal = unitPrice * item.quantity
    subtotal += itemTotal
    return { productId: item.productId, quantity: item.quantity, unitPrice, discount: product.discountPct, subtotal: itemTotal }
  })

  if (restaurant.minOrderAmount && subtotal < restaurant.minOrderAmount) {
    throw new AppError(`El pedido mínimo es S/ ${restaurant.minOrderAmount.toFixed(2)}`, 400, 'BELOW_MINIMUM')
  }

  const deliveryFee = type === 'DELIVERY' ? (restaurant.deliveryFee || 0) : 0
  const total       = subtotal + deliveryFee

  // Obtener perfil del consumidor
  const consumerProfile = await prisma.consumerProfile.findUnique({
    where: { userId }, select: { id: true },
  })

  // Crear pedido en transacción. La restricción @unique de deliveryCode es la
  // garantía final; si el azar genera una colisión se intenta otro código.
  const createOrder = deliveryCode => prisma.$transaction(async tx => {
    const newOrder = await tx.order.create({
      data: {
        type, status: 'PENDING', userId, restaurantId,
        subtotal, deliveryFee, total,
        notes: notes || null,
        ...(type === 'DELIVERY' && { deliveryCode }),
        ...(consumerProfile && { consumerProfileId: consumerProfile.id }),
        ...addressData,
        ...(type === 'RESERVATION' && {
          reservationDate: new Date(reservationDate),
          reservationTime,
          partySize: Number(partySize),
        }),
        items: { create: orderItems },
      },
      include: ORDER_INCLUDE,
    })

    // Actualizar estadísticas CRM del consumidor
    if (consumerProfile) {
      await tx.consumerProfile.update({
        where: { id: consumerProfile.id },
        data: {
          totalOrders: { increment: 1 },
          totalSpent:  { increment: total },
        },
      })
    }

    return newOrder
  })

  let order
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      order = await createOrder(type === 'DELIVERY' ? generateDeliveryCode() : undefined)
      break
    } catch (error) {
      if (type !== 'DELIVERY' || error.code !== 'P2002' || attempt === 4) throw error
    }
  }

  return order
}

// ── Mis pedidos (consumidor) con historial CRM ────────────────
export async function myOrders(userId, query) {
  const page   = parseInt(query.page)  || 1
  const limit  = parseInt(query.limit) || 10
  const skip   = (page - 1) * limit
  const { status, type } = query

  const where = {
    userId,
    ...(status && { status }),
    ...(type   && { type }),
  }

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip, take: limit,
    }),
    prisma.order.count({ where }),
  ])

  // Las métricas se calculan desde las entregas reales. Así no dependen de
  // que el cliente tenga (o no) un ConsumerProfile creado previamente.
  const deliveredSummary = await prisma.order.aggregate({
    where: { userId, status: 'DELIVERED' },
    _count: { _all: true },
    _sum: { total: true },
  })

  // Restaurantes más pedidos (CRM)
  const topRestaurants = await prisma.order.groupBy({
    by: ['restaurantId'],
    where: { userId, status: 'DELIVERED' },
    _count: { _all: true },
    orderBy: { _count: { restaurantId: 'desc' } },
    take: 3,
  })

  const topRestaurantIds = topRestaurants.map(r => r.restaurantId)
  const topRestaurantData = await prisma.restaurant.findMany({
    where: { id: { in: topRestaurantIds } },
    select: { id: true, name: true, category: true, logoUrl: true },
  })

  const visibleData = data.filter(order => order.payment?.status !== 'FAILED' && !(order.payment?.status === 'PENDING' && order.status === 'PENDING'))

  return {
    data: visibleData,
    pagination: { page, limit, total: visibleData.length, totalPages: Math.max(1, Math.ceil(visibleData.length / limit)) },
    crm: {
      totalOrders:     deliveredSummary._count._all,
      totalSpent:      deliveredSummary._sum.total || 0,
      topRestaurants:  topRestaurantData,
    },
  }
}

// ── Detalle de un pedido ──────────────────────────────────────
export async function getOne(id, userId, role) {
  const order = await prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
  if (!order) throw new AppError('Pedido no encontrado', 404)

  const isConsumer = order.userId === userId
  const isOwner    = order.restaurant?.ownerId === userId
  const isDriver   = order.driver?.userId === userId
  if (!isConsumer && !isOwner && !isDriver && role !== 'ADMIN') {
    throw new AppError('No tienes permisos para ver este pedido', 403)
  }
  return isConsumer ? order : hideDeliveryCode(order)
}

// ── Pedidos de un restaurante ─────────────────────────────────
export async function listByRestaurant(restaurantId, userId, role, query) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId }, select: { ownerId: true },
  })
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)
  if (restaurant.ownerId !== userId && role !== 'ADMIN') {
    throw new AppError('No tienes permisos sobre este restaurante', 403)
  }

  const page  = parseInt(query.page)  || 1
  const limit = parseInt(query.limit) || 20
  const skip  = (page - 1) * limit
  const { status, type } = query

  const where = { restaurantId, ...(status && { status }), ...(type && { type }) }

  const [data, total] = await Promise.all([
    prisma.order.findMany({ where, include: RESTAURANT_ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.order.count({ where }),
  ])

  const restaurantOrders = data
    // Oculta intentos antiguos abandonados: pago pendiente y pedido nunca
    // confirmado. Los pedidos que sí avanzaron se conservan como ventas.
    .filter(order => !(order.payment?.status === 'PENDING' && order.status === 'PENDING'))
    .map(order => {
    if (!order.payment) return hideDeliveryCode(order)
    const { metadata, ...payment } = order.payment
    return hideDeliveryCode({ ...order, payment: { ...payment, isTest: metadata?.mode === 'TEST' } })
    })

  return { data: restaurantOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
}

// ── Actualizar estado ─────────────────────────────────────────
export async function updateStatus(id, userId, role, newStatus, deliveryEvidence = {}) {
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      status: true, type: true,
      restaurant: { select: { ownerId: true } },
      driver: { select: { userId: true } },
      deliveryCode: true,
    },
  })
  if (!order) throw new AppError('Pedido no encontrado', 404)

  if (role === 'RESTAURANT_OWNER' && order.restaurant.ownerId !== userId) {
    throw new AppError('No tienes permisos sobre este pedido', 403)
  }
  if (role === 'DELIVERY' && order.driver?.userId !== userId) {
    throw new AppError('Este pedido no te fue asignado', 403)
  }

  const allowed = TRANSITIONS[role]?.[order.status] || []
  if (!allowed.includes(newStatus)) {
    throw new AppError(`No se puede cambiar de ${order.status} a ${newStatus}`, 400, 'INVALID_TRANSITION')
  }

  if (role === 'DELIVERY' && newStatus === 'DELIVERED') {
    const suppliedCode = String(deliveryEvidence.deliveryCode || '').trim()
    const proofUrl = String(deliveryEvidence.deliveryProofUrl || '').trim()
    if (!/^\d{6}$/.test(suppliedCode) || suppliedCode !== order.deliveryCode) {
      throw new AppError('El código de entrega es incorrecto', 400, 'INVALID_DELIVERY_CODE')
    }
    if (!/^https:\/\//i.test(proofUrl)) {
      throw new AppError('Debes adjuntar una foto válida de la entrega', 400, 'DELIVERY_PROOF_REQUIRED')
    }
  }
  // Al entregar, actualizar métricas del repartidor
  const updated = await prisma.$transaction(async tx => {
    const updatedOrder = await tx.order.update({
      where: { id },
      data: {
        status: newStatus,
        ...(newStatus === 'ON_THE_WAY' && { pickedUpAt: new Date() }),
        ...(newStatus === 'DELIVERED' && {
          deliveredAt: new Date(),
          ...(deliveryEvidence.deliveryProofUrl && {
            deliveryProofUrl: String(deliveryEvidence.deliveryProofUrl).trim(),
            deliveryProofAt: new Date(),
          }),
        }),
      },
      include: ORDER_INCLUDE,
    })

    if (newStatus === 'DELIVERED' && updatedOrder.driverId) {
      const earn = updatedOrder.total * 0.1 // 10% para el repartidor
      await tx.deliveryDriver.update({
        where: { id: updatedOrder.driverId },
        data: {
          totalDeliveries: { increment: 1 },
          totalEarnings:   { increment: earn },
          status: 'AVAILABLE',
        },
      })
      await tx.driverEarning.create({
        data: { driverId: updatedOrder.driverId, orderId: id, amount: earn },
      })
    }

    return updatedOrder
  })

  return hideDeliveryCode(updated)
}

// ── Cancelar pedido ───────────────────────────────────────────
export async function cancel(id, userId) {
  const order = await prisma.order.findUnique({
    where: { id }, select: { userId: true, status: true, total: true, consumerProfileId: true },
  })
  if (!order) throw new AppError('Pedido no encontrado', 404)
  if (order.userId !== userId) throw new AppError('No tienes permisos', 403)
  if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
    throw new AppError(`No se puede cancelar un pedido en estado ${order.status}`, 400)
  }

  return prisma.$transaction(async tx => {
    const cancelled = await tx.order.update({
      where: { id }, data: { status: 'CANCELLED' }, include: ORDER_INCLUDE,
    })
    // Revertir estadísticas CRM
    if (order.consumerProfileId) {
      await tx.consumerProfile.update({
        where: { id: order.consumerProfileId },
        data: {
          totalOrders: { decrement: 1 },
          totalSpent:  { decrement: order.total },
        },
      })
    }
    return cancelled
  })
}

// ── Asignar repartidor ────────────────────────────────────────
export async function assignDriver(orderId, userId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { type: true, status: true, driverId: true, deliveryCode: true },
  })
  if (!order)                   throw new AppError('Pedido no encontrado', 404)
  if (order.type !== 'DELIVERY') throw new AppError('Solo se asigna repartidor en pedidos de delivery', 400)
  if (order.status !== 'READY')  throw new AppError('El pedido debe estar en estado READY', 400)
  if (order.driverId)            throw new AppError('Este pedido ya tiene repartidor asignado', 409)

  const driver = await prisma.deliveryDriver.findUnique({
    where: { userId }, select: { id: true, status: true, isVerified: true },
  })
  if (!driver)             throw new AppError('Perfil de repartidor no encontrado', 404)
  if (!driver.isVerified)  throw new AppError('Tu perfil aún no está verificado', 403)
  if (driver.status !== 'AVAILABLE') throw new AppError('No estás disponible para tomar pedidos', 400)

  return prisma.$transaction(async tx => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, type: 'DELIVERY', status: 'READY', driverId: null },
      data: {
        driverId: driver.id,
        driverAssignedAt: new Date(),
        ...(!order.deliveryCode && { deliveryCode: generateDeliveryCode() }),
      },
    })
    if (claimed.count !== 1) {
      throw new AppError('Este pedido acaba de ser tomado por otro repartidor', 409)
    }
    await tx.deliveryDriver.update({ where: { id: driver.id }, data: { status: 'ON_DELIVERY' } })
    const assignedOrder = await tx.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
    return hideDeliveryCode(assignedOrder)
  })
}

// ── Calificar repartidor ──────────────────────────────────────
export async function rateDriver(orderId, userId, { score, comment }) {
  const numericScore = Number(score)
  if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 5) {
    throw new AppError('La calificación debe ser un número entero entre 1 y 5', 400)
  }

  const cleanComment = String(comment || '').trim()
  if (cleanComment.length > 500) {
    throw new AppError('El comentario no puede superar los 500 caracteres', 400)
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, type: true, status: true, driverId: true, driverRating: { select: { id: true } } },
  })
  if (!order) throw new AppError('Pedido no encontrado', 404)
  if (order.userId !== userId) throw new AppError('No tienes permisos para calificar este pedido', 403)
  if (order.type !== 'DELIVERY' || order.status !== 'DELIVERED' || !order.driverId) {
    throw new AppError('Solo puedes calificar un delivery que ya fue entregado', 400)
  }
  if (order.driverRating) throw new AppError('Este repartidor ya fue calificado para este pedido', 409)

  return prisma.$transaction(async tx => {
    const rating = await tx.driverRating.create({
      data: { orderId, driverId: order.driverId, consumerId: userId, score: numericScore, comment: cleanComment || null },
    })
    const summary = await tx.driverRating.aggregate({
      where: { driverId: order.driverId },
      _avg: { score: true },
      _count: { _all: true },
    })
    await tx.deliveryDriver.update({
      where: { id: order.driverId },
      data: { rating: summary._avg.score || 0, ratingCount: summary._count._all },
    })
    return rating
  })
}
