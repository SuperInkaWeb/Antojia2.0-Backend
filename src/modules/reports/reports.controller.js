import * as svc from './reports.service.js'
export const create = async (req, res) => res.status(201).json({ success: true, message: 'Reporte enviado. Te responderemos en un plazo de 24 horas.', data: await svc.create(req.user, req.body) })
export const mine = async (req, res) => res.json({ success: true, data: await svc.listMine(req.user) })
export const list = async (req, res) => res.json({ success: true, data: await svc.listForTech(req.query) })
export const answer = async (req, res) => res.json({ success: true, message: 'Respuesta guardada', data: await svc.answer(req.params.id, req.user, req.body) })
