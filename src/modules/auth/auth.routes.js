import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import * as ctrl from './auth.controller.js'

const router = Router()

// ── Sincronizar usuario tras login (requiere token Auth0) ────
// El frontend llama a este endpoint justo después del login
// Si el usuario no existe en BD lo crea automáticamente
router.post('/sync', authenticate, ctrl.sync)

// ── Obtener perfil del usuario autenticado ───────────────────
router.get('/me', authenticate, ctrl.me)

// ── Actualizar datos del perfil ──────────────────────────────
router.patch('/me', authenticate, ctrl.updateMe)

// Alta del único administrador autorizado, sin SQL manual.
router.post('/register-admin', authenticate, ctrl.registerAdmin)
router.post('/register-marketing-admin', authenticate, ctrl.registerMarketingAdmin)
router.post('/register-tech-admin', authenticate, ctrl.registerTechAdmin)
router.post('/register-finance-admin', authenticate, ctrl.registerFinanceAdmin)
router.post('/admin-session/end', authenticate, ctrl.endAdminSession)

// ── Cambiar rol (solo admin) ─────────────────────────────────
router.patch('/users/:id/role', authenticate, authorize('ADMIN'), ctrl.changeRole)

// ── Registrar restaurante (solo usuarios sin restaurante) ────
router.post('/register-restaurant', authenticate, ctrl.registerRestaurant)

export default router
