import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import * as ctrl from './orders.controller.js'

const router = Router()
router.use(authenticate)

// ── Consumidor ─────────────────────────────────────────────────
router.post('/',          ctrl.create)        // crear pedido
router.get('/my',         ctrl.myOrders)      // mis pedidos + historial
router.get('/reverse-geocode', ctrl.reverseGeocode)
router.get('/:id',        ctrl.getOne)        // detalle de un pedido
router.patch('/:id/cancel', ctrl.cancel)      // cancelar pedido
router.patch('/:id/change-driver', ctrl.changeDriver) // solicitar otro repartidor
router.post('/:id/driver-rating', ctrl.rateDriver) // calificar repartidor

// ── Restaurante ────────────────────────────────────────────────
router.get('/restaurant/:restaurantId',
  authorize('RESTAURANT_OWNER', 'ADMIN'),
  ctrl.listByRestaurant
)

// ── Actualizar estado ──────────────────────────────────────────
router.patch('/:id/status',
  authorize('RESTAURANT_OWNER', 'DELIVERY', 'ADMIN'),
  ctrl.updateStatus
)

// ── Asignar repartidor ─────────────────────────────────────────
router.patch('/:id/assign-driver',
  authorize('DELIVERY', 'ADMIN'),
  ctrl.assignDriver
)

export default router
