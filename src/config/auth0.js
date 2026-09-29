import { auth } from 'express-oauth2-jwt-bearer'

export const verifyToken = auth({
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  audience: process.env.AUTH0_AUDIENCE,
})

// Auth0 exige un namespace para los claims personalizados incluidos en
// access tokens destinados a una API. Mantener la lectura aquí evita que
// cada middleware tenga que conocer el formato exacto del token.
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

// Auth0 no incluye necesariamente email/name/picture en el access token de
// una API. Primero leemos claims directos y namespaced; si no existen,
// consultamos /userinfo usando el mismo token ya validado por el middleware.
export async function getIdentityClaims(payload, accessToken) {
  const audience  = String(process.env.AUTH0_AUDIENCE || '').replace(/\/$/, '')
  const namespace = `${audience}/`
  const direct = {
    email: normalizeEmail(payload.email || payload[`${namespace}email`]),
    name: payload.name || payload[`${namespace}name`] || '',
    picture: payload.picture || payload[`${namespace}picture`] || null,
  }

  if (direct.email || !accessToken || !process.env.AUTH0_DOMAIN) return direct

  try {
    const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return direct
    const profile = await response.json()
    return {
      email: normalizeEmail(profile.email) || direct.email,
      name: profile.name || direct.name,
      picture: profile.picture || direct.picture,
    }
  } catch {
    return direct
  }
}
