# OLVISIÓN — Sistema de Gestión de Pedidos de Laboratorio

App web para gestión de pedidos de laboratorio óptico. Stack: HTML/CSS/JS vanilla + Supabase + Netlify.

---

## Setup paso a paso

### 1. Crear proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) → New Project
2. Elegir nombre (ej: `olvision`), contraseña fuerte, región más cercana
3. Esperar que el proyecto se inicialice (~2 min)

---

### 2. Ejecutar SQL para crear las tablas

En el **SQL Editor** de Supabase, ejecutar este script completo:

```sql
-- ═══════════════════════════════════════════════════
--  OLVISIÓN — Setup de base de datos
-- ═══════════════════════════════════════════════════

-- Tabla de pedidos
CREATE TABLE IF NOT EXISTS public.pedidos (
  id            SERIAL PRIMARY KEY,
  fecha_carga   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cliente       TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'Pedido a laboratorio',
  orden         TEXT NOT NULL,
  sufijo        TEXT,
  tipo          TEXT,
  laboratorio   TEXT,
  urgente       TEXT DEFAULT 'No',
  tipo_lente    TEXT,
  tratamiento   TEXT,
  graduacion    TEXT,
  dos_etapas    TEXT DEFAULT 'No',
  armazon       TEXT,
  fecha_pedido  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_retiro  TIMESTAMPTZ,
  cargado_por   TEXT,
  CONSTRAINT estado_valido CHECK (estado IN (
    'Pedido a laboratorio',
    'En laboratorio',
    'Pendiente de retirar',
    'Retirado'
  ))
);

-- Tabla de perfiles de usuario
CREATE TABLE IF NOT EXISTS public.perfiles (
  id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre  TEXT NOT NULL,
  rol     TEXT NOT NULL DEFAULT 'operadora',
  CONSTRAINT rol_valido CHECK (rol IN ('admin', 'operadora'))
);

-- ── Row Level Security ──────────────────────────────

-- Habilitar RLS
ALTER TABLE public.pedidos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

-- PEDIDOS: todos los autenticados pueden leer
CREATE POLICY "pedidos_select" ON public.pedidos
  FOR SELECT TO authenticated USING (true);

-- PEDIDOS: todos los autenticados pueden insertar
CREATE POLICY "pedidos_insert" ON public.pedidos
  FOR INSERT TO authenticated WITH CHECK (true);

-- PEDIDOS: actualizar estado (todos los autenticados)
CREATE POLICY "pedidos_update_estado" ON public.pedidos
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- PEDIDOS: eliminar solo admin
-- (Ver nota abajo sobre policy de delete)
CREATE POLICY "pedidos_delete_admin" ON public.pedidos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE id = auth.uid() AND rol = 'admin'
    )
  );

-- PERFILES: cada usuario puede leer su propio perfil
CREATE POLICY "perfiles_select_own" ON public.perfiles
  FOR SELECT TO authenticated USING (id = auth.uid());

-- PERFILES: solo admin puede insertar/actualizar perfiles
CREATE POLICY "perfiles_insert_admin" ON public.perfiles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfiles
      WHERE id = auth.uid() AND rol = 'admin'
    )
  );

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_orden  ON public.pedidos(orden);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha  ON public.pedidos(fecha_carga DESC);
```

---

### 3. Crear usuarios en Supabase Auth

En **Authentication → Users → Add User**:

| Email                       | Contraseña (elegir una segura) | Rol       |
|-----------------------------|-------------------------------|-----------|
| andres@olvision.com         | (asignar)                     | admin     |
| sandra@olvision.com         | (asignar)                     | operadora |
| valentina@olvision.com      | (asignar)                     | operadora |

Después de crear cada usuario, copiar el UUID que aparece y ejecutar en SQL Editor:

```sql
-- Reemplazar los UUID reales y nombres
INSERT INTO public.perfiles (id, nombre, rol) VALUES
  ('UUID-DE-ANDRES',    'Andrés',   'admin'),
  ('UUID-DE-SANDRA',    'Sandra',   'operadora'),
  ('UUID-DE-VALENTINA', 'Valentina','operadora');
```

---

### 4. Configurar config.js

1. En Supabase → **Project Settings → API**
2. Copiar: **Project URL** y **anon public key**
3. Editar `config.js`:

```js
const SUPABASE_URL      = 'https://TU_PROYECTO_ID.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...tu_clave_completa...';
```

> ⚠️ `config.js` está en `.gitignore` — **nunca lo subas al repositorio**.

---

### 5. Deployar en Netlify

#### Opción A: arrastrar y soltar
1. [app.netlify.com](https://app.netlify.com) → Sites → **Add new site → Deploy manually**
2. Arrastrar la carpeta del proyecto (incluyendo `config.js`)

#### Opción B: Git (recomendado para actualizaciones)
1. Subir el proyecto a GitHub (sin `config.js` — está en `.gitignore`)
2. En Netlify → Add new site → Import from Git → elegir el repo
3. Build settings: sin build command, directorio raíz `/`
4. Agregar variable de entorno: **no aplica** (las credenciales van en config.js estático)

> **Para producción vía Git**: usar [Netlify Environment Variables](https://docs.netlify.com/environment-variables/overview/) e inyectar config.js con un build script, o deployar config.js manualmente.

---

## Estructura de archivos

```
olvision/
├── index.html      — Pantalla de login
├── app.html        — App principal (requiere sesión)
├── config.js       — Credenciales Supabase (NO commitear)
├── style.css       — Estilos globales
├── auth.js         — Autenticación y sesión
├── pedidos.js      — CRUD y lógica de estado inteligente
├── panel.js        — KPIs y tablas del panel admin
├── .gitignore      — Excluye config.js
└── README.md       — Este archivo
```

---

## Roles y permisos

| Función                        | Operadora | Admin |
|-------------------------------|-----------|-------|
| Ver pedidos activos            | ✅        | ✅    |
| Buscar pedidos                 | ✅        | ✅    |
| Cargar pedido nuevo            | ✅        | ✅    |
| Cambiar estado                 | ✅        | ✅    |
| Ver panel KPIs                 | ❌        | ✅    |
| Ver alertas críticos/demorados | ❌        | ✅    |
| Badge de críticos              | ❌        | ✅    |

---

## Lógica de estado inteligente

| Laboratorio | ✅ OK    | ⚠️ Demorado | 🔴 Crítico |
|-------------|---------|-------------|-----------|
| Bichara     | ≤2 días | ≤4 días     | >4 días   |
| Sol         | ≤5 días | ≤7 días     | >7 días   |
| Vitolen     | ≤5 días | ≤7 días     | >7 días   |
| Cristian    | ≤7 días | ≤10 días    | >10 días  |

Los días se calculan desde `fecha_pedido` hasta hoy (o hasta `fecha_retiro` si el pedido ya fue retirado).

---

## Notas de seguridad

- El `anon key` de Supabase es público por diseño — la seguridad se garantiza con **Row Level Security (RLS)** en la base de datos
- Las contraseñas de usuarios son gestionadas 100% por Supabase Auth
- `config.js` nunca debe estar en el repositorio público
- Para restricciones más estrictas de operadoras vs. admin en el backend, se puede agregar una función de Postgres que valide el rol desde `perfiles`

---

## Soporte

Para agregar nuevos usuarios: seguir el paso 3 con el nuevo email y UUID.
Para cambiar límites de estado inteligente: editar el objeto `LIMITES` en `pedidos.js`.
