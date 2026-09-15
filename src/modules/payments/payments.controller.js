import { createHmac, timingSafeEqual } from 'node:crypto'
import * as svc from './payments.service.js'

export function getPublicConfig(req, res) {
  res.json({
    success: true,
    data: {
      productionEnabled: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
      testEnabled: Boolean(process.env.MERCADOPAGO_TEST_ACCESS_TOKEN),
    },
  })
}

function isValidMpSignature(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim()
  if (!secret) return true

  const signature = req.get('x-signature')
  const requestId = req.get('x-request-id')
  const dataId = req.query?.['data.id'] || req.body?.data?.id || req.query?.id
  if (!signature || !requestId || !dataId) return false

  const parts = Object.fromEntries(
    signature.split(',').map(part => part.trim().split('=', 2))
  )
  if (!parts.ts || !parts.v1) return false

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'))
  } catch {
    return false
  }
}

// POST /api/v1/payments/charge  (Yape / Efectivo al recibir)
export async function charge(req, res) {
  const { orderId, method, phoneNumber } = req.body

  if (!orderId || !method) {
    return res.status(400).json({
      success: false,
      message: 'Los campos orderId y method son requeridos',
    })
  }

  const data = await svc.charge({
    orderId,
    method,
    phoneNumber,
    userId: req.user.id,
  })

  res.status(201).json({
    success: true,
    message: 'Pago procesado exitosamente',
    data,
  })
}

// POST /api/v1/payments/mercadopago/preference
// Crea la preferencia de Checkout Pro y devuelve la URL a la que redirigir.
export async function createMpPreference(req, res) {
  const { orderId } = req.body
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'El campo orderId es requerido' })
  }

  const data = await svc.createMercadoPagoPreference({ orderId, userId: req.user.id })

  res.status(201).json({ success: true, data })
}

// POST /api/v1/payments/mercadopago/test-preference
export async function createMpTestPreference(req, res) {
  const { orderId } = req.body
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'El campo orderId es requerido' })
  }

  const data = await svc.createMercadoPagoTestPreference({ orderId, userId: req.user.id })
  res.status(201).json({ success: true, data })
}

// POST /api/v1/payments/mercadopago/sync
// Llamado por el frontend al volver de Mercado Pago (success/pending), para
// reflejar el estado real sin tener que esperar al webhook.
export async function syncMp(req, res) {
  const { orderId, mpPaymentId, result } = req.body
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'El campo orderId es requerido' })
  }

  const data = await svc.syncMercadoPago({ orderId, userId: req.user.id, mpPaymentId, result })

  res.json({ success: true, data })
}

// POST /api/v1/payments/mercadopago/webhook  (público — lo llama Mercado Pago)
// IMPORTANTE: esta ruta NO pasa por el middleware de autenticación.
export async function mpWebhook(req, res) {
  if (!isValidMpSignature(req)) {
    console.error('[payments.controller] Firma inválida en webhook de Mercado Pago')
    return res.status(401).json({ success: false, message: 'Firma inválida' })
  }

  try {
    const mpPaymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id
    const type = req.body?.type || req.query?.type || req.query?.topic
    const testMode = req.query?.mode === 'test'

    // Solo nos interesan notificaciones de tipo "payment"
    if (type === 'payment' && mpPaymentId) {
      await svc.processMercadoPagoUpdate(mpPaymentId, { testMode })
    }

    res.sendStatus(200)
  } catch (error) {
    console.error('[payments.controller] Error en webhook de Mercado Pago:', error)
    // Un error temporal devuelve 500 para que Mercado Pago reintente.
    res.status(500).json({ success: false, message: 'No se pudo procesar el webhook' })
  }
}

// GET /api/v1/payments/order/:orderId
export async function getByOrder(req, res) {
  const data = await svc.getByOrder(
    req.params.orderId,
    req.user.id,
    req.user.role
  )
  res.json({ success: true, data })
}
