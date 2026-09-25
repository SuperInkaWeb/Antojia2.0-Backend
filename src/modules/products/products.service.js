import { prisma } from '../../config/database.js'
import { AppError } from '../../shared/utils/appError.js'
import { deleteImageByUrl } from '../storage/uploads.service.js'

// ── Helpers ───────────────────────────────────────────────────

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  type: true,
  price: true,
  discountPct: true,
  imageUrl: true,
  isAvailable: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
}

// Calcula el precio final aplicando el descuento
export function calcFinalPrice(price, discountPct) {
  if (!discountPct || discountPct === 0) return price
  return parseFloat((price * (1 - discountPct / 100)).toFixed(2))
}

// Verifica que el restaurante le pertenece al usuario
async function checkOwnership(restaurantId, userId, role) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { ownerId: true },
  })
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404)
  if (restaurant.ownerId !== userId && role !== 'ADMIN') {
    throw new AppError('No tienes permisos sobre este restaurante', 403)
  }
  return restaurant
}

// ── Listar productos de un restaurante ───────────────────────
export async function listByRestaurant(restaurantId, { type } = {}) {
  const products = await prisma.product.findMany({
    where: {
      restaurantId,
      ...(type && { type }),
    },
    select: {
      ...PRODUCT_SELECT,
      restaurantId: true,
    },
    orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
  })

  // Agregar precio final calculado
  return products.map(p => ({
    ...p,
    finalPrice: calcFinalPrice(p.price, p.discountPct),
  }))
}

// ── Detalle de un producto ────────────────────────────────────
export async function getOne(id) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      ...PRODUCT_SELECT,
      restaurantId: true,
      restaurant: { select: { id: true, name: true, status: true } },
    },
  })

  if (!product) throw new AppError('Producto no encontrado', 404)

  return {
    ...product,
    finalPrice: calcFinalPrice(product.price, product.discountPct),
  }
}

// ── Crear producto ────────────────────────────────────────────
export async function create(restaurantId, userId, role, body) {
  await checkOwnership(restaurantId, userId, role)

  const {
    name, description, type,
    price, discountPct, categoryId, imageUrl,
  } = body

  if (!name || !type || !price) {
    throw new AppError('Los campos name, type y price son requeridos', 400)
  }

  if (!['DISH', 'DRINK', 'COMBO'].includes(type)) {
    throw new AppError('El tipo debe ser DISH, DRINK o COMBO', 400)
  }

  if (price <= 0) {
    throw new AppError('El precio debe ser mayor a 0', 400)
  }

  if (discountPct && (discountPct < 0 || discountPct > 100)) {
    throw new AppError('El descuento debe estar entre 0 y 100', 400)
  }

  // Si tiene categoryId verificar que pertenece al restaurante. Cuando el
  // formulario no envía una categoría, usar/crear una categoría general para
  // que el producto también sea visible en el menú público.
  let resolvedCategoryId = categoryId || null
  if (resolvedCategoryId) {
    const cat = await prisma.productCategory.findFirst({
      where: { id: resolvedCategoryId, restaurantId },
    })
    if (!cat) throw new AppError('Categoría no encontrada en este restaurante', 404)
  } else {
    let defaultCategory = await prisma.productCategory.findFirst({
      where: { restaurantId, name: 'Menú' },
      select: { id: true },
    })

    if (!defaultCategory) {
      const lastCategory = await prisma.productCategory.findFirst({
        where: { restaurantId },
        orderBy: { order: 'desc' },
        select: { order: true },
      })
      defaultCategory = await prisma.productCategory.create({
        data: {
          restaurantId,
          name: 'Menú',
          order: (lastCategory?.order ?? -1) + 1,
        },
        select: { id: true },
      })
    }

    resolvedCategoryId = defaultCategory.id
  }

  const product = await prisma.product.create({
    data: {
      name,
      description: description || null,
      type,
      price,
      discountPct: discountPct || 0,
      categoryId:  resolvedCategoryId,
      imageUrl:    imageUrl    || null,
      isAvailable: true,
      restaurantId,
    },
    select: PRODUCT_SELECT,
  })

  return {
    ...product,
    finalPrice: calcFinalPrice(product.price, product.discountPct),
  }
}

// ── Actualizar producto ───────────────────────────────────────
export async function update(id, userId, role, body) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { restaurantId: true, imageUrl: true },
  })
  if (!product) throw new AppError('Producto no encontrado', 404)

  await checkOwnership(product.restaurantId, userId, role)

  const { name, description, type, price, categoryId, imageUrl } = body

  if (price !== undefined && price <= 0) {
    throw new AppError('El precio debe ser mayor a 0', 400)
  }

  if (categoryId !== undefined && categoryId !== null) {
    const category = await prisma.productCategory.findFirst({
      where: { id: categoryId, restaurantId: product.restaurantId },
      select: { id: true },
    })
    if (!category) throw new AppError('Categoría no encontrada en este restaurante', 404)
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(name        !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(type        !== undefined && { type }),
      ...(price       !== undefined && { price }),
      ...(categoryId  !== undefined && { categoryId }),
      ...(imageUrl    !== undefined && { imageUrl }),
    },
    select: PRODUCT_SELECT,
  })

  if (imageUrl !== undefined && product.imageUrl && product.imageUrl !== imageUrl) {
    try {
      await deleteImageByUrl(product.imageUrl)
    } catch (error) {
      console.warn('No se pudo eliminar la imagen anterior del producto en Cloudinary:', error.message)
    }
  }

  return {
    ...updated,
    finalPrice: calcFinalPrice(updated.price, updated.discountPct),
  }
}

// ── Aplicar descuento ─────────────────────────────────────────
export async function applyDiscount(id, userId, role, discountPct) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { restaurantId: true, price: true },
  })
  if (!product) throw new AppError('Producto no encontrado', 404)

  await checkOwnership(product.restaurantId, userId, role)

  if (discountPct < 0 || discountPct > 100) {
    throw new AppError('El descuento debe estar entre 0 y 100', 400)
  }

  const updated = await prisma.product.update({
    where: { id },
    data: { discountPct },
    select: PRODUCT_SELECT,
  })

  return {
    ...updated,
    finalPrice: calcFinalPrice(updated.price, updated.discountPct),
  }
}

// ── Habilitar / deshabilitar ──────────────────────────────────
export async function setAvailability(id, userId, role, requestedAvailability) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { restaurantId: true, isAvailable: true },
  })
  if (!product) throw new AppError('Producto no encontrado', 404)

  await checkOwnership(product.restaurantId, userId, role)

  const isAvailable = typeof requestedAvailability === 'boolean'
    ? requestedAvailability
    : !product.isAvailable

  const updated = await prisma.product.update({
    where: { id },
    data: { isAvailable },
    select: PRODUCT_SELECT,
  })

  return {
    ...updated,
    finalPrice: calcFinalPrice(updated.price, updated.discountPct),
  }
}

// ── Eliminar producto ─────────────────────────────────────────
export async function remove(id, userId, role) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { restaurantId: true },
  })
  if (!product) throw new AppError('Producto no encontrado', 404)

  await checkOwnership(product.restaurantId, userId, role)

  await prisma.product.delete({ where: { id } })
}
