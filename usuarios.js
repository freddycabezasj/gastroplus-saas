const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../db');
const { authMiddleware } = require('../auth');
const { ROLES } = require('../permissions');

const router = express.Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Sólo un usuario con acceso total puede gestionar usuarios.' });
  next();
}

// Lista los usuarios del restaurante del que soy admin.
router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, nombre, email, rol, activo, creadoEn FROM usuarios WHERE tenantId = ? ORDER BY creadoEn').all(req.user.tenantId);
  res.json(rows);
});

router.post('/', requireAdmin, (req, res) => {
  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password || !rol) return res.status(400).json({ error: 'campos_faltantes' });
  if (ROLES.indexOf(rol) < 0) return res.status(400).json({ error: 'rol_invalido', message: 'Rol no reconocido.' });
  const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'email_en_uso' });
  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO usuarios (id, tenantId, nombre, email, passwordHash, rol, activo, creadoEn) VALUES (?,?,?,?,?,?,1,?)')
    .run(id, req.user.tenantId, nombre, email.toLowerCase(), hash, rol, new Date().toISOString());
  res.json({ id, nombre, email: email.toLowerCase(), rol, activo: 1 });
});

router.put('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM usuarios WHERE id = ? AND tenantId = ?').get(req.params.id, req.user.tenantId);
  if (!row) return res.status(404).json({ error: 'no_encontrado' });
  const { nombre, rol, activo, password } = req.body || {};
  if (rol && ROLES.indexOf(rol) < 0) return res.status(400).json({ error: 'rol_invalido' });
  if (row.id === req.user.uid && rol && rol !== 'admin') {
    return res.status(400).json({ error: 'no_puedes_quitarte_admin', message: 'No puedes quitarte a ti mismo el rol de administrador.' });
  }
  const nextNombre = nombre != null ? nombre : row.nombre;
  const nextRol = rol != null ? rol : row.rol;
  const nextActivo = activo != null ? (activo ? 1 : 0) : row.activo;
  const nextHash = password ? bcrypt.hashSync(password, 10) : row.passwordHash;
  db.prepare('UPDATE usuarios SET nombre=?, rol=?, activo=?, passwordHash=? WHERE id=?')
    .run(nextNombre, nextRol, nextActivo, nextHash, row.id);
  res.json({ id: row.id, nombre: nextNombre, email: row.email, rol: nextRol, activo: nextActivo });
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.user.uid) return res.status(400).json({ error: 'no_puedes_eliminarte' });
  db.prepare('DELETE FROM usuarios WHERE id = ? AND tenantId = ?').run(req.params.id, req.user.tenantId);
  res.json({ ok: true });
});

module.exports = router;
