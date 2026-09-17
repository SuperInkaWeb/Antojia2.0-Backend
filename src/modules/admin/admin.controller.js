import * as svc from './admin.service.js'

// ── Métricas ──────────────────────────────────────────────────
export const getMetrics      = async (req, res) => res.json({ success: true, data: await svc.getMetrics() })
export const getRevenueChart = async (req, res) => res.json({ success: true, data: await svc.getRevenueChart() })
export const getPaymentSummary = async (req, res) => res.json({ success: true, data: await svc.getPaymentSummary() })
export const getRestaurantSettlements = async (req, res) => res.json({ success: true, data: await svc.getRestaurantSettlements() })
export const getMarketingAnalytics = async (req, res) => res.json({ success: true, data: await svc.getMarketingAnalytics(req.query.period) })
export const listMarketingAdmins = async (req, res) => res.json({ success: true, data: await svc.listMarketingAdmins(req.query.period) })

export const updateCommissionPercent = async (req, res) => {
  const data = await svc.updateCommissionPercent(req.body.commissionPercent)
  res.json({ success: true, data })
}

export const creditRestaurant = async (req, res) => {
  const data = await svc.creditRestaurant(req.params.id)
  res.status(201).json({ success: true, message: 'Saldo acreditado al restaurante', data })
}

export const markWithdrawalPaid = async (req, res) => {
  const data = await svc.markWithdrawalPaid(req.params.id, req.body.transferReference)
  res.json({ success: true, message: 'Retiro marcado como transferido', data })
}

// ── Usuarios ──────────────────────────────────────────────────
export const listUsers = async (req, res) => {
  const result = await svc.listUsers(req.query)
  res.json({ success: true, ...result })
}

export const changeRole = async (req, res) => {
  const { role } = req.body
  if (!role) return res.status(400).json({ success: false, message: 'El campo role es requerido' })
  const data = await svc.changeRole(req.params.id, role)
  res.json({ success: true, message: `Rol actualizado a ${role}`, data })
}

export const toggleUser = async (req, res) => {
  const data = await svc.toggleUser(req.params.id)
  res.json({ success: true, message: `Usuario ${data.isActive ? 'activado' : 'suspendido'}`, data })
}

// ── Restaurantes ──────────────────────────────────────────────
export const listRestaurants = async (req, res) => {
  const result = await svc.listRestaurants(req.query)
  res.json({ success: true, ...result })
}

export const verifyRestaurant = async (req, res) => {
  const data = await svc.verifyRestaurant(req.params.id)
  res.json({ success: true, message: 'Restaurante verificado y activado', data })
}

export const suspendRestaurant = async (req, res) => {
  const data = await svc.suspendRestaurant(req.params.id)
  res.json({ success: true, message: 'Restaurante suspendido', data })
}

// ── Pedidos ───────────────────────────────────────────────────
export const listOrders = async (req, res) => {
  const result = await svc.listOrders(req.query)
  res.json({ success: true, ...result })
}

// ── Pagos ─────────────────────────────────────────────────────
export const listPayments = async (req, res) => {
  const result = await svc.listPayments(req.query)
  res.json({ success: true, ...result })
}

// ── Repartidores ──────────────────────────────────────────────
export const listDrivers = async (req, res) => {
  const result = await svc.listDrivers(req.query)
  res.json({ success: true, ...result })
}

export const verifyDriver = async (req, res) => {
  const data = await svc.verifyDriver(req.params.id)
  res.json({ success: true, message: 'Repartidor verificado', data })
}

export const suspendDriver = async (req, res) => {
  const data = await svc.suspendDriver(req.params.id)
  res.json({ success: true, message: 'Repartidor suspendido', data })
}

export const activateDriver = async (req, res) => {
  const data = await svc.activateDriver(req.params.id)
  res.json({ success: true, message: 'Repartidor activado', data })
}
