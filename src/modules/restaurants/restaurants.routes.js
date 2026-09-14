import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import * as ctrl from './restaurants.controller.js'
import { checkRuc } from './ruc.controller.js'

const router = Router()

// ── Verificación de RUC (pública) ────────────────────────────
router.get('/verify-ruc/:ruc', checkRuc)

// ── Públicas ──────────────────────────────────────────────────
router.get('/',    ctrl.list)
router.get('/:id/customers', authenticate, authorize('RESTAURANT_OWNER', 'ADMIN'), ctrl.listCustomers)
router.get('/:id/customers/:customerId', authenticate, authorize('RESTAURANT_OWNER', 'ADMIN'), ctrl.getCustomer)
router.get('/:id/wallet', authenticate, authorize('RESTAURANT_OWNER'), ctrl.getWallet)
router.post('/:id/withdrawals', authenticate, authorize('RESTAURANT_OWNER'), ctrl.requestWithdrawal)
router.get('/:id', ctrl.getOne)

// ── Dueño de restaurante ──────────────────────────────────────
router.post('/',
  authenticate,
  authorize('RESTAURANT_OWNER'),
  ctrl.create
)
router.put('/:id',
  authenticate,
  authorize('RESTAURANT_OWNER', 'ADMIN'),
  ctrl.update
)

// ── Categorías ────────────────────────────────────────────────
router.get('/:id/categories', ctrl.listCategories)
router.post('/:id/categories',
  authenticate,
  authorize('RESTAURANT_OWNER', 'ADMIN'),
  ctrl.createCategory
)
router.delete('/:id/categories/:categoryId',
  authenticate,
  authorize('RESTAURANT_OWNER', 'ADMIN'),
  ctrl.deleteCategory
)

// ── Admin ─────────────────────────────────────────────────────
router.patch('/:id/verify',  authenticate, authorize('ADMIN'), ctrl.verify)
router.patch('/:id/suspend', authenticate, authorize('ADMIN'), ctrl.suspend)

export default router
