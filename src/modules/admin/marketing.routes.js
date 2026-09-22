import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import * as ctrl from './admin.controller.js'
import * as svc from './admin.service.js'

const router = Router()
router.use(authenticate, authorize('MARKETING_ADMIN'))
router.get('/analytics', ctrl.getMarketingAnalytics)
router.get('/settlements', async (_req, res) => res.json({ success: true, data: await svc.getRestaurantSettlements() }))
router.get('/rewards', async (_req, res) => res.json({ success: true, data: await svc.listMarketingRewards() }))
router.post('/rewards', async (req, res) => res.status(201).json({ success: true, message: 'Recompensa creada', data: await svc.createMarketingReward(req.body, req.user.id) }))
router.patch('/rewards/:id/toggle', async (req, res) => res.json({ success: true, message: 'Estado actualizado', data: await svc.toggleMarketingReward(req.params.id) }))
router.delete('/rewards/:id', async (req, res) => { await svc.deleteMarketingReward(req.params.id); res.json({ success: true, message: 'Recompensa eliminada' }) })
router.post('/settlements/restaurants/:id/credit', async (req, res) => {
  const data = await svc.creditRestaurant(req.params.id)
  res.status(201).json({ success: true, message: 'Saldo acreditado al restaurante', data })
})

export default router
