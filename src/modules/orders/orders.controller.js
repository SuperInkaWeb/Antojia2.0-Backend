import * as svc from './orders.service.js'

// POST /api/v1/orders
export async function create(req, res) {
  const order = await svc.create(req.user.id, req.body)
  res.status(201).json({
    success: true,
    message: order.type === 'DELIVERY' ? 'Pedido de delivery creado' : 'Reserva creada',
    data: order,
  })
}

// GET /api/v1/orders/my
export async function myOrders(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  const result = await svc.myOrders(req.user.id, req.query)
  res.json({ success: true, ...result })
}

// GET /api/v1/orders/:id
export async function getOne(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  const data = await svc.getOne(req.params.id, req.user.id, req.user.role)
  res.json({ success: true, data })
}

// GET /api/v1/orders/restaurant/:restaurantId
export async function listByRestaurant(req, res) {
  const result = await svc.listByRestaurant(
    req.params.restaurantId,
    req.user.id,
    req.user.role,
    req.query
  )
  res.json({ success: true, ...result })
}

// PATCH /api/v1/orders/:id/status
export async function updateStatus(req, res) {
  const { status } = req.body
  if (!status) return res.status(400).json({ success: false, message: 'El campo status es requerido' })
  const data = await svc.updateStatus(req.params.id, req.user.id, req.user.role, status, {
    deliveryCode: req.body.deliveryCode,
    deliveryProofUrl: req.body.deliveryProofUrl,
  })
  res.json({ success: true, message: `Estado actualizado a ${status}`, data })
}

// PATCH /api/v1/orders/:id/cancel
export async function cancel(req, res) {
  const data = await svc.cancel(req.params.id, req.user.id)
  res.json({ success: true, message: 'Pedido cancelado', data })
}

// PATCH /api/v1/orders/:id/change-driver
export async function changeDriver(req, res) {
  const data = await svc.changeDriver(req.params.id, req.user.id)
  res.json({ success: true, message: 'El pedido volvió a estar disponible para otro repartidor', data })
}

// PATCH /api/v1/orders/:id/assign-driver
export async function assignDriver(req, res) {
  const data = await svc.assignDriver(req.params.id, req.user.id)
  res.json({ success: true, message: 'Pedido tomado exitosamente', data })
}

// GET /api/v1/orders/reverse-geocode?latitude=&longitude=
export async function reverseGeocode(req, res) {
  const data = await svc.reverseGeocode(req.query)
  res.json({ success: true, data })
}

// POST /api/v1/orders/:id/driver-rating
export async function rateDriver(req, res) {
  const data = await svc.rateDriver(req.params.id, req.user.id, req.body)
  res.status(201).json({ success: true, message: 'Gracias por calificar a tu repartidor', data })
}
