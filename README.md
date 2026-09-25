# 🍽️ Antojia — Backend

API REST del marketplace gastronómico **Antojia**, construida con Node.js, Express y Prisma sobre PostgreSQL alojado en Neon.

---

## 🛠️ Stack tecnológico

| Tecnología | Versión | Uso |
|---|---|---|
| Node.js | ≥ 18 | Runtime |
| Express | 4.x | Framework HTTP |
| Prisma | 6.x | ORM / migraciones |
| PostgreSQL | 15 | Base de datos (Neon) |
| Auth0 | — | Autenticación JWT |
| Cloudinary | — | Almacenamiento y transformación de imágenes |
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
- Cuenta en [Neon](https://neon.tech)
- Cuenta en [Cloudinary](https://cloudinary.com)
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
# Base de datos — Neon
# DATABASE_URL usa el endpoint pooler de Neon para la aplicación.
# DIRECT_URL usa el endpoint directo para migraciones Prisma.
DATABASE_URL="postgresql://<usuario>:<password>@<neon-pooler-host>/<base>?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://<usuario>:<password>@<neon-direct-host>/<base>?sslmode=require&channel_binding=require"

# Auth0
AUTH0_DOMAIN=dev-xxxx.us.auth0.com
AUTH0_AUDIENCE=https://tu-api-identifier

# Cloudinary (solo backend; nunca exponer el API secret al frontend)
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

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
base de datos y las imágenes continúan alojadas en servicios gestionados: Neon y
Cloudinary. Compose lee
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

Configura estas variables en el apartado **Environment** del servicio
`xxxxxxxxx`. Los valores sensibles se indican como
`<configurar-en-Render>` y no deben guardarse en este README ni en Git.

| Variable | Valor o referencia | Uso |
|---|---|---|
| `ADMIN_EMAIL` | `xxxxxxxxx` | Correo autorizado para el rol administrador |
| `AUTH0_AUDIENCE` | `https://xxxxxxxxx` | Audience del API en Auth0 |
| `AUTH0_DOMAIN` | `dev-xxxxxxxxx.us.auth0.com` | Dominio del tenant Auth0 |
| `BACKEND_URL` | `https://xxxxxxxxx.onrender.com` | URL pública del backend |
| `CLOUDINARY_CLOUD_NAME` | `xxxxxxxxx` | Cloud de imágenes |
| `CLOUDINARY_API_KEY` | `<configurar-en-Render>` | Credencial de Cloudinary |
| `CLOUDINARY_API_SECRET` | `<configurar-en-Render>` | Secreto de Cloudinary |
| `DATABASE_URL` | `<URL pooler de Neon>` | Conexión de la aplicación |
| `DB_POOL_SIZE` | `10` | Límite del pool de Prisma |
| `DIRECT_URL` | `<URL directa de Neon>` | Conexión directa para Prisma |
| `FRONTEND_URL` | `https://xxxxxxxxx.vercel.app` | Origen permitido por CORS y URLs de retorno |
| `MERCADOPAGO_ACCESS_TOKEN` | `<configurar-en-Render>` | Token de Checkout Pro de producción; habilita cobros reales |
| `MERCADOPAGO_TEST_ACCESS_TOKEN` | `<configurar-en-Render>` | Token de Checkout Pro de pruebas |
| `MERCADOPAGO_WEBHOOK_SECRET` | `<configurar-en-Render>` | Validación de webhooks de Mercado Pago |
| `NODE_ENV` | `production` | Entorno de ejecución |
| `SUNAT_MOCK_ENABLED` | `true` | Usa la respuesta simulada de SUNAT |
| `WEB_CONCURRENCY` | `1` | Número de workers del proceso Node |
| `WITHDRAWAL_DATA_ENCRYPTION_KEY` | `<configurar-en-Render>` | Cifrado de datos sensibles de retiros |

`DATABASE_URL` debe usar el endpoint **pooler** de Neon y `DIRECT_URL` el
endpoint **directo**, ambos con `sslmode=require&channel_binding=require`.
Conserva estable `WITHDRAWAL_DATA_ENCRYPTION_KEY`: cambiarla impide descifrar
solicitudes almacenadas anteriormente.

Las credenciales que no estén configuradas no deben inventarse. Por ejemplo,
`MERCADOPAGO_ACCESS_TOKEN` solo debe añadirse si se habilitan cobros de
producción; `SUNAT_API_URL` y `SUNAT_API_TOKEN` solo son necesarios cuando
`SUNAT_MOCK_ENABLED=false`.

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
