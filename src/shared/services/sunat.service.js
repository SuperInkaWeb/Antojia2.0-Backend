import axios from 'axios'
import { AppError } from '../utils/appError.js'

export function validateRucFormat(ruc) {
  if (!/^\d{11}$/.test(ruc)) return false
  const prefix = parseInt(ruc.substring(0, 2))
  return [10, 15, 17, 20].includes(prefix)
}

/**
 * Normaliza la respuesta de ApiPeruDev y conserva compatibilidad con
 * respuestas de proveedores anteriores.
 */
function normalizeRucData(responseData) {
  // Algunos proveedores envuelven en { data: {...} }, otros devuelven el objeto directo.
  const raw = responseData?.data ?? responseData

  if (!raw) return null

  const razonSocial =
    raw.razonSocial           ??   // apis.net.pe (razonSocial directo)
    raw.nombre_o_razon_social ??   // apiperu.dev, json.pe, decolecta
    raw.razon_social          ??   // peruapi.com, apidni.com
    raw.nombre                ??   // apis.net.pe (campo antiguo)
    null

  // Campo "estado" puede llamarse "activo" en algunos proveedores
  const estado = raw.estado ?? raw.activo ?? null
  const condicion = raw.condicion ?? null

  if (!razonSocial && !estado) return null

  return { razonSocial, estado, condicion }
}

export async function verifyRuc(ruc) {
  if (!validateRucFormat(ruc)) {
    throw new AppError('Formato de RUC inválido. Debe tener 11 dígitos y comenzar con 10, 15, 17 ó 20.', 400, 'INVALID_RUC_FORMAT')
  }

  // El mock solo se activa de forma explícita. Nunca debe quedar habilitado
  // en Render/producción porque permitiría registrar RUC ficticios.
  const mockEnabled = process.env.SUNAT_MOCK_ENABLED?.toLowerCase() === 'true'
  if (mockEnabled) {
    return {
      ruc,
      razonSocial: `EMPRESA DE PRUEBA ${ruc} SAC`,
      estado: 'ACTIVO',
      condicion: 'HABIDO',
      mock: true,
    }
  }

  // ApiPeruDev es el proveedor principal. La URL es configurable para poder
  // cambiar de entorno/proveedor sin tocar el código, pero tiene un valor
  // seguro por defecto según su documentación oficial.
  const apiUrl = process.env.APIPERUDEV_API_URL || process.env.SUNAT_API_URL || 'https://api.apiperu.dev/ruc'
  // SUNAT_API_TOKEN se conserva como fallback para no romper un despliegue
  // existente mientras se migra a APIPERUDEV_API_TOKEN.
  const apiToken = process.env.APIPERUDEV_API_TOKEN || process.env.SUNAT_API_TOKEN

  if (!apiToken) {
    throw new AppError('Servicio de consulta RUC no configurado.', 503, 'SUNAT_NOT_CONFIGURED')
  }

  try {
    const response = await axios.post(
      process.env.SUNAT_API_URL,
      { ruc },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      }
    )

    const data = normalizeRucData(response.data)

    if (response.data?.success === false || !data || !data.razonSocial) {
      const providerCode = response.data?.code
      if (providerCode === 'document_not_found') {
        throw new AppError('RUC no encontrado en SUNAT', 404, 'RUC_NOT_FOUND')
      }
      throw new AppError(response.data?.message || 'RUC no encontrado en SUNAT', 404, 'RUC_NOT_FOUND')
    }

    if (data.estado && data.estado !== 'ACTIVO') {
      throw new AppError(`RUC no activo (estado: ${data.estado})`, 400, 'RUC_INACTIVE')
    }
    if (data.condicion && data.condicion !== 'HABIDO') {
      throw new AppError(`RUC con condición ${data.condicion}`, 400, 'RUC_CONDITION')
    }

    return { ruc, razonSocial: data.razonSocial, estado: data.estado ?? 'ACTIVO', condicion: data.condicion ?? 'HABIDO' }
  } catch (error) {
    if (error instanceof AppError) throw error

    // Log completo en servidor para poder diagnosticar (no se envía al cliente)
    console.error('[sunat.service] Error al consultar RUC:', {
      ruc,
      url: apiUrl,
      status: error.response?.status,
      providerCode: error.response?.data?.code,
      message: error.message,
      code: error.code,
    })

    const providerStatus = error.response?.status
    const providerCode = error.response?.data?.code

    if (providerCode === 'invalid_input' || providerStatus === 400) {
      throw new AppError(error.response?.data?.message || 'La API rechazó el RUC enviado.', 400, 'RUC_PROVIDER_INVALID')
    }
    if (providerStatus === 401) {
      throw new AppError('El token de ApiPeruDev no es válido.', 503, 'SUNAT_AUTH_ERROR')
    }
    if (providerStatus === 404 || providerCode === 'document_not_found') {
      throw new AppError('RUC no encontrado en SUNAT', 404, 'RUC_NOT_FOUND')
    }

    const msg = providerStatus
      ? `ApiPeruDev respondió con error ${providerStatus}`
      : 'No se pudo conectar con ApiPeruDev. Intenta más tarde.'
    throw new AppError(msg, 503, 'SUNAT_ERROR')
  }
}
