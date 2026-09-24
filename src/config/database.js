import { PrismaClient } from '@prisma/client'

const CONNECTION_LIMIT = parseInt(process.env.DB_POOL_SIZE || '10')

const globalForPrisma = globalThis

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: { url: process.env.DATABASE_URL },
    },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export async function connectDB() {
  try {
    // $connect() solo abre el pool — no ejecuta ningún query,
    // por lo tanto no genera prepared statements y es compatible con PgBouncer.
    await prisma.$connect()
    console.log(`✅ BD conectada (pool: ${CONNECTION_LIMIT} conexiones por proceso)`)
  } catch (error) {
    console.error('❌ Error al conectar a la base de datos:', error.message)
    process.exit(1)
  }
}

export async function disconnectDB() {
  await prisma.$disconnect()
  console.log('🔌 BD desconectada')
}
