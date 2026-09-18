const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'gastroplus.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  plan TEXT DEFAULT 'trial',
  activo INTEGER DEFAULT 1,
  creadoEn TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  rol TEXT NOT NULL, -- admin | contabilidad | ventas | produccion
  activo INTEGER DEFAULT 1,
  emailVerificado INTEGER DEFAULT 0,
  creadoEn TEXT NOT NULL,
  UNIQUE(tenantId, email)
);

-- tokens de un solo uso para verificar correo y para restablecer contraseña
CREATE TABLE IF NOT EXISTS tokens_usuario (
  id TEXT PRIMARY KEY,
  usuarioId TEXT NOT NULL,
  tipo TEXT NOT NULL, -- 'verificacion' | 'recuperacion'
  tokenHash TEXT NOT NULL,
  expiraEn TEXT NOT NULL,
  usadoEn TEXT,
  creadoEn TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_usuario ON tokens_usuario (usuarioId, tipo);

-- generic per-tenant document store, mirrors the collection/doc shape the
-- GastroPlus front-end already speaks (ingredients, recipes, lots, clients,
-- products, invoices, mermas, purchases, employees, payroll_runs, accounts,
-- journal_entries, settings)
CREATE TABLE IF NOT EXISTS docs (
  tenantId TEXT NOT NULL,
  coleccion TEXT NOT NULL,
  docId TEXT NOT NULL,
  data TEXT NOT NULL,
  actualizadoEn TEXT NOT NULL,
  PRIMARY KEY (tenantId, coleccion, docId)
);
CREATE INDEX IF NOT EXISTS idx_docs_tenant_col ON docs (tenantId, coleccion);
`);

module.exports = db;
