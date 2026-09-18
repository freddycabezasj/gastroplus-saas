# GastroPlus · edición multi-restaurante (SaaS)

Backend real (Node.js + Express + SQLite) con **multi-tenant** (cada restaurante
que se registra tiene su propia información, completamente aislada de los
demás) y **4 roles de usuario**:

- **admin** — acceso total
- **contabilidad** — sólo el módulo de Contabilidad (plan de cuentas, asientos)
- **ventas** — sólo Facturación, Clientes y Productos
- **produccion** — Recetario, Inventario, Mermas y Compras

Cada restaurante (tenant) se registra desde la pantalla "Regístralo aquí" con
un usuario administrador, y ese administrador crea desde la pestaña
**Usuarios** al resto de su personal, asignándoles el rol que corresponda.
Los permisos se validan en el servidor (no sólo se ocultan botones en
pantalla), así que un usuario de "ventas" no puede leer ni escribir
información de contabilidad aunque manipule la página.

## Cómo correrlo

```bash
npm install
npm start
```

Abre `http://localhost:3000`. La base de datos SQLite se crea sola en
`./data/gastroplus.db` la primera vez.

Variables de entorno opcionales:
- `PORT` (por defecto 3000)
- `JWT_SECRET` — **cámbialo antes de usarlo en producción** (server/auth.js
  trae uno de ejemplo)
- `DATA_DIR` — dónde vive el archivo SQLite (útil si tu hosting da un disco
  persistente en otra ruta)
- `APP_URL` — la URL pública de tu app (se usa para armar los enlaces de
  verificación de correo y recuperación de contraseña que se envían por email)
- `BACKUP_DIR`, `BACKUP_KEEP` — carpeta de respaldos y cuántos conservar
  (ver sección de respaldos)

### Correo (verificación de cuenta / recuperar contraseña)
Sin configurar, estas funciones igual funcionan: el enlace se imprime en
los logs del servidor y viaja también en la respuesta de la API marcado
como "modo desarrollo", así puedes seguir probando sin un proveedor de
correo real. Para que se envíe de verdad, configura un SMTP (por ejemplo
el de tu proveedor de correo, o servicios como Resend/SendGrid/Mailgun en
modo SMTP):
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `SMTP_SECURE=1` si tu proveedor exige TLS directo (puerto 465)

### Cobros (Stripe)
Sin configurar, el panel de "Usuarios" muestra el plan actual pero el botón
de cambiar de plan explica que los cobros aún no están activos — no rompe
nada. Para activarlos:
1. Crea una cuenta de Stripe y, en el modo que quieras (test o real), crea
   3 "Prices" recurrentes (uno por plan: básico, pro, total).
2. Configura: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_BASICO`,
   `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TOTAL`.
3. Configura un webhook en Stripe apuntando a
   `https://tu-dominio/api/billing/webhook`, eventos
   `checkout.session.completed` y `customer.subscription.deleted`, y copia
   el firmante a `STRIPE_WEBHOOK_SECRET`.

### Respaldos automáticos
El servidor hace una copia de la base al arrancar y luego cada 24h
(`server/backup.js`, usando el respaldo en caliente de SQLite — seguro con
el servidor corriendo). Se guardan en `./data/backups/` y se conservan las
últimas 14 por defecto. Si tu hosting ofrece cron de verdad, es más
confiable llamarlo desde ahí (`npm run backup`) en vez de depender del
proceso; puedes desactivar el respaldo automático interno con
`DISABLE_AUTO_BACKUP=1`.

## Desplegarlo para venderlo de verdad

Esto ya no es un artifact de Claude — es una aplicación Node normal, así que
puedes subirla a cualquier hosting que corra Node.js con disco persistente
(Render, Railway, Fly.io, un VPS propio, etc.). Pasos generales:

1. Sube esta carpeta a un repositorio (GitHub/GitLab).
2. En el hosting, comando de arranque: `npm install && npm start`.
3. Agrega un disco persistente para `./data` (si no, la base se borra en
   cada despliegue) — o cambia a Postgres si el hosting no da disco.
4. Configura `JWT_SECRET` como variable de entorno secreta.
5. Apunta tu dominio (ej. app.gastroplus.com) a ese servicio.

## Qué incluye esta versión

- Autenticación, aislamiento de datos por restaurante y roles con permisos
  reales (verificados en el servidor).
- Flujos críticos con su contabilidad automática (facturación, compras,
  mermas, producción, nómina).
- Reportes de Contabilidad completos: asientos, libro mayor por cuenta,
  balance de comprobación, estado de resultados, balance general e IVA.
- Cobros por Stripe (activable con tus propias llaves — ver arriba).
- Recuperación de contraseña y verificación de correo (funcionan sin
  configurar SMTP, en modo desarrollo — ver arriba).
- Copias de seguridad automáticas de la base de datos.
- Interfaz visual con la misma paleta e identidad tipográfica del
  GastroPlus original.

## Qué más conviene sumar antes de venderlo a gran escala

- Un plan de precios y contrato de servicio ya definidos (ver conversación
  con Claude sobre estrategia comercial) y una política de privacidad —
  revísalos con un abogado antes de cobrar en serio.
- Verificación de correo obligatoria antes de dejar operar (hoy sólo se
  avisa con un banner, no bloquea el uso).
- Migrar de SQLite a Postgres si esperas muchos restaurantes concurrentes
  o quieres alta disponibilidad real (SQLite funciona muy bien para
  decenas de restaurantes, pero un solo archivo tiene límites).

## Estructura

```
server/        API (Express) — auth, roles, datos por tenant, acciones contables
public/        Front-end (una sola página, sin frameworks)
data/          Base SQLite (se crea sola, no se sube al repo)
```
