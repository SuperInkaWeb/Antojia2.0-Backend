import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware.js'
import * as ctrl from './payments.controller.js'

const router = Router()
router.get('/config', ctrl.getPublicConfig)
router.use(authenticate)

router.post('/charge',                  ctrl.charge)            // pagar con Yape / Efectivo
router.post('/mercadopago/preference',   ctrl.createMpPreference) // iniciar pago con Mercado Pago
router.post('/mercadopago/test-preference', ctrl.createMpTestPreference) // Checkout Pro sandbox
router.post('/mercadopago/sync',         ctrl.syncMp)             // sincronizar estado al volver del checkout
router.get('/order/:orderId',            ctrl.getByOrder)        // ver pago de un pedido

export default router
