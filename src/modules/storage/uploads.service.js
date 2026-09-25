import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../../shared/utils/appError.js'

const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const ALLOWED_SCOPES = new Set([
  'restaurants/logos',
  'restaurants/banners',
  'restaurants/dishes',
  'drivers/dni',
  'drivers/licenses',
  'drivers/vehicles',
  'delivery/proofs',
])

function getConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError('El almacenamiento de imágenes no está configurado en el backend', 503)
  }
  return { cloudName, apiKey, apiSecret }
}

function signParams(params, apiSecret) {
  const signatureBase = Object.entries(params)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return createHash('sha1').update(`${signatureBase}${apiSecret}`).digest('hex')
}

function getPublicIdFromUrl(value) {
  try {
    const url = new URL(value)
    if (url.hostname !== 'res.cloudinary.com') return null
    const marker = '/upload/'
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex === -1) return null
    const path = url.pathname.slice(markerIndex + marker.length).replace(/^v\d+\//, '')
    return decodeURIComponent(path).replace(/\.[^/.]+$/, '') || null
  } catch {
    return null
  }
}

export async function createSignedUpload({ userId, scope, contentType }) {
  if (!IMAGE_TYPES.has(contentType)) throw new AppError('Solo se permiten imágenes JPG, PNG o WEBP', 400)
  if (!ALLOWED_SCOPES.has(scope)) throw new AppError('Categoría de imagen no permitida', 400)

  const { cloudName, apiKey, apiSecret } = getConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = `foodinka/${scope}`
  const publicId = `${userId}-${randomUUID()}`
  const paramsToSign = { folder, public_id: publicId, timestamp }
  const signature = signParams(paramsToSign, apiSecret)

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder,
    publicId,
  }
}

export async function deleteImageByUrl(value) {
  const publicId = getPublicIdFromUrl(value)
  if (!publicId) return false

  const { cloudName, apiKey, apiSecret } = getConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signParams({ public_id: publicId, timestamp }, apiSecret)
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  })
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !['ok', 'not found'].includes(result.result)) {
    throw new Error(result.error?.message || `Cloudinary respondió ${response.status}`)
  }
  return true
}
