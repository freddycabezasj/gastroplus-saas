// Los 4 roles que Freddy pidió:
//   admin        -> acceso total
//   contabilidad -> solo contabilidad
//   ventas       -> solo ventas y facturación
//   produccion   -> solo recetas, mermas y producción (incluye inventario/compras)
const ROLES = ['admin', 'contabilidad', 'ventas', 'produccion'];

// Por colección: quién puede LEER y quién puede ESCRIBIR (crear/editar/borrar).
// admin siempre puede todo; no hace falta repetirlo en cada línea.
const COLLECTIONS = {
  ingredients:    { read: ['produccion'],               write: ['produccion'] },
  lots:           { read: ['produccion'],               write: ['produccion'] },
  recipes:        { read: ['produccion', 'ventas'],      write: ['produccion'] },
  clients:        { read: ['ventas'],                   write: ['ventas'] },
  products:       { read: ['ventas'],                   write: ['ventas'] },
  employees:      { read: ['contabilidad'],             write: [] },
  accounts:       { read: ['contabilidad'],             write: ['contabilidad'] },
  journal_entries:{ read: ['contabilidad'],             write: ['contabilidad'] },
  payroll_runs:   { read: ['contabilidad'],             write: [] },
  purchases:      { read: ['produccion', 'contabilidad'], write: ['produccion'] },
  invoices:       { read: ['ventas', 'contabilidad'],    write: ['ventas'] },
  mermas:         { read: ['produccion', 'contabilidad'], write: ['produccion'] },
  // settings: todos necesitan leerla (IVA, numeración, datos del negocio),
  // sólo admin la edita.
  settings:       { read: ['contabilidad', 'ventas', 'produccion'], write: [] },
};

function canRead(rol, coleccion) {
  if (rol === 'admin') return true;
  const meta = COLLECTIONS[coleccion];
  if (!meta) return false;
  return meta.read.indexOf(rol) >= 0;
}

function canWrite(rol, coleccion) {
  if (rol === 'admin') return true;
  const meta = COLLECTIONS[coleccion];
  if (!meta) return false;
  return meta.write.indexOf(rol) >= 0;
}

// Acciones compuestas (crean documentos + asientos contables a la vez):
// se permiten a quien opera ese módulo, sin necesitar acceso a Contabilidad.
const ACTIONS = {
  'invoices.emit': ['admin', 'ventas'],
  'invoices.void': ['admin', 'ventas'],
  'purchases.save': ['admin', 'produccion'],
  'purchases.void': ['admin', 'produccion'],
  'mermas.register': ['admin', 'produccion'],
  'produce.recipe': ['admin', 'produccion'],
  'payroll.run': ['admin', 'contabilidad'],
};

function canDo(rol, action) {
  if (rol === 'admin') return true;
  const allowed = ACTIONS[action];
  if (!allowed) return false;
  return allowed.indexOf(rol) >= 0;
}

module.exports = { ROLES, COLLECTIONS, canRead, canWrite, canDo };
