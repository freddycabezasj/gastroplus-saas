// Thin data-access layer over the generic `docs` table. Mirrors the
// Firestore-like shape (collection/doc) the front-end already uses, scoped
// always by tenantId so restaurants never see each other's data.
const db = require('./db');
const { randomUUID } = require('crypto');

function list(tenantId, coleccion) {
  const rows = db.prepare('SELECT docId, data FROM docs WHERE tenantId = ? AND coleccion = ?').all(tenantId, coleccion);
  return rows.map(r => Object.assign({ id: r.docId }, JSON.parse(r.data)));
}

function get(tenantId, coleccion, docId) {
  const row = db.prepare('SELECT data FROM docs WHERE tenantId = ? AND coleccion = ? AND docId = ?').get(tenantId, coleccion, docId);
  if (!row) return null;
  return Object.assign({ id: docId }, JSON.parse(row.data));
}

function set(tenantId, coleccion, docId, data) {
  const clean = Object.assign({}, data);
  delete clean.id;
  db.prepare(`INSERT INTO docs (tenantId, coleccion, docId, data, actualizadoEn) VALUES (?,?,?,?,?)
              ON CONFLICT(tenantId, coleccion, docId) DO UPDATE SET data = excluded.data, actualizadoEn = excluded.actualizadoEn`)
    .run(tenantId, coleccion, docId, JSON.stringify(clean), new Date().toISOString());
  return Object.assign({ id: docId }, clean);
}

function update(tenantId, coleccion, docId, patch) {
  const existing = get(tenantId, coleccion, docId) || {};
  const merged = Object.assign({}, existing, patch);
  return set(tenantId, coleccion, docId, merged);
}

function add(tenantId, coleccion, data) {
  const id = randomUUID();
  return set(tenantId, coleccion, id, data);
}

function remove(tenantId, coleccion, docId) {
  db.prepare('DELETE FROM docs WHERE tenantId = ? AND coleccion = ? AND docId = ?').run(tenantId, coleccion, docId);
}

module.exports = { list, get, set, update, add, remove };
