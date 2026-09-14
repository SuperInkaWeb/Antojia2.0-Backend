import { AppError } from '../../shared/utils/appError.js'
import * as service from './uploads.service.js'

export async function createSignedUpload(req, res) {
  const { scope, contentType } = req.body || {}
  if (typeof scope !== 'string' || typeof contentType !== 'string') {
    throw new AppError('Indica la categoría y el tipo de imagen', 400)
  }

  const data = await service.createSignedUpload({ userId: req.user.id, scope, contentType })
  res.status(201).json({ success: true, data })
}
