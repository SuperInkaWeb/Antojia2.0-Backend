import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'
import { encryptSensitiveData, maskAccount } from '../../shared/utils/sensitiveData.js'

// ── Helpers ───────────────────────────────────────────────────

// Campos que se devuelven en el listado
const RESTAURANT_SELECT = {
  id: true,
  name: true,
  description: true,
  category: true,
  logoUrl: true,
  bannerUrl: true,
  address: true,
  addressReference: true,
  district: true,
  latitude: true,
  longitude: true,
  phone: true,
  openingHours: true,
  status: true,
  isDeliveryEnabled: true,
  isReservationEnabled: true,
  deliveryFee: true,
  minOrderAmount: true,
  estimatedTime: true,
  createdAt: true,
  _count: {
    select: { orders: true, products: true },
  },
}

// Construir filtros dinámicos para el listado
function buildFilters({ search, category, district, delivery, reservation }) {
  return {
    status: 'ACTIVE',
    ...(search && {
      OR: [
        { name:        { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { district:    { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(category     && { category }),
    ...(district     && { district: { contains: district, mode: 'insensitive' } }),
    ...(delivery     === 'true' && { isDeliveryEnabled: true }),
    ...(reservation  === 'true' && { isReservationEnabled: true }),
  }
}

// ── Listar restaurantes ───────────────────────────────────────
export async function list(query) {
  const page  = parseInt(query.page)  || 1
  const limit = parseInt(query.limit) || 12
  const skip  = (page - 1) * limit

  const where = buildFilters(query)

  const [data, total] = await Promise.all([
    prisma.restaurant.findMany({
      where,
      select: RESTAURANT_SELECT,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.restaurant.count({ where }),
  ])

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
}

// ── Detalle de un restaurante + su menú ──────────────────────
export async function getOne(id) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id },
    select: {
      ...RESTAURANT_SELECT,
      ruc: true,
      owner: { select: { id: true, name: true, email: true } },
      categories: {
        orderBy: { order: 'asc' },
        include: {
          products: {
            where: { isAvailable: true },
            orderBy: { name: 'asc' },
          },
        },
      },
      // Recupera productos antiguos creados antes de exigir una categoría.
      products: {
        where: { categoryId: null, isAvailable: true },
        orderBy: { name: 'asc' },
      },
      // El select explícito evita exponer campos internos del restaurante.
    },
  })

  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)

  const { products: uncategorizedProducts, categories, ...restaurantData } = restaurant
  return {
    ...restaurantData,
    categories: uncategorizedProducts.length > 0
      ? [{ id: 'uncategorized', name: 'Menú', products: uncategorizedProducts }, ...categories]
      : categories,
  }
}

export async function getWallet(restaurantId, userId) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, ownerId: true, payouts: { orderBy: { createdAt: 'desc' } }, withdrawals: { orderBy: { createdAt: 'desc' } } },
  })
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)
  if (restaurant.ownerId !== userId) throw new AppError('Sin permisos', 403)

  const [settings, paidPayments] = await Promise.all([
    prisma.platformSettings.findUnique({ where: { id: 'main' }, select: { commissionPercent: true } }),
    prisma.payment.findMany({
      where: { status: { in: ['PAID', 'PENDING'] }, method: 'MERCADOPAGO', order: { restaurantId, status: { not: 'CANCELLED' } } },
      select: { amount: true, status: true, metadata: true, order: { select: { status: true, subtotal: true, discountAmount: true } } },
    }),
  ])
  const commissionPercent = settings?.commissionPercent ?? 20
  const productionPayments = paidPayments.filter(payment => payment.status === 'PAID' && payment.metadata?.mode !== 'TEST')
  // Los pagos sandbox antiguos pueden quedar PENDING aunque el pedido de prueba
  // sí haya avanzado; se muestran como simulación, nunca como saldo retirable.
  const testPayments = paidPayments.filter(payment => payment.metadata?.mode === 'TEST' && (payment.status === 'PAID' || payment.order.status !== 'PENDING'))
  const saleAmount = payment => Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
  const salesTotal = productionPayments.reduce((sum, payment) => sum + saleAmount(payment), 0)
  const testSalesTotal = testPayments.reduce((sum, payment) => sum + saleAmount(payment), 0)
  const recordedSalesTotal = salesTotal + testSalesTotal
  const creditedGross = restaurant.payouts.reduce((sum, payout) => sum + Number(payout.grossAmount), 0)
  const pendingSales = Math.max(0, salesTotal - creditedGross)
  const credited = restaurant.payouts.reduce((sum, payout) => sum + Number(payout.netAmount), 0)
  const pastCommission = restaurant.payouts.reduce((sum, payout) => sum + Number(payout.commissionAmount), 0)
  const restaurantEarnedTotal = credited + pendingSales * (100 - commissionPercent) / 100
  const reserved = restaurant.withdrawals.filter(item => !item.isTest && ['PENDING', 'PROCESSING', 'PAID'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0)
  const testReserved = restaurant.withdrawals.filter(item => item.isTest && ['PENDING', 'PROCESSING', 'PAID'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0)
  return {
    balance: Number(Math.max(0, credited - reserved).toFixed(2)),
    commissionPercent,
    salesTotal: Number(salesTotal.toFixed(2)),
    recordedSalesTotal: Number(recordedSalesTotal.toFixed(2)),
    recordedRestaurantNet: Number((recordedSalesTotal * (100 - commissionPercent) / 100).toFixed(2)),
    paidOrderCount: productionPayments.length,
    pendingSales: Number(pendingSales.toFixed(2)),
    adminCommissionTotal: Number((pastCommission + pendingSales * commissionPercent / 100).toFixed(2)),
    restaurantEarnedTotal: Number(restaurantEarnedTotal.toFixed(2)),
    pendingRestaurantNet: Number(Math.max(0, restaurantEarnedTotal - credited).toFixed(2)),
    testSalesTotal: Number(testSalesTotal.toFixed(2)),
    testOrderCount: testPayments.length,
    testAdminCommission: Number((testSalesTotal * commissionPercent / 100).toFixed(2)),
    testRestaurantNet: Number((testSalesTotal * (100 - commissionPercent) / 100).toFixed(2)),
    testBalance: Number(Math.max(0, testSalesTotal * (100 - commissionPercent) / 100 - testReserved).toFixed(2)),
    payouts: restaurant.payouts,
    withdrawals: restaurant.withdrawals.map(({ bankDetailsEncrypted, ...item }) => item),
  }
}

export async function requestWithdrawal(restaurantId, userId, body) {
  const amount = Number(body.amount)
  const bankName = String(body.bankName || '').trim()
  const accountHolder = String(body.accountHolder || '').trim()
  const accountNumber = String(body.accountNumber || '').replace(/\s/g, '')
  const cci = String(body.cci || '').replace(/\s/g, '')
  const accountType = String(body.accountType || 'CUENTA').trim()
  const isTest = body.isTest === true
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Ingresa un monto de retiro válido', 400)
  if (!bankName || !accountHolder || (!accountNumber && !cci)) throw new AppError('Completa banco, titular y número de cuenta o CCI', 400)
  if ((accountNumber && !/^\d{8,20}$/.test(accountNumber)) || (cci && !/^\d{20}$/.test(cci))) {
    throw new AppError('Verifica el número de cuenta (8 a 20 dígitos) y CCI (20 dígitos)', 400)
  }
  const sensitive = encryptSensitiveData({ accountNumber, cci, accountType, accountHolder })
  const destination = cci || accountNumber

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "restaurants" WHERE "id" = ${restaurantId} FOR UPDATE`
    const restaurant = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, ownerId: true } })
    if (!restaurant) throw new AppError('Restaurante no encontrado', 404)
    if (restaurant.ownerId !== userId) throw new AppError('Sin permisos', 403)
    const [credits, withdrawals] = await Promise.all([
      tx.restaurantPayout.aggregate({ where: { restaurantId }, _sum: { netAmount: true } }),
      tx.restaurantWithdrawal.aggregate({ where: { restaurantId, isTest: false, status: { in: ['PENDING', 'PROCESSING', 'PAID'] } }, _sum: { amount: true } }),
    ])
    const balance = Number(credits._sum.netAmount || 0) - Number(withdrawals._sum.amount || 0)
    if (!isTest && amount > balance + 0.001) throw new AppError('El monto supera tu saldo disponible', 400)
    return tx.restaurantWithdrawal.create({
      data: {
        restaurantId, amount: Number(amount.toFixed(2)), isTest, bankName, accountHolder,
        destinationAccountMasked: maskAccount(destination), bankDetailsEncrypted: sensitive,
      },
      select: { id: true, amount: true, status: true, bankName: true, accountHolder: true, destinationAccountMasked: true, createdAt: true },
    })
  })
}

async function requireRestaurantAccess(restaurantId, userId, role) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, ownerId: true },
  })
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)
  if (restaurant.ownerId !== userId && role !== 'ADMIN') {
    throw new AppError('No tienes permisos sobre este restaurante', 403)
  }
  return restaurant
}

// ── Clientes y consumo exclusivo del restaurante ──────────────
export async function listCustomers(restaurantId, userId, role, { search = '', sort = 'highest' }) {
  await requireRestaurantAccess(restaurantId, userId, role)

  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      status: { not: 'CANCELLED' },
      ...(search.trim() && {
        user: {
          OR: [
            { name: { contains: search.trim(), mode: 'insensitive' } },
            { email: { contains: search.trim(), mode: 'insensitive' } },
          ],
        },
      }),
    },
    select: {
      total: true, type: true, createdAt: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  })

  const clients = new Map()
  for (const order of orders) {
    const current = clients.get(order.user.id) || {
      ...order.user, totalSpent: 0, totalOrders: 0,
      deliveryOrders: 0, reservationOrders: 0, lastOrderAt: order.createdAt,
    }
    current.totalSpent += order.total
    current.totalOrders += 1
    if (order.type === 'DELIVERY') current.deliveryOrders += 1
    else current.reservationOrders += 1
    if (order.createdAt > current.lastOrderAt) current.lastOrderAt = order.createdAt
    clients.set(order.user.id, current)
  }

  const data = [...clients.values()].map(client => ({
    ...client,
    totalSpent: Number(client.totalSpent.toFixed(2)),
    averageTicket: Number((client.totalSpent / client.totalOrders).toFixed(2)),
  }))
  data.sort((a, b) => sort === 'lowest'
    ? a.totalSpent - b.totalSpent
    : sort === 'name'
      ? a.name.localeCompare(b.name, 'es')
      : b.totalSpent - a.totalSpent)

  return { data, total: data.length }
}

export async function getCustomer(restaurantId, customerId, userId, role) {
  await requireRestaurantAccess(restaurantId, userId, role)

  const orders = await prisma.order.findMany({
    where: { restaurantId, userId: customerId, status: { not: 'CANCELLED' } },
    select: {
      id: true, orderNumber: true, type: true, total: true, status: true, createdAt: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      items: { select: { quantity: true, product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!orders.length) throw new AppError('Cliente no encontrado en este restaurante', 404)

  const stats = orders.reduce((result, order) => {
    result.totalSpent += order.total
    result.totalOrders += 1
    if (order.type === 'DELIVERY') {
      result.delivery.orders += 1
      result.delivery.totalSpent += order.total
    } else {
      result.reservation.orders += 1
      result.reservation.totalSpent += order.total
    }
    return result
  }, { totalSpent: 0, totalOrders: 0, delivery: { orders: 0, totalSpent: 0 }, reservation: { orders: 0, totalSpent: 0 } })

  stats.totalSpent = Number(stats.totalSpent.toFixed(2))
  stats.averageTicket = Number((stats.totalSpent / stats.totalOrders).toFixed(2))
  stats.delivery.totalSpent = Number(stats.delivery.totalSpent.toFixed(2))
  stats.reservation.totalSpent = Number(stats.reservation.totalSpent.toFixed(2))

  return { customer: orders[0].user, stats, orders }
}

// ── Crear restaurante ─────────────────────────────────────────
export async function create(ownerId, body) {
  // Verificar que el dueño no tenga ya un restaurante
  const existing = await prisma.restaurant.findUnique({ where: { ownerId } })
  if (existing) {
    throw new AppError('Ya tienes un restaurante registrado', 409, 'RESTAURANT_EXISTS')
  }

  // Verificar que el RUC no esté en uso
  const rucUsed = await prisma.restaurant.findUnique({ where: { ruc: body.ruc } })
  if (rucUsed) {
    throw new AppError('Este RUC ya está registrado', 409, 'RUC_TAKEN')
  }

  const { accountNumber, ...restaurantBody } = body
  const restaurant = await prisma.restaurant.create({
    data: {
      ...restaurantBody,
      bankAccountNumberEncrypted: encryptSensitiveData({ accountNumber }),
      bankAccountNumberMasked: maskAccount(accountNumber),
      ownerId,
      status: 'PENDING_VERIFICATION',
    },
  })

  const { bankAccountNumberEncrypted: _encrypted, ...safeRestaurant } = restaurant
  return safeRestaurant
}

// ── Actualizar restaurante ────────────────────────────────────
export async function update(id, ownerId, role, body) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id },
    select: { ownerId: true },
  })

  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)

  // Solo el dueño o un admin pueden editar
  if (restaurant.ownerId !== ownerId && role !== 'ADMIN') {
    throw new AppError('No tienes permisos para editar este restaurante', 403)
  }

  // No permitir cambiar el RUC
  const { ruc, accountNumber, ...safeBody } = body
  if (safeBody.isDeliveryEnabled === false && safeBody.isReservationEnabled === false) {
    throw new AppError('El restaurante debe mantener activo delivery o reservas', 400)
  }
  if (accountNumber !== undefined) {
    const cleanAccountNumber = String(accountNumber || '').replace(/\s/g, '')
    if (!/^\d{8,20}$/.test(cleanAccountNumber)) {
      throw new AppError('El número de cuenta debe tener entre 8 y 20 dígitos', 400)
    }
    safeBody.bankAccountNumberEncrypted = encryptSensitiveData({ accountNumber: cleanAccountNumber })
    safeBody.bankAccountNumberMasked = maskAccount(cleanAccountNumber)
  }
  if (safeBody.latitude !== undefined || safeBody.longitude !== undefined) {
    const lat = Number(safeBody.latitude)
    const lng = Number(safeBody.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new AppError('La ubicación del restaurante no es válida', 400)
    }
    safeBody.latitude = lat
    safeBody.longitude = lng
  }

  return prisma.restaurant.update({
    where: { id },
    data: safeBody,
  })
}

// ── Verificar restaurante (admin) ─────────────────────────────
export async function verify(id) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id } })
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)

  if (restaurant.status === 'ACTIVE') {
    throw new AppError('El restaurante ya está activo', 400)
  }

  return prisma.restaurant.update({
    where: { id },
    data: { status: 'ACTIVE' },
  })
}

// ── Suspender restaurante (admin) ─────────────────────────────
export async function suspend(id) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id } })
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)

  return prisma.restaurant.update({
    where: { id },
    data: { status: 'SUSPENDED' },
  })
}

// ── Categorías del menú ───────────────────────────────────────
export async function listCategories(restaurantId) {
  return prisma.productCategory.findMany({
    where: { restaurantId },
    orderBy: { order: 'asc' },
    include: {
      _count: { select: { products: true } },
    },
  })
}

export async function createCategory(restaurantId, ownerId, role, { name, order }) {
  // Verificar que el restaurante pertenece al dueño
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { ownerId: true },
  })

  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)

  if (restaurant.ownerId !== ownerId && role !== 'ADMIN') {
    throw new AppError('No tienes permisos sobre este restaurante', 403)
  }

  return prisma.productCategory.create({
    data: { name, order: order || 0, restaurantId },
  })
}

export async function deleteCategory(restaurantId, categoryId, ownerId, role) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { ownerId: true },
  })

  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)

  if (restaurant.ownerId !== ownerId && role !== 'ADMIN') {
    throw new AppError('No tienes permisos sobre este restaurante', 403)
  }

  // Los productos de la categoría quedan sin categoría (SetNull en schema)
  await prisma.productCategory.delete({ where: { id: categoryId } })
}
