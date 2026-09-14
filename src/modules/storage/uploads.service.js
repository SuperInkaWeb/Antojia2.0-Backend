import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/utils/appError.js'

const BUCKET = 'logos'
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const ALLOWED_SCOPES = new Set([
  'restaurants/logos',
  'drivers/dni',
  'drivers/licenses',
  'drivers/vehicles',
  'delivery/proofs',
])

function getConfig() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new AppError('El almacenamiento de imágenes no está configurado en el backend', 503)
  }
  return { url: url.replace(/\/$/, ''), serviceKey }
}

export async function createSignedUpload({ userId, scope, contentType }) {
  const extension = IMAGE_TYPES.get(contentType)
  if (!extension) throw new AppError('Solo se permiten imágenes JPG, PNG o WEBP', 400)
  if (!ALLOWED_SCOPES.has(scope)) throw new AppError('Categoría de imagen no permitida', 400)

  const { url, serviceKey } = getConfig()
  const path = `uploads/${scope}/${userId}/${randomUUID()}.${extension}`
  const endpoint = `${url}/storage/v1/object/upload/sign/${BUCKET}/${path}`

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
  } catch {
    throw new AppError('No se pudo conectar con el almacenamiento de imágenes', 502)
  }

  const result = await response.json().catch(() => ({}))
  if (!response.ok || typeof result.signedURL !== 'string') {
    console.error('Supabase no pudo crear URL de subida:', response.status, result.message || result.error || '')
    throw new AppError('No se pudo preparar la subida de la imagen', 502)
  }

  const signedUrl = new URL(`${url}/storage/v1${result.signedURL}`).toString()
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return {
    signedUrl,
    publicUrl: `${url}/storage/v1/object/public/${BUCKET}/${encodedPath}`,
  }
}
