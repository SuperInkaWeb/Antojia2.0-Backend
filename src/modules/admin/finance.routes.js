import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import * as svc from './admin.service.js'

const router = Router()
router.use(authenticate, authorize('FINANCE_ADMIN'))
router.get('/dashboard', async (req, res) => res.json({ success: true, data: await svc.getFinanceDashboard(req.query.period) }))
router.patch('/withdrawals/:id/accept', async (req, res) => res.json({ success: true, message: 'Solicitud aceptada para pago', data: await svc.acceptFinanceWithdrawal(req.params.id) }))
router.patch('/withdrawals/:id/paid', async (req, res) => res.json({ success: true, message: 'Pago registrado correctamente', data: await svc.markFinanceWithdrawalPaid(req.params.id, req.body.transferReference) }))

export default router
