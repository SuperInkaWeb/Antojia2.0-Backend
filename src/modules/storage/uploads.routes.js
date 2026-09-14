import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware.js'
import { createSignedUpload } from './uploads.controller.js'

const router = Router()

router.post('/signed-url', authenticate, createSignedUpload)

export default router
