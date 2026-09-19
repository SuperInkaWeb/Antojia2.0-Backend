import { Router } from 'express'
import * as ctrl from './reports.controller.js'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
const router = Router()
router.use(authenticate)
router.post('/', authorize('CONSUMER', 'RESTAURANT_OWNER', 'DELIVERY'), ctrl.create)
router.get('/mine', authorize('CONSUMER', 'RESTAURANT_OWNER', 'DELIVERY'), ctrl.mine)
router.get('/', authorize('TECH_ADMIN'), ctrl.list)
router.patch('/:id/answer', authorize('TECH_ADMIN'), ctrl.answer)
export default router
