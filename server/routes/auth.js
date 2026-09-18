const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const db = require('../db');
const store = require('../store');
const { signToken, authMiddleware } = require('../auth');
const { ROLES } = require('../permissions');
const mailer = require('../email');

const router = express.Router();
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const TOKEN_TTL_MIN = { verificacion: 60 * 24, recuperacion: 60 }; // minutos

function issueToken(usuarioId, tipo) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiraEn = new Date(Date.now() + TOKEN_TTL_MIN[tipo] * 60000).toISOString();
  db.prepare('INSERT INTO tokens_usuario (id, usuarioId, tipo, tokenHash, expiraEn, creadoEn) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), usuarioId, tipo, hash, expiraEn, new Date().toISOString());
  return raw;
}
function consumeToken(raw, tipo) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = db.prepare('SELECT * FROM tokens_usuario WHERE tokenHash = ? AND tipo = ? AND usadoEn IS NULL').get(hash, tipo);
  if (!row) return null;
  if (new Date(row.expiraEn) < new Date()) return null;
  db.prepare('UPDATE tokens_usuario SET usadoEn = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return row;
}

// Crea un restaurante (tenant) nuevo con su usuario administrador.
// Este es el flujo de "alta" cuando vendes GastroPlus a un restaurante nuevo.
router.post('/registro', (req, res) => {
  const { restauranteNombre, adminNombre, email, password } = req.body || {};
  if (!restauranteNombre || !adminNombre || !email || !password) {
    return res.status(400).json({ error: 'campos_faltantes', message: 'Faltan datos del restaurante o del administrador.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'password_debil', message: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'email_en_uso', message: 'Ese correo ya está registrado.' });

  const tenantId = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO tenants (id, nombre, plan, activo, creadoEn) VALUES (?,?,?,1,?)')
    .run(tenantId, restauranteNombre, 'trial', now);

  const userId = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO usuarios (id, tenantId, nombre, email, passwordHash, rol, activo, emailVerificado, creadoEn) VALUES (?,?,?,?,?,?,1,0,?)')
    .run(userId, tenantId, adminNombre, email.toLowerCase(), hash, 'admin', now);

  var verifRaw = issueToken(userId, 'verificacion');
  mailer.sendMail(Object.assign({ to: email.toLowerCase() }, mailer.verificationEmail(adminNombre, APP_URL + '/?verificar=' + verifRaw)))
    .catch(function () {});

  // Datos base para que el restaurante arranque con algo utilizable.
  store.set(tenantId, 'settings', 'empresa', {
    razonSocial: restauranteNombre, ruc: '', direccion: '', telefono: '', email: '',
    establecimiento: '001', puntoEmision: '001', secuencialFactura: 1, ivaPct: 15,
    proximoAsiento: 1, proximaCompra: 1
  });
  store.set(tenantId, 'clients', 'consumidor-final', { nombre: 'Consumidor Final', identificacion: '9999999999999', tipoId: 'Consumidor Final', email: '', telefono: '' });

  const user = { id: userId, tenantId, nombre: adminNombre, email: email.toLowerCase(), rol: 'admin', emailVerificado: false };
  res.json({
    token: signToken(user), user, tenant: { id: tenantId, nombre: restauranteNombre },
    avisoCorreo: mailer.smtpConfigured() ? 'Te enviamos un correo para verificar tu cuenta.' : 'El envío de correo aún no está configurado en este servidor (ver README) — por ahora puedes seguir usando GastroPlus sin verificar el correo.'
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'campos_faltantes' });
  const row = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(String(email).toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.passwordHash)) {
    return res.status(401).json({ error: 'credenciales_invalidas', message: 'Correo o contraseña incorrectos.' });
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(row.tenantId);
  if (!tenant || !tenant.activo) return res.status(403).json({ error: 'restaurante_inactivo', message: 'Esta cuenta de restaurante está inactiva.' });
  const user = { id: row.id, tenantId: row.tenantId, nombre: row.nombre, email: row.email, rol: row.rol, emailVerificado: !!row.emailVerificado };
  res.json({ token: signToken(user), user, tenant: { id: tenant.id, nombre: tenant.nombre } });
});

router.get('/me', authMiddleware, (req, res) => {
  const tenant = db.prepare('SELECT id, nombre FROM tenants WHERE id = ?').get(req.user.tenantId);
  const row = db.prepare('SELECT emailVerificado FROM usuarios WHERE id = ?').get(req.user.uid);
  res.json({ user: Object.assign({}, req.user, { emailVerificado: !!(row && row.emailVerificado) }), tenant, roles: ROLES });
});

// -------- verificación de correo --------
router.post('/reenviar-verificacion', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.uid);
  if (!row) return res.status(404).json({ error: 'no_encontrado' });
  if (row.emailVerificado) return res.json({ ok: true, yaVerificado: true });
  const raw = issueToken(row.id, 'verificacion');
  mailer.sendMail(Object.assign({ to: row.email }, mailer.verificationEmail(row.nombre, APP_URL + '/?verificar=' + raw)))
    .then((r) => res.json({ ok: true, modoDesarrollo: r.modoDesarrollo, enlaceDesarrollo: r.modoDesarrollo ? (APP_URL + '/?verificar=' + raw) : undefined }))
    .catch(() => res.json({ ok: true, modoDesarrollo: true, enlaceDesarrollo: APP_URL + '/?verificar=' + raw }));
});

router.post('/verificar-correo', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'campos_faltantes' });
  const row = consumeToken(token, 'verificacion');
  if (!row) return res.status(400).json({ error: 'token_invalido', message: 'El enlace de verificación es inválido o ya venció.' });
  db.prepare('UPDATE usuarios SET emailVerificado = 1 WHERE id = ?').run(row.usuarioId);
  res.json({ ok: true });
});

// -------- recuperación de contraseña --------
router.post('/solicitar-recuperacion', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'campos_faltantes' });
  const row = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(String(email).toLowerCase());
  // Respuesta idéntica exista o no la cuenta, para no revelar qué correos están registrados.
  const generic = { ok: true, message: 'Si el correo existe, te enviamos instrucciones para recuperar tu contraseña.' };
  if (!row) return res.json(generic);
  const raw = issueToken(row.id, 'recuperacion');
  const link = APP_URL + '/?recuperar=' + raw;
  mailer.sendMail(Object.assign({ to: row.email }, mailer.resetEmail(row.nombre, link)))
    .then((r) => res.json(Object.assign({}, generic, { modoDesarrollo: r.modoDesarrollo, enlaceDesarrollo: r.modoDesarrollo ? link : undefined })))
    .catch(() => res.json(Object.assign({}, generic, { modoDesarrollo: true, enlaceDesarrollo: link })));
});

router.post('/restablecer', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'campos_faltantes' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_debil', message: 'La contraseña debe tener al menos 6 caracteres.' });
  const row = consumeToken(token, 'recuperacion');
  if (!row) return res.status(400).json({ error: 'token_invalido', message: 'El enlace de recuperación es inválido o ya venció.' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE usuarios SET passwordHash = ? WHERE id = ?').run(hash, row.usuarioId);
  res.json({ ok: true });
});

module.exports = router;
