import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import * as ctrl from './admin.controller.js'

const router = Router()

// Todas las rutas requieren ser ADMIN
router.use(authenticate, authorize('ADMIN'))

// ── Dashboard / métricas ──────────────────────────────────────
router.get('/metrics',          ctrl.getMetrics)
router.get('/metrics/revenue',  ctrl.getRevenueChart)
router.get('/payments/summary', ctrl.getPaymentSummary)
router.get('/settlements', ctrl.getRestaurantSettlements)
router.patch('/settlements/commission', ctrl.updateCommissionPercent)
router.post('/settlements/restaurants/:id/credit', ctrl.creditRestaurant)
router.patch('/settlements/withdrawals/:id/paid', ctrl.markWithdrawalPaid)

// ── Tabla de usuarios ─────────────────────────────────────────
router.get('/users',            ctrl.listUsers)
router.patch('/users/:id/role', ctrl.changeRole)
router.patch('/users/:id/toggle', ctrl.toggleUser)

// ── Tabla de restaurantes ─────────────────────────────────────
router.get('/restaurants',              ctrl.listRestaurants)
router.patch('/restaurants/:id/verify',  ctrl.verifyRestaurant)
router.patch('/restaurants/:id/suspend', ctrl.suspendRestaurant)

// ── Tabla de pedidos ──────────────────────────────────────────
router.get('/orders',           ctrl.listOrders)

// ── Tabla de pagos ────────────────────────────────────────────
router.get('/payments',         ctrl.listPayments)

// ── Tabla de repartidores ─────────────────────────────────────
router.get('/drivers',                    ctrl.listDrivers)
router.patch('/drivers/:id/verify',       ctrl.verifyDriver)
router.patch('/drivers/:id/suspend',      ctrl.suspendDriver)
router.patch('/drivers/:id/activate',     ctrl.activateDriver)

export default router
