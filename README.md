# 🍽️ Antojia — Backend

API REST del marketplace gastronómico **Antojia**, construida con Node.js, Express y Prisma sobre PostgreSQL (Supabase).

---

## 🛠️ Stack tecnológico

| Tecnología | Versión | Uso |
|---|---|---|
| Node.js | ≥ 18 | Runtime |
| Express | 4.x | Framework HTTP |
| Prisma | 6.x | ORM / migraciones |
| PostgreSQL | 15 | Base de datos (Supabase) |
| Auth0 | — | Autenticación JWT |
| Helmet | 7.x | Seguridad HTTP |
| express-rate-limit | 7.x | Rate limiting |
| compression | 1.x | Compresión gzip |
| Morgan | 1.x | Logging HTTP |

---

## 📁 Estructura del proyecto

```
backend/
├── prisma/
│   ├── schema.prisma        # Modelos de la BD
│   ├── seed.js              # Datos iniciales
│   └── seed_full.js         # Seed completo (15 restaurantes + 20 repartidores)
├── src/
│   ├── app.js               # Configuración Express (middlewares, rutas)
│   ├── server.js            # Entrada principal + cluster
│   ├── config/
│   │   ├── database.js      # Cliente Prisma + connection pool (compatible PgBouncer)
│   │   ├── auth0.js         # Verificación de tokens Auth0
│   │   └── cache.js         # Cache en memoria (user sessions)
│   ├── middleware/
│   │   └── auth.middleware.js  # authenticate + authorize + loadUser
│   ├── modules/
│   │   ├── auth/            # Gestión de usuarios y roles
│   │   ├── restaurants/     # CRUD restaurantes + categorías
│   │   ├── products/        # CRUD productos del menú
│   │   ├── orders/          # Pedidos delivery y reservas
│   │   ├── payments/        # Procesamiento de pagos
│   │   ├── drivers/         # Repartidores y asignación
│   │   └── admin/           # Panel administrativo
│   └── shared/
│       └── utils/           # AppError, helpers
└── package.json
```

---

## 🚀 Instalación y desarrollo

### 1. Requisitos previos
- Node.js ≥ 18
- Cuenta en [Supabase](https://supabase.com)
- Cuenta en [Auth0](https://auth0.com)

### 2. Instalar dependencias
```bash
git clone <repo>
cd backend
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env
```

```env
# Base de datos — Transaction Pooler de Supabase (puerto 6543, NO 5432)
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
DIRECT_URL="postgresql://postgres.[ref]:[password]@[db-host].supabase.co:5432/postgres?sslmode=require"

# Auth0
AUTH0_DOMAIN=dev-xxxx.us.auth0.com
AUTH0_AUDIENCE=https://tu-api-identifier

# Servidor
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:4000

# Cuenta central de Mercado Pago (cobros reales)
MERCADOPAGO_ACCESS_TOKEN=tu_access_token_de_produccion
MERCADOPAGO_WEBHOOK_SECRET=tu_firma_secreta_del_webhook

# Checkout Pro sandbox (opcional, habilita el botón de prueba)
MERCADOPAGO_TEST_ACCESS_TOKEN=tu_access_token_de_prueba
WITHDRAWAL_DATA_ENCRYPTION_KEY=64_caracteres_hexadecimales_aleatorios

# Solo para pruebas sin proveedor real de SUNAT
SUNAT_MOCK_ENABLED=true
```

> ⚠️ El parámetro `pgbouncer=true` es obligatorio. Sin él Prisma usa prepared statements que PgBouncer no soporta y el servidor lanza el error `42P05`.

### 4. Inicializar la base de datos
```bash
npm run db:push       # Crear tablas
npm run db:seed       # Datos básicos
node prisma/seed_full.js  # 15 restaurantes + 20 repartidores
```

### 5. Correr en desarrollo
```bash
npm run dev
```
El servidor inicia en `http://localhost:4000`

---

## 📡 Endpoints principales

Base URL: `http://localhost:4000/api/v1`

| Módulo | Base | Descripción |
|---|---|---|
| Auth | `/auth` | Perfil, sincronización, registro de restaurante |
| Restaurantes | `/restaurants` | CRUD + verificación RUC |
| Productos | `/products` | Menú del restaurante |
| Pedidos | `/orders` | Delivery y reservas |
| Pagos | `/payments` | Culqi, Yape, efectivo |
| Repartidores | `/drivers` | Pedidos, ubicación, vehículo |
| Admin | `/admin` | Panel de gestión completo |
| Health | `/health` | Estado del servidor |

---

## 🐳 Ejecución con Docker

El archivo `docker-compose.yaml` levanta el backend y el frontend juntos. La
base de datos continúa alojada en Neon y las imágenes en Supabase; Compose lee
las variables existentes de los archivos `.env` de ambos repositorios.

### Requisito

- Docker Desktop con Docker Compose v2

### Iniciar el proyecto

Ejecuta desde la carpeta `FOODINKA-BACKEND`:

```powershell
docker compose --env-file "..\FOODINKA-FRONTEND\.env" up --build
```

Genera `WITHDRAWAL_DATA_ENCRYPTION_KEY` con `openssl rand -hex 32`; usa una clave distinta en desarrollo y producción, y conserva cada clave estable en su entorno. Cambiarla impide descifrar las solicitudes anteriores de ese entorno.

Servicios disponibles:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`
- Health check: `http://localhost:4000/health`

Para detenerlos:

```powershell
docker compose down
```

Los archivos `.env` no se copian dentro de las imágenes. Las variables
`VITE_*` se incorporan al frontend durante la etapa de compilación porque Vite
genera archivos estáticos.

---

## 🔑 Roles

| Rol | Acceso |
|---|---|
| `CONSUMER` | Crear pedidos, historial, perfil |
| `RESTAURANT_OWNER` | CRUD menú, gestionar pedidos entrantes |
| `DELIVERY` | Pedidos disponibles, ubicación, vehículo |
| `ADMIN` | Acceso completo |

---

## ⚡ Scripts

```bash
npm run dev          # Desarrollo con hot-reload
npm run start        # Producción
npm run db:push      # Aplicar schema
npm run db:seed      # Seed básico
npm run db:studio    # Prisma Studio (GUI de BD)
npm run db:generate  # Regenerar cliente Prisma
npm run db:reset     # Reset completo + seed
```

---

## 🚢 Despliegue en producción (Render)

### Variables de entorno en Render

```env
DATABASE_URL=postgresql://...?pgbouncer=true&connection_limit=10
DIRECT_URL=postgresql://...:5432/postgres?sslmode=require
AUTH0_DOMAIN=dev-xxxx.us.auth0.com
AUTH0_AUDIENCE=https://tu-api-identifier
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://tu-app.netlify.app
BACKEND_URL=https://tu-backend.onrender.com
DB_POOL_SIZE=10
WEB_CONCURRENCY=1
MERCADOPAGO_ACCESS_TOKEN=tu_access_token_de_produccion
MERCADOPAGO_WEBHOOK_SECRET=tu_firma_secreta_del_webhook
MERCADOPAGO_TEST_ACCESS_TOKEN=tu_access_token_de_prueba
WITHDRAWAL_DATA_ENCRYPTION_KEY=64_caracteres_hexadecimales_aleatorios
SUNAT_MOCK_ENABLED=true
```

> ⚠️ Render asigna el puerto automáticamente vía `process.env.PORT`. No uses un puerto fijo en producción.

### Si Render despliega con Docker

Selecciona el `Dockerfile` del repositorio. El contenedor ejecuta `npx prisma migrate deploy` antes de iniciar la API; no hace falta añadir un comando de arranque ni ejecutar la migración manualmente. En cada arranque solo aplica migraciones pendientes y registra el historial en `_prisma_migrations`, sin borrar los datos existentes.

### Si Render despliega como servicio Node

Configura estos comandos una sola vez. El comando de migraciones se ejecuta al arrancar, pero solo aplica cambios pendientes.

Build command:
```
npm install --include=dev && npx prisma generate
```

Start command:
```
npm run db:migrate && npm start
```

---

## 📄 Licencia

Qoribex — Antojia © 2025
