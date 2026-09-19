import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'

const audienceForRole = { RESTAURANT_OWNER: 'RESTAURANT', CONSUMER: 'CONSUMER', DELIVERY: 'DELIVERY' }
const select = { id: true, audience: true, category: true, description: true, status: true, response: true, answeredAt: true, createdAt: true, updatedAt: true, author: { select: { id: true, name: true, email: true, role: true } }, answeredBy: { select: { id: true, name: true, email: true } } }

export async function create(user, { category, description }) {
  const audience = audienceForRole[user.role]
  if (!audience) throw new AppError('Este tipo de cuenta no puede enviar reportes', 403)
  if (!category || !String(description || '').trim()) throw new AppError('La categoría y la descripción son obligatorias', 400)
  return prisma.supportReport.create({ data: { audience, category: String(category), description: String(description).trim(), authorId: user.id }, select })
}

export async function listMine(user) {
  return prisma.supportReport.findMany({ where: { authorId: user.id }, orderBy: { createdAt: 'desc' }, select })
}

export async function listForTech({ audience, category, from, to, status }) {
  const createdAt = {}
  if (from) createdAt.gte = new Date(`${from}T00:00:00.000Z`)
  if (to) { const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); createdAt.lt = end }
  const statusWhere = status === 'PENDING'
    ? { status: { in: ['OPEN', 'IN_PROGRESS'] }, response: null }
    : status === 'RESOLVED'
      ? { OR: [{ status: 'RESOLVED' }, { response: { not: null } }] }
      : status ? { status } : {}
  const reports = await prisma.supportReport.findMany({ where: { ...(audience && { audience }), ...(category && { category }), ...statusWhere, ...(Object.keys(createdAt).length ? { createdAt } : {}) }, orderBy: { createdAt: 'desc' }, select })
  return reports.map(report => report.response && report.status !== 'RESOLVED' ? { ...report, status: 'RESOLVED' } : report)
}

export async function answer(id, tech, { response, status = 'RESOLVED' }) {
  if (!String(response || '').trim()) throw new AppError('La respuesta es obligatoria', 400)
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) throw new AppError('Estado inválido', 400)
  return prisma.supportReport.update({ where: { id }, data: { response: String(response).trim(), status: 'RESOLVED', answeredAt: new Date(), answeredById: tech.id }, select })
}
