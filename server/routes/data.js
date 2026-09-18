const express = require('express');
const store = require('../store');
const { authMiddleware } = require('../auth');
const { canRead, canWrite, COLLECTIONS } = require('../permissions');

const router = express.Router();
router.use(authMiddleware);

function checkCollection(req, res, next) {
  const { coleccion } = req.params;
  if (!COLLECTIONS[coleccion]) return res.status(404).json({ error: 'coleccion_desconocida' });
  next();
}

router.get('/:coleccion', checkCollection, (req, res) => {
  if (!canRead(req.user.rol, req.params.coleccion)) return res.status(403).json({ error: 'forbidden', message: 'Tu rol no tiene acceso de lectura a este módulo.' });
  res.json(store.list(req.user.tenantId, req.params.coleccion));
});

router.get('/:coleccion/:id', checkCollection, (req, res) => {
  if (!canRead(req.user.rol, req.params.coleccion)) return res.status(403).json({ error: 'forbidden' });
  const doc = store.get(req.user.tenantId, req.params.coleccion, req.params.id);
  if (!doc) return res.status(404).json({ error: 'no_encontrado' });
  res.json(doc);
});

router.post('/:coleccion', checkCollection, (req, res) => {
  if (!canWrite(req.user.rol, req.params.coleccion)) return res.status(403).json({ error: 'forbidden', message: 'Tu rol no tiene acceso de escritura a este módulo.' });
  const doc = store.add(req.user.tenantId, req.params.coleccion, req.body || {});
  res.json(doc);
});

router.put('/:coleccion/:id', checkCollection, (req, res) => {
  if (!canWrite(req.user.rol, req.params.coleccion)) return res.status(403).json({ error: 'forbidden' });
  const doc = store.set(req.user.tenantId, req.params.coleccion, req.params.id, req.body || {});
  res.json(doc);
});

router.patch('/:coleccion/:id', checkCollection, (req, res) => {
  if (!canWrite(req.user.rol, req.params.coleccion)) return res.status(403).json({ error: 'forbidden' });
  const doc = store.update(req.user.tenantId, req.params.coleccion, req.params.id, req.body || {});
  res.json(doc);
});

router.delete('/:coleccion/:id', checkCollection, (req, res) => {
  if (!canWrite(req.user.rol, req.params.coleccion)) return res.status(403).json({ error: 'forbidden' });
  store.remove(req.user.tenantId, req.params.coleccion, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
