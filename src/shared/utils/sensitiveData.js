import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { AppError } from './appError.js'

function encryptionKey() {
  const value = process.env.WITHDRAWAL_DATA_ENCRYPTION_KEY?.trim()
  if (!value) {
    throw new AppError('Falta configurar WITHDRAWAL_DATA_ENCRYPTION_KEY en el entorno del backend', 503)
  }

  // Acepta la clave hexadecimal de 64 caracteres usada localmente y también
  // la clave Base64 de 32 bytes que Render puede generar automáticamente.
  if (/^[\da-f]{64}$/i.test(value)) return Buffer.from(value, 'hex')

  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 32 && decoded.toString('base64') === value) return decoded

  throw new AppError('WITHDRAWAL_DATA_ENCRYPTION_KEY debe representar exactamente 32 bytes', 503)
}

export function encryptSensitiveData(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.')
}

export function decryptSensitiveData(value) {
  const [ivPart, tagPart, encryptedPart] = String(value).split('.')
  if (!ivPart || !tagPart || !encryptedPart) throw new AppError('No se pudieron leer los datos bancarios', 500)
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(decrypted.toString('utf8'))
}

export function maskAccount(value) {
  const digits = String(value || '').replace(/\s/g, '')
  return `•••• ${digits.slice(-4)}`
}
