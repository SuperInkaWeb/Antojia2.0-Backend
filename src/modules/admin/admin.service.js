import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'
import { decryptSensitiveData } from '../../shared/utils/sensitiveData.js'
import { createHash, randomBytes } from 'node:crypto'

function paginate(query) {
  const page  = parseInt(query.page)  || 1
  const limit = parseInt(query.limit) || 20
  const skip  = (page - 1) * limit
  return { page, limit, skip }
}

function paginationMeta(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) }
}

// ── Métricas ──────────────────────────────────────────────────
export async function getMetrics() {
  const now = new Date()
  const limaNow = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  const startOfMonth = new Date(Date.UTC(limaNow.getUTCFullYear(), limaNow.getUTCMonth(), 1) + 5 * 60 * 60 * 1000)
  const startOfLast = new Date(Date.UTC(limaNow.getUTCFullYear(), limaNow.getUTCMonth() - 1, 1) + 5 * 60 * 60 * 1000)
  const endOfLast = new Date(startOfMonth.getTime() - 1)

  const [
    totalUsers, totalRestaurants, activeRestaurants, pendingRestaurants,
    totalOrders, ordersThisMonth, ordersLastMonth,
    topRestaurants, ordersByStatus, ordersByType,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.restaurant.count(),
    prisma.restaurant.count({ where: { status: 'ACTIVE' } }),
    prisma.restaurant.count({ where: { status: 'PENDING_VERIFICATION' } }),
    prisma.order.count({ where: { status: { not: 'CANCELLED' } } }),
    prisma.order.count({ where: { createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' } } }),
    prisma.order.count({ where: { createdAt: { gte: startOfLast, lte: endOfLast }, status: { not: 'CANCELLED' } } }),
    prisma.restaurant.findMany({
      select: {
        id: true, name: true, category: true, logoUrl: true, status: true,
        _count: { select: { orders: { where: { status: { not: 'CANCELLED' } } } } },
      },
      orderBy: { orders: { _count: 'desc' } },
      take: 5,
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.groupBy({ by: ['type'],   _count: { _all: true } }),
  ])

  const [settings, paidPayments] = await Promise.all([
    getPlatformSettings(),
    prisma.payment.findMany({
      where: { status: { in: ['PAID', 'PENDING'] }, method: 'MERCADOPAGO', order: { status: { not: 'CANCELLED' } } },
      select: { amount: true, status: true, paidAt: true, createdAt: true, metadata: true, order: { select: { status: true, subtotal: true, discountAmount: true } } },
    }),
  ])
  const productionPayments = paidPayments.filter(payment => payment.status === 'PAID' && payment.metadata?.mode !== 'TEST')
  const testPayments = paidPayments.filter(payment => payment.metadata?.mode === 'TEST' && (payment.status === 'PAID' || payment.order.status !== 'PENDING'))
  const recordedPayments = [...productionPayments, ...testPayments]
  const byPaidDate = (payment) => payment.paidAt || payment.createdAt
  const grossSales = payment => restaurantSales(payment)
  // Las ventas sandbox también se muestran como ingreso simulado para que
  // las compras hechas durante las pruebas no desaparezcan del dashboard.
  const revThisMonth = recordedPayments.filter(payment => byPaidDate(payment) >= startOfMonth)
    .reduce((sum, payment) => sum + grossSales(payment) * settings.commissionPercent / 100, 0)
  const revLastMonth = recordedPayments.filter(payment => byPaidDate(payment) >= startOfLast && byPaidDate(payment) <= endOfLast)
    .reduce((sum, payment) => sum + grossSales(payment) * settings.commissionPercent / 100, 0)
  const testSalesThisMonth = testPayments.filter(payment => byPaidDate(payment) >= startOfMonth)
    .reduce((sum, payment) => sum + grossSales(payment), 0)
  const testAdminCommissionThisMonth = testSalesThisMonth * settings.commissionPercent / 100
  const avgTicket = productionPayments.length
    ? productionPayments.reduce((sum, payment) => sum + Number(payment.amount), 0) / productionPayments.length
    : 0
  const revenueGrowth = revLastMonth > 0
    ? parseFloat((((revThisMonth - revLastMonth) / revLastMonth) * 100).toFixed(1)) : null
  const orderGrowth = ordersLastMonth > 0
    ? parseFloat((((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100).toFixed(1)) : null

  return {
    users:       { total: totalUsers },
    restaurants: { total: totalRestaurants, active: activeRestaurants, pending: pendingRestaurants },
    orders: {
      total: totalOrders, thisMonth: ordersThisMonth, growth: orderGrowth,
      byStatus: Object.fromEntries(ordersByStatus.map(s => [s.status, s._count._all])),
      byType:   Object.fromEntries(ordersByType.map(t => [t.type,   t._count._all])),
    },
    revenue: {
      thisMonth: parseFloat(revThisMonth.toFixed(2)),
      lastMonth: parseFloat(revLastMonth.toFixed(2)),
      growth:    revenueGrowth,
      avgTicket: parseFloat(avgTicket.toFixed(2)),
      commissionPercent: settings.commissionPercent,
      paidPayments: productionPayments.filter(payment => byPaidDate(payment) >= startOfMonth).length,
      recordedSalesThisMonth: Number(recordedPayments.filter(payment => byPaidDate(payment) >= startOfMonth).reduce((sum, payment) => sum + grossSales(payment), 0).toFixed(2)),
      testSalesThisMonth: Number(testSalesThisMonth.toFixed(2)),
      testAdminCommissionThisMonth: Number(testAdminCommissionThisMonth.toFixed(2)),
      testPaymentsThisMonth: testPayments.filter(payment => byPaidDate(payment) >= startOfMonth).length,
    },
    topRestaurants: topRestaurants.map(r => ({ ...r, totalOrders: r._count.orders })),
  }
}

export async function getRevenueChart() {
  const settings = await getPlatformSettings()
  const from = new Date()
  from.setMonth(from.getMonth() - 5, 1)
  from.setHours(0, 0, 0, 0)
  const payments = await prisma.payment.findMany({
    where: { status: 'PAID', method: 'MERCADOPAGO', paidAt: { gte: from }, order: { status: { not: 'CANCELLED' } } },
    select: { amount: true, paidAt: true, createdAt: true, metadata: true, order: { select: { subtotal: true, discountAmount: true } } },
  })
  const totals = new Map()
  for (const payment of payments.filter(item => item.metadata?.mode !== 'TEST')) {
    const date = payment.paidAt || payment.createdAt
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const sale = Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
    totals.set(month, (totals.get(month) || 0) + sale * settings.commissionPercent / 100)
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, revenue]) => ({ month, revenue: Number(revenue.toFixed(2)) }))
}

async function getPlatformSettings() {
  return prisma.platformSettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main', commissionPercent: 20 } })
}

function dateBoundaries(now = new Date()) {
  const limaNow = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  const dayOfMonth = limaNow.getUTCDate()
  const weekday = (limaNow.getUTCDay() + 6) % 7
  const start = (year, month, day) => new Date(Date.UTC(year, month, day) + 5 * 60 * 60 * 1000)
  const today = start(limaNow.getUTCFullYear(), limaNow.getUTCMonth(), dayOfMonth)
  return {
    today,
    week: start(limaNow.getUTCFullYear(), limaNow.getUTCMonth(), dayOfMonth - weekday),
    month: start(limaNow.getUTCFullYear(), limaNow.getUTCMonth(), 1),
    year: start(limaNow.getUTCFullYear(), 0, 1),
  }
}

export async function getPaymentSummary() {
  const payments = await prisma.payment.findMany({
    where: { status: 'PAID', method: 'MERCADOPAGO' },
    select: { amount: true, paidAt: true, createdAt: true, metadata: true },
  })
  const bounds = dateBoundaries()
  const totals = {
    today: 0, week: 0, month: 0, year: 0, lifetime: 0, count: 0,
    testToday: 0, testWeek: 0, testMonth: 0, testYear: 0, testLifetime: 0, testCount: 0,
  }
  for (const payment of payments) {
    const testMode = payment.metadata?.mode === 'TEST'
    const key = period => testMode ? `test${period[0].toUpperCase()}${period.slice(1)}` : period
    const date = payment.paidAt || payment.createdAt
    const amount = Number(payment.amount || 0)
    totals[key('lifetime')] += amount
    totals[testMode ? 'testCount' : 'count'] += 1
    if (date >= bounds.today) totals[key('today')] += amount
    if (date >= bounds.week) totals[key('week')] += amount
    if (date >= bounds.month) totals[key('month')] += amount
    if (date >= bounds.year) totals[key('year')] += amount
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, key.toLowerCase().endsWith('count') ? value : Number(value.toFixed(2))]))
}

function restaurantSales(payment) {
  return Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
}

export async function getRestaurantSettlements() {
  const [settings, restaurants, withdrawals] = await Promise.all([
    getPlatformSettings(),
    prisma.restaurant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, status: true, district: true, logoUrl: true,
        owner: { select: { name: true, email: true } },
        payouts: { select: { grossAmount: true, commissionAmount: true, netAmount: true, commissionPercent: true, createdAt: true } },
        withdrawals: { select: { id: true, amount: true, status: true, bankName: true, accountHolder: true, destinationAccountMasked: true, bankDetailsEncrypted: true, transferReference: true, createdAt: true, paidAt: true }, orderBy: { createdAt: 'desc' } },
        orders: { where: { status: { not: 'CANCELLED' } }, select: { status: true, payment: { where: { status: { in: ['PAID', 'PENDING'] }, method: 'MERCADOPAGO' }, select: { amount: true, status: true, metadata: true, order: { select: { status: true, subtotal: true, discountAmount: true } } } } } },
      },
    }),
    prisma.restaurantWithdrawal.findMany({ where: { status: 'PENDING' }, include: { restaurant: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
  ])
  return {
    commissionPercent: settings.commissionPercent,
    restaurants: restaurants.map(restaurant => {
      const paidPayments = restaurant.orders.flatMap(order => order.payment).filter(payment => payment.status === 'PAID' && payment.metadata?.mode !== 'TEST')
      const testPayments = restaurant.orders.flatMap(order => order.payment).filter(payment => payment.metadata?.mode === 'TEST' && (payment.status === 'PAID' || payment.order.status !== 'PENDING'))
      const salesTotal = paidPayments.reduce((sum, payment) => sum + restaurantSales(payment), 0)
      const testSalesTotal = testPayments.reduce((sum, payment) => sum + restaurantSales(payment), 0)
      const recordedSalesTotal = salesTotal + testSalesTotal
      const creditedGross = restaurant.payouts.reduce((sum, payout) => sum + Number(payout.grossAmount), 0)
      const pendingSales = Math.max(0, salesTotal - creditedGross)
      const totalCredits = restaurant.payouts.reduce((sum, payout) => sum + Number(payout.netAmount), 0)
      const paidCommission = restaurant.payouts.reduce((sum, payout) => sum + Number(payout.commissionAmount), 0)
      const reservedWithdrawals = restaurant.withdrawals.filter(item => ['PENDING', 'PROCESSING', 'PAID'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount), 0)
      return {
        id: restaurant.id, name: restaurant.name, status: restaurant.status, district: restaurant.district,
        logoUrl: restaurant.logoUrl, owner: restaurant.owner,
        salesTotal: Number(salesTotal.toFixed(2)), paidOrderCount: paidPayments.length,
        recordedSalesTotal: Number(recordedSalesTotal.toFixed(2)),
        testSalesTotal: Number(testSalesTotal.toFixed(2)), testPaidOrderCount: testPayments.length,
        testAdminCommission: Number((testSalesTotal * settings.commissionPercent / 100).toFixed(2)),
        testRestaurantNet: Number((testSalesTotal * (100 - settings.commissionPercent) / 100).toFixed(2)),
        commissionPercent: settings.commissionPercent,
        adminEarnedTotal: Number((paidCommission + pendingSales * settings.commissionPercent / 100).toFixed(2)),
        restaurantEarnedTotal: Number((totalCredits + pendingSales * (100 - settings.commissionPercent) / 100).toFixed(2)),
        pendingSales: Number(pendingSales.toFixed(2)),
        pendingCommission: Number((pendingSales * settings.commissionPercent / 100).toFixed(2)),
        pendingCredit: Number((pendingSales * (100 - settings.commissionPercent) / 100).toFixed(2)),
        walletBalance: Number(Math.max(0, totalCredits - reservedWithdrawals).toFixed(2)),
        payouts: restaurant.payouts.sort((a, b) => b.createdAt - a.createdAt),
        withdrawals: restaurant.withdrawals.map(({ bankDetailsEncrypted, ...item }) => ({ ...item })),
      }
    }),
    withdrawalRequests: withdrawals.map(item => ({
      id: item.id, restaurant: item.restaurant, amount: item.amount, status: item.status,
      bankName: item.bankName, accountHolder: item.accountHolder,
      destinationAccountMasked: item.destinationAccountMasked,
      bankDetails: decryptSensitiveData(item.bankDetailsEncrypted),
      transferReference: item.transferReference, createdAt: item.createdAt,
    })),
  }
}

export async function getMarketingAnalytics(period = 'month') {
  const allowed = ['week', 'month', 'year']
  if (!allowed.includes(period)) period = 'month'
  const now = new Date()
  const start = new Date(now)
  if (period === 'week') start.setDate(start.getDate() - 84)
  if (period === 'month') start.setMonth(start.getMonth() - 12)
  if (period === 'year') start.setFullYear(start.getFullYear() - 5)
  const [settings, restaurants, payments] = await Promise.all([
    getPlatformSettings(),
    prisma.restaurant.findMany({ select: { id: true, name: true, createdAt: true } }),
    prisma.payment.findMany({ where: { status: { in: ['PAID', 'PENDING'] }, method: 'MERCADOPAGO', OR: [{ paidAt: { gte: start } }, { createdAt: { gte: start } }], order: { status: { not: 'CANCELLED' } } }, select: { amount: true, status: true, paidAt: true, createdAt: true, metadata: true, order: { select: { restaurantId: true, subtotal: true, discountAmount: true, status: true } } } }),
  ])
  const step = period === 'week' ? 'week' : period === 'month' ? 'month' : 'year'
  const bucket = date => {
    if (step === 'week') {
      const monday = new Date(date)
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
      return monday.toISOString().slice(0, 10)
    }
    return step === 'month' ? date.toISOString().slice(0, 7) : String(date.getUTCFullYear())
  }
  const timeline = new Map()
  const realPayments = payments.filter(p => p.status === 'PAID' && p.metadata?.mode !== 'TEST')
  const testPayments = payments.filter(p => p.metadata?.mode === 'TEST' && (p.status === 'PAID' || p.order.status !== 'PENDING'))
  for (const payment of realPayments) {
    const date = payment.paidAt || payment.createdAt
    const key = bucket(date)
    const row = timeline.get(key) || { period: key, sales: 0, adminEarnings: 0, orders: 0, testSales: 0, testAdminEarnings: 0, testOrders: 0 }
    const sales = Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
    row.sales += sales
    row.adminEarnings += sales * settings.commissionPercent / 100
    row.orders += 1
    timeline.set(key, row)
  }
  for (const payment of testPayments) {
    const date = payment.paidAt || payment.createdAt
    const key = bucket(date)
    const row = timeline.get(key) || { period: key, sales: 0, adminEarnings: 0, orders: 0, testSales: 0, testAdminEarnings: 0, testOrders: 0 }
    const sales = Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
    row.testSales += sales
    row.testAdminEarnings += sales * settings.commissionPercent / 100
    row.testOrders += 1
    timeline.set(key, row)
  }
  const restaurantTotals = new Map(restaurants.map(r => [r.id, { id: r.id, name: r.name, sales: 0, orders: 0, testSales: 0, testOrders: 0 }]))
  for (const payment of realPayments) {
    const row = restaurantTotals.get(payment.order.restaurantId)
    if (!row) continue
    row.sales += Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
    row.orders += 1
  }
  for (const payment of testPayments) {
    const row = restaurantTotals.get(payment.order.restaurantId)
    if (!row) continue
    row.testSales += Math.max(0, Number(payment.order.subtotal) - Number(payment.order.discountAmount || 0))
    row.testOrders += 1
  }
  const data = [...timeline.values()].sort((a, b) => a.period.localeCompare(b.period)).map(row => ({ ...row, sales: Number(row.sales.toFixed(2)), adminEarnings: Number(row.adminEarnings.toFixed(2)), testSales: Number(row.testSales.toFixed(2)), testAdminEarnings: Number(row.testAdminEarnings.toFixed(2)) }))
  return { period, step, commissionPercent: settings.commissionPercent, totalRestaurants: restaurants.length, totalSales: Number(data.reduce((sum, row) => sum + row.sales, 0).toFixed(2)), adminEarnings: Number(data.reduce((sum, row) => sum + row.adminEarnings, 0).toFixed(2)), testSales: Number(data.reduce((sum, row) => sum + row.testSales, 0).toFixed(2)), testAdminEarnings: Number(data.reduce((sum, row) => sum + row.testAdminEarnings, 0).toFixed(2)), timeline: data, restaurants: [...restaurantTotals.values()].sort((a, b) => b.sales - a.sales).map(row => ({ ...row, sales: Number(row.sales.toFixed(2)), testSales: Number(row.testSales.toFixed(2)) })) }
}

export async function listMarketingAdmins(period = 'month', selectedDate) {
  const allowedPeriods = ['day', 'week', 'month', 'year']
  if (!allowedPeriods.includes(period)) period = 'month'
  const dateParts = typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    ? selectedDate.split('-').map(Number)
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => Number(part.value))
  const [year, month, day] = dateParts
  const reference = new Date(Date.UTC(year, month - 1, day, 5))
  const start = new Date(reference)
  let end
  if (period === 'day') {
    end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
  } else if (period === 'week') {
    start.setUTCDate(start.getUTCDate() - 6)
    end = new Date(reference)
    end.setUTCDate(end.getUTCDate() + 1)
  } else if (period === 'month') {
    start.setUTCDate(1)
    end = new Date(Date.UTC(year, month, 1, 5))
  } else {
    start.setUTCMonth(0, 1)
    end = new Date(Date.UTC(year + 1, 0, 1, 5))
  }
  const periodFilter = { OR: [{ startedAt: { gte: start, lt: end } }, { endedAt: { gte: start, lt: end } }] }
  const users = await prisma.user.findMany({ where: { role: 'MARKETING_ADMIN' }, select: { id: true, name: true, email: true, createdAt: true, adminSessions: { where: periodFilter, orderBy: { startedAt: 'asc' }, select: { id: true, startedAt: true, endedAt: true } } }, orderBy: { createdAt: 'asc' } })
  const invites = await prisma.marketingAdminInvite.findMany({ orderBy: { createdAt: 'asc' } })
  const emailInvites = invites.filter(invite => invite.email)
  const registeredUsers = emailInvites.length
    ? await prisma.user.findMany({ where: { OR: emailInvites.map(invite => ({ email: { equals: invite.email, mode: 'insensitive' } })) }, select: { email: true, name: true } })
    : []
  const registeredByEmail = new Map(registeredUsers.map(user => [user.email.toLowerCase(), user]))
  const marketingAdminsByEmail = new Map(users.map(user => [user.email.toLowerCase(), user]))
  const invitations = invites.map(({ tokenHash, tokenExpiresAt, ...invite }) => ({ ...invite, tokenActive: Boolean(tokenHash && tokenExpiresAt > end), accountCreated: Boolean(invite.email && registeredByEmail.has(invite.email.toLowerCase())), isMarketingAdmin: Boolean(invite.email && marketingAdminsByEmail.has(invite.email.toLowerCase())), name: invite.email ? registeredByEmail.get(invite.email.toLowerCase())?.name || null : null }))
  return { period, date: selectedDate || `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, rangeStart: start, rangeEnd: end, total: users.length, slotsUsed: invites.length, limit: 2, invites: invitations, admins: users }
}

const createInviteToken = () => randomBytes(32).toString('base64url')
const hashInviteToken = token => createHash('sha256').update(token).digest('hex')
const inviteTokenExpiresAt = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const publicInvite = (invite, token) => ({ id: invite.id, email: invite.email, status: invite.status, createdAt: invite.createdAt, tokenExpiresAt: invite.tokenExpiresAt, registrationToken: token })

export async function createMarketingAdminInvite(createdByEmail) {
  const token = createInviteToken()
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(78124020)) AS invite_lock`
    const count = await tx.marketingAdminInvite.count()
    if (count >= 2) throw new AppError('Ya se crearon las 2 cuentas permitidas de marketing', 409)
    const invite = await tx.marketingAdminInvite.create({ data: { createdByEmail, status: 'APPROVED', tokenHash: hashInviteToken(token), tokenExpiresAt: inviteTokenExpiresAt() } })
    return publicInvite(invite, token)
  })
}

export async function refreshMarketingAdminLink(id) {
  const current = await prisma.marketingAdminInvite.findUnique({ where: { id } })
  if (!current) throw new AppError('Invitación de marketing no encontrada', 404)
  if (current.status === 'SUSPENDED') throw new AppError('Reactiva la invitación antes de renovar el enlace', 409)
  if (current.status !== 'APPROVED') throw new AppError('Aprueba la cuenta antes de generar el enlace', 409)
  if (current.email) {
    const existingUser = await prisma.user.findFirst({ where: { email: { equals: current.email, mode: 'insensitive' }, role: { in: ['ADMIN', 'MARKETING_ADMIN'] } }, select: { role: true } })
    if (existingUser?.role === 'MARKETING_ADMIN') throw new AppError('Esta cuenta ya se registró; no necesita otro enlace', 409)
    if (existingUser?.role === 'ADMIN') throw new AppError('No puedes invitar al administrador principal como administrador de marketing', 409)
  }
  const token = createInviteToken()
  const invite = await prisma.marketingAdminInvite.update({ where: { id }, data: { tokenHash: hashInviteToken(token), tokenExpiresAt: inviteTokenExpiresAt() } })
  return publicInvite(invite, token)
}

export async function setMarketingAdminInviteStatus(id, status) {
  const invite = await prisma.marketingAdminInvite.findUnique({ where: { id } })
  if (!invite) throw new AppError('Cuenta de marketing no encontrada', 404)
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.marketingAdminInvite.update({ where: { id }, data: { status } })
    const matchingUser = invite.email ? await tx.user.findFirst({ where: { email: { equals: invite.email, mode: 'insensitive' } }, select: { id: true, auth0Id: true, role: true } }) : null
    if (matchingUser) {
      if (status === 'APPROVED' && matchingUser.role === 'ADMIN') throw new AppError('El correo pertenece al administrador principal', 409)
      if (status === 'APPROVED') await tx.user.update({ where: { id: matchingUser.id }, data: { role: 'MARKETING_ADMIN', isActive: true } })
      else await tx.user.updateMany({ where: { id: matchingUser.id, role: 'MARKETING_ADMIN' }, data: { isActive: false } })
    }
    return { invite: result, auth0Id: matchingUser?.auth0Id }
  })
  return { id: updated.invite.id, email: updated.invite.email, status: updated.invite.status, auth0Id: updated.auth0Id }
}

export async function listTechAdmins(period = 'month', selectedDate) {
  const users = await prisma.user.findMany({ where: { role: 'TECH_ADMIN' }, select: { id: true, name: true, email: true, createdAt: true, adminSessions: { orderBy: { startedAt: 'asc' }, select: { id: true, startedAt: true, endedAt: true } } }, orderBy: { createdAt: 'asc' } })
  const invites = await prisma.techAdminInvite.findMany({ orderBy: { createdAt: 'asc' } })
  const emails = invites.filter(item => item.email).map(item => ({ email: { equals: item.email, mode: 'insensitive' } }))
  const registered = emails.length ? await prisma.user.findMany({ where: { OR: emails }, select: { email: true, name: true } }) : []
  const names = new Map(registered.map(item => [item.email.toLowerCase(), item.name]))
  const active = new Map(users.map(item => [item.email.toLowerCase(), item]))
  const end = new Date()
  return { period, date: selectedDate || end.toISOString().slice(0, 10), total: users.length, slotsUsed: invites.length, limit: 2, invites: invites.map(({ tokenHash, tokenExpiresAt, ...invite }) => ({ ...invite, tokenActive: Boolean(tokenHash && tokenExpiresAt > end), accountCreated: Boolean(invite.email && names.has(invite.email.toLowerCase())), isTechAdmin: Boolean(invite.email && active.has(invite.email.toLowerCase())), name: invite.email ? names.get(invite.email.toLowerCase()) || null : null })), admins: users }
}

export async function createTechAdminInvite(createdByEmail) {
  const token = createInviteToken()
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(78124021)) AS invite_lock`
    if (await tx.techAdminInvite.count() >= 2) throw new AppError('Ya se crearon las 2 cuentas permitidas de adminTec', 409)
    const invite = await tx.techAdminInvite.create({ data: { createdByEmail, status: 'APPROVED', tokenHash: hashInviteToken(token), tokenExpiresAt: inviteTokenExpiresAt() } })
    return publicInvite(invite, token)
  })
}

export async function refreshTechAdminLink(id) {
  const current = await prisma.techAdminInvite.findUnique({ where: { id } })
  if (!current) throw new AppError('Invitación técnica no encontrada', 404)
  if (current.status === 'SUSPENDED') throw new AppError('Reactiva la invitación antes de renovar el enlace', 409)
  if (current.status !== 'APPROVED') throw new AppError('Aprueba la cuenta antes de generar el enlace', 409)
  if (current.email) {
    const user = await prisma.user.findFirst({ where: { email: { equals: current.email, mode: 'insensitive' }, role: { in: ['ADMIN', 'TECH_ADMIN'] } }, select: { role: true } })
    if (user?.role === 'TECH_ADMIN') throw new AppError('Esta cuenta ya se registró; no necesita otro enlace', 409)
    if (user?.role === 'ADMIN') throw new AppError('No puedes invitar al administrador principal como adminTec', 409)
  }
  const token = createInviteToken()
  const invite = await prisma.techAdminInvite.update({ where: { id }, data: { tokenHash: hashInviteToken(token), tokenExpiresAt: inviteTokenExpiresAt() } })
  return publicInvite(invite, token)
}

export async function setTechAdminInviteStatus(id, status) {
  const invite = await prisma.techAdminInvite.findUnique({ where: { id } })
  if (!invite) throw new AppError('Cuenta técnica no encontrada', 404)
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.techAdminInvite.update({ where: { id }, data: { status } })
    const user = invite.email ? await tx.user.findFirst({ where: { email: { equals: invite.email, mode: 'insensitive' } }, select: { id: true, auth0Id: true, role: true } }) : null
    if (user) {
      if (status === 'APPROVED' && user.role === 'ADMIN') throw new AppError('El correo pertenece al administrador principal', 409)
      if (status === 'APPROVED') await tx.user.update({ where: { id: user.id }, data: { role: 'TECH_ADMIN', isActive: true } })
      else await tx.user.updateMany({ where: { id: user.id, role: 'TECH_ADMIN' }, data: { isActive: false } })
    }
    return { invite: result, auth0Id: user?.auth0Id }
  })
  return { id: updated.invite.id, email: updated.invite.email, status: updated.invite.status, auth0Id: updated.auth0Id }
}

export async function updateCommissionPercent(value) {
  const commissionPercent = Number(value)
  if (!Number.isInteger(commissionPercent) || commissionPercent < 20 || commissionPercent > 40) {
    throw new AppError('La comisión debe ser un número entero entre 20 % y 40 %', 400)
  }
  return prisma.platformSettings.upsert({ where: { id: 'main' }, update: { commissionPercent }, create: { id: 'main', commissionPercent } })
}

export async function creditRestaurant(id) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "restaurants" WHERE "id" = ${id} FOR UPDATE`
    const restaurant = await tx.restaurant.findUnique({ where: { id }, select: { id: true } })
    if (!restaurant) throw new AppError('Restaurante no encontrado', 404)
    const settings = await tx.platformSettings.upsert({ where: { id: 'main' }, update: {}, create: { id: 'main', commissionPercent: 20 } })
    const [payments, previousPayouts] = await Promise.all([
      tx.payment.findMany({ where: { status: 'PAID', method: 'MERCADOPAGO', order: { restaurantId: id, status: { not: 'CANCELLED' } } }, select: { metadata: true, order: { select: { subtotal: true, discountAmount: true } } } }),
      tx.restaurantPayout.aggregate({ where: { restaurantId: id }, _sum: { grossAmount: true } }),
    ])
    const salesTotal = payments.filter(payment => payment.metadata?.mode !== 'TEST').reduce((sum, payment) => sum + restaurantSales(payment), 0)
    const pendingSales = Number(Math.max(0, salesTotal - Number(previousPayouts._sum.grossAmount || 0)).toFixed(2))
    if (pendingSales < 0.01) throw new AppError('Este restaurante no tiene ventas pagadas pendientes de liquidar', 400)
    const commissionAmount = Number((pendingSales * settings.commissionPercent / 100).toFixed(2))
    const netAmount = Number((pendingSales - commissionAmount).toFixed(2))
    return tx.restaurantPayout.create({ data: { restaurantId: id, grossAmount: pendingSales, commissionPercent: settings.commissionPercent, commissionAmount, netAmount } })
  })
}

export async function markWithdrawalPaid(id, transferReference) {
  const reference = String(transferReference || '').trim()
  if (!reference) throw new AppError('Ingresa el número de operación de la transferencia', 400)
  const withdrawal = await prisma.restaurantWithdrawal.findUnique({ where: { id } })
  if (!withdrawal) throw new AppError('Solicitud de retiro no encontrada', 404)
  if (withdrawal.status !== 'PENDING') throw new AppError('Esta solicitud ya fue procesada', 409)
  return prisma.restaurantWithdrawal.update({ where: { id }, data: { status: 'PAID', transferReference: reference, paidAt: new Date() } })
}

// ── Usuarios ──────────────────────────────────────────────────
// ⚠️ Campo corregido: auth0Id en lugar de oauthProvider
export async function listUsers(query) {
  const { page, limit, skip } = paginate(query)
  const { search, role } = query

  const where = {
    ...(role   && { role }),
    ...(search && {
      OR: [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, phone: true,
        role: true, isActive: true, avatarUrl: true,
        auth0Id: true,      // ← corregido (antes era oauthProvider)
        createdAt: true,
        _count: { select: { orders: true } },
      },
      skip, take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ])

  return { data, pagination: paginationMeta(page, limit, total) }
}

export async function changeRole(userId, role) {
  const validRoles = ['CONSUMER', 'RESTAURANT_OWNER', 'DELIVERY', 'ADMIN', 'MARKETING_ADMIN', 'TECH_ADMIN']
  if (!validRoles.includes(role)) throw new AppError('Rol inválido', 400)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError('Usuario no encontrado', 404)
  return prisma.user.update({
    where: { id: userId }, data: { role },
    select: { id: true, name: true, email: true, role: true },
  })
}

export async function toggleUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { isActive: true, role: true },
  })
  if (!user) throw new AppError('Usuario no encontrado', 404)
  if (user.role === 'ADMIN') throw new AppError('No puedes suspender a un administrador', 403)
  return prisma.user.update({
    where: { id: userId }, data: { isActive: !user.isActive },
    select: { id: true, name: true, email: true, isActive: true },
  })
}

// ── Restaurantes ──────────────────────────────────────────────
export async function listRestaurants(query) {
  const { page, limit, skip } = paginate(query)
  const { search, status, category } = query

  const where = {
    ...(status   && { status }),
    ...(category && { category }),
    ...(search   && {
      OR: [
        { name:     { contains: search, mode: 'insensitive' } },
        { ruc:      { contains: search } },
        { district: { contains: search, mode: 'insensitive' } },
      ],
    }),
  }

  const [data, total] = await Promise.all([
    prisma.restaurant.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { orders: true, products: true } },
      },
      skip, take: limit, orderBy: { createdAt: 'desc' },
    }),
    prisma.restaurant.count({ where }),
  ])

  return { data, pagination: paginationMeta(page, limit, total) }
}

export async function verifyRestaurant(id) {
  const r = await prisma.restaurant.findUnique({ where: { id } })
  if (!r) throw new AppError('Restaurante no encontrado', 404)
  if (r.status === 'ACTIVE') throw new AppError('El restaurante ya está activo', 400)
  return prisma.restaurant.update({ where: { id }, data: { status: 'ACTIVE' } })
}

export async function suspendRestaurant(id) {
  const r = await prisma.restaurant.findUnique({ where: { id } })
  if (!r) throw new AppError('Restaurante no encontrado', 404)
  return prisma.restaurant.update({ where: { id }, data: { status: 'SUSPENDED' } })
}

// ── Pedidos ───────────────────────────────────────────────────
export async function listOrders(query) {
  const { page, limit, skip } = paginate(query)
  const { status, type } = query

  const where = {
    ...(status && { status }),
    ...(type   && { type }),
  }

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        user:       { select: { id: true, name: true, email: true } },
        restaurant: { select: { id: true, name: true } },
        payment:    { select: { status: true, method: true, amount: true } },
        driver: { include: { user: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
      skip, take: limit, orderBy: { createdAt: 'desc' },
    }),
    prisma.order.count({ where }),
  ])

  return { data, pagination: paginationMeta(page, limit, total) }
}

// ── Pagos ─────────────────────────────────────────────────────
export async function listPayments(query) {
  const { page, limit, skip } = paginate(query)
  const { status, method } = query

  const where = {
    ...(status && { status }),
    ...(method && { method }),
  }

  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        order: {
          select: {
            orderNumber: true, type: true, total: true,
            user:        { select: { name: true, email: true } },
            restaurant:  { select: { name: true } },
          },
        },
      },
      skip, take: limit, orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.count({ where }),
  ])

  return { data, pagination: paginationMeta(page, limit, total) }
}

// ── Repartidores ──────────────────────────────────────────────
export async function listDrivers(query) {
  const { page, limit, skip } = paginate(query)
  const { status, isVerified } = query

  const where = {
    ...(status     && { status }),
    ...(isVerified !== undefined && isVerified !== '' && {
      isVerified: isVerified === 'true',
    }),
  }

  const [data, total] = await Promise.all([
    prisma.deliveryDriver.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        _count: { select: { orders: true } },
      },
      skip, take: limit, orderBy: { createdAt: 'desc' },
    }),
    prisma.deliveryDriver.count({ where }),
  ])

  return { data, pagination: paginationMeta(page, limit, total) }
}

export async function verifyDriver(id) {
  const driver = await prisma.deliveryDriver.findUnique({ where: { id } })
  if (!driver) throw new AppError('Repartidor no encontrado', 404)
  if (driver.isVerified) throw new AppError('El repartidor ya está verificado', 400)
  return prisma.deliveryDriver.update({
    where: { id }, data: { isVerified: true, status: 'AVAILABLE' },
    include: { user: { select: { name: true, email: true } } },
  })
}

export async function suspendDriver(id) {
  const driver = await prisma.deliveryDriver.findUnique({ where: { id } })
  if (!driver) throw new AppError('Repartidor no encontrado', 404)
  return prisma.deliveryDriver.update({
    where: { id }, data: { status: 'SUSPENDED' },
    include: { user: { select: { name: true, email: true } } },
  })
}

export async function activateDriver(id) {
  const driver = await prisma.deliveryDriver.findUnique({ where: { id } })
  if (!driver) throw new AppError('Repartidor no encontrado', 404)
  if (driver.status !== 'SUSPENDED') return driver
  return prisma.deliveryDriver.update({
    where: { id }, data: { status: 'OFFLINE' },
    include: { user: { select: { name: true, email: true } } },
  })
}
