// Motor de negocio y contabilidad de GastroPlus, portado tal cual del
// artifact original (recetario.html) para que el servidor calcule y
// contabilice de forma confiable, sin depender del cliente.
const store = require('./store');

const CTA_CAJA = '1.1.01';
const CTA_BANCOS = '1.1.02';
const CTA_CXC_CLIENTES = '1.1.03';
const CTA_INVENTARIO = '1.1.04';
const CTA_IVA_CREDITO = '1.1.05';
const CTA_CXP_PROVEEDORES = '2.1.01';
const CTA_IVA_POR_PAGAR = '2.1.02';
const CTA_VENTAS = '4.1.01';
const CTA_COSTO_VENTAS = '5.1.01';
const CTA_COSTO_MERMAS = '5.1.02';
const CTA_GASTOS_SUELDOS = '6.1.01';
const CTA_GASTOS_GENERALES = '6.1.02';

function todayISO() { return new Date().toISOString().slice(0, 10); }

function cuentaCobroPorFormaPago(fp) {
  if (fp === 'Efectivo') return CTA_CAJA;
  if (fp === 'Tarjeta de crédito/débito') return CTA_BANCOS;
  if (fp === 'Transferencia') return CTA_BANCOS;
  return CTA_CXC_CLIENTES;
}
function cuentaPagoCompra(fp) {
  if (fp === 'Efectivo') return CTA_CAJA;
  if (fp === 'Transferencia') return CTA_BANCOS;
  return CTA_CXP_PROVEEDORES;
}

function computeInvoiceTotals(items) {
  var subtotal = 0, ivaTotal = 0;
  (items || []).forEach(function (it) {
    var lineBase = Number(it.precioUnitario || 0) * Number(it.cantidad || 0) * (1 - (Number(it.descuentoPct) || 0) / 100);
    var lineIva = lineBase * (Number(it.ivaPct) || 0) / 100;
    subtotal += lineBase; ivaTotal += lineIva;
  });
  return { subtotal: subtotal, ivaTotal: ivaTotal, total: subtotal + ivaTotal };
}

function purchaseTotals(items, ivaPct) {
  var subtotal = (items || []).reduce(function (s, it) { return s + Number(it.cantidad || 0) * Number(it.costoUnitario || 0); }, 0);
  var ivaValor = subtotal * (Number(ivaPct) || 0) / 100;
  return { subtotal: subtotal, ivaValor: ivaValor, total: subtotal + ivaValor };
}

function costoLinea(ing, cantidad) {
  if (!ing) return 0;
  var merma = (Number(ing.mermaPct) || 0) / 100;
  var factor = 1 - merma;
  if (factor <= 0) factor = 0.01;
  return (Number(ing.costoUnitario) || 0) * Number(cantidad || 0) / factor;
}

function recipeCosts(rec, ivaPct) {
  var total = 0;
  (rec.ingredientes || []).forEach(function (it) {
    var ing = ingById(rec.__tenantId, it.ingredienteId);
    total += costoLinea(ing, it.cantidad);
  });
  var porciones = Number(rec.porcionesBase) || 1;
  var costoPorcion = total / porciones;
  var fc = (Number(rec.foodCostObjetivo) || 30) / 100;
  var pvpSugerido = costoPorcion / fc;
  var pvpFinal = rec.pvpManual != null && rec.pvpManual !== '' ? Number(rec.pvpManual) : pvpSugerido;
  return { total: total, costoPorcion: costoPorcion, pvpSugerido: pvpSugerido, pvpFinal: pvpFinal };
}

function ingById(tenantId, id) { return store.get(tenantId, 'ingredients', id); }
function recById(tenantId, id) { return store.get(tenantId, 'recipes', id); }
function clientById(tenantId, id) { return store.get(tenantId, 'clients', id); }
function purById(tenantId, id) { return store.get(tenantId, 'purchases', id); }
function invById(tenantId, id) { return store.get(tenantId, 'invoices', id); }

function lotsForIng(tenantId, ingredienteId) {
  return store.list(tenantId, 'lots')
    .filter(function (l) { return l.ingredienteId === ingredienteId; })
    .sort(function (a, b) { return (a.fechaVencimiento || '9999').localeCompare(b.fechaVencimiento || '9999'); });
}
function stockFor(tenantId, ingredienteId) {
  return lotsForIng(tenantId, ingredienteId).reduce(function (s, l) { return s + Number(l.cantidad || 0); }, 0);
}

// Descuenta `qty` tomando primero los lotes más próximos a vencer (FIFO).
function deductStock(tenantId, ingredienteId, qty) {
  var lots = lotsForIng(tenantId, ingredienteId);
  var remaining = qty;
  for (var j = 0; j < lots.length && remaining > 1e-9; j++) {
    var lot = lots[j];
    var take = Math.min(lot.cantidad, remaining);
    remaining -= take;
    var newQty = Math.round((lot.cantidad - take) * 1000) / 1000;
    if (newQty <= 0.001) store.remove(tenantId, 'lots', lot.id);
    else store.update(tenantId, 'lots', lot.id, { cantidad: newQty });
  }
  return Math.max(0, remaining);
}

function getSettings(tenantId) {
  return store.get(tenantId, 'settings', 'empresa') || { ivaPct: 15, proximoAsiento: 1, proximaCompra: 1, secuencialFactura: 1, establecimiento: '001', puntoEmision: '001' };
}
function saveSettingsPatch(tenantId, patch) {
  var current = getSettings(tenantId);
  store.set(tenantId, 'settings', 'empresa', Object.assign({}, current, patch));
}

function nextInvoiceNumber(tenantId) {
  var s = getSettings(tenantId);
  var seq = String(s.secuencialFactura || 1).padStart(9, '0');
  return (s.establecimiento || '001') + '-' + (s.puntoEmision || '001') + '-' + seq;
}
function nextPurchaseNumber(tenantId) {
  var s = getSettings(tenantId);
  return 'COM-' + String(s.proximaCompra || 1).padStart(6, '0');
}

// Contabiliza un asiento (lineas: [{cuentaCodigo, debe, haber}]). Lanza si no cuadra.
function postJournalEntry(tenantId, lineas, meta) {
  var totalDebe = lineas.reduce(function (s, l) { return s + (Number(l.debe) || 0); }, 0);
  var totalHaber = lineas.reduce(function (s, l) { return s + (Number(l.haber) || 0); }, 0);
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    throw new Error('El asiento generado no cuadra (Debe ' + totalDebe.toFixed(2) + ' vs Haber ' + totalHaber.toFixed(2) + ').');
  }
  var settings = getSettings(tenantId);
  var numero = Number(settings.proximoAsiento) || 1;
  var data = {
    numero: numero, fecha: meta.fecha, glosa: meta.glosa, origen: meta.origen || 'Manual',
    referenciaId: meta.referenciaId || null, lineas: lineas, totalDebe: totalDebe, totalHaber: totalHaber
  };
  var doc = store.add(tenantId, 'journal_entries', data);
  saveSettingsPatch(tenantId, { proximoAsiento: numero + 1 });
  return doc;
}

function postAutoEntryForInvoice(tenantId, invoiceData) {
  var lineas = [];
  var cuentaCobro = cuentaCobroPorFormaPago(invoiceData.formaPago);
  lineas.push({ cuentaCodigo: cuentaCobro, debe: invoiceData.total, haber: 0 });
  lineas.push({ cuentaCodigo: CTA_VENTAS, debe: 0, haber: invoiceData.subtotal });
  if (invoiceData.ivaTotal > 0) lineas.push({ cuentaCodigo: CTA_IVA_POR_PAGAR, debe: 0, haber: invoiceData.ivaTotal });

  var settings = getSettings(tenantId);
  var costoVentas = 0;
  (invoiceData.items || []).forEach(function (it) {
    if (it.tipo === 'receta') {
      var rec = recById(tenantId, it.refId);
      if (rec) { rec.__tenantId = tenantId; costoVentas += recipeCosts(rec, settings.ivaPct).costoPorcion * Number(it.cantidad); }
    }
  });
  if (costoVentas > 0.005) {
    lineas.push({ cuentaCodigo: CTA_COSTO_VENTAS, debe: costoVentas, haber: 0 });
    lineas.push({ cuentaCodigo: CTA_INVENTARIO, debe: 0, haber: costoVentas });
  }
  postJournalEntry(tenantId, lineas, { fecha: invoiceData.fecha, glosa: 'Venta según factura ' + invoiceData.numero, origen: 'Venta', referenciaId: invoiceData.id });
}

function postReversalForInvoice(tenantId, inv) {
  var original = store.list(tenantId, 'journal_entries').find(function (e) { return e.origen === 'Venta' && e.referenciaId === inv.id; });
  if (!original) return;
  var lineas = (original.lineas || []).map(function (l) { return { cuentaCodigo: l.cuentaCodigo, debe: Number(l.haber) || 0, haber: Number(l.debe) || 0 }; });
  postJournalEntry(tenantId, lineas, { fecha: todayISO(), glosa: 'Anulación de factura ' + inv.numero, origen: 'Anulación', referenciaId: inv.id });
}

function postAutoEntryForMerma(tenantId, m) {
  var ing = ingById(tenantId, m.ingredienteId);
  var lineas = [
    { cuentaCodigo: CTA_COSTO_MERMAS, debe: m.costoEstimado, haber: 0 },
    { cuentaCodigo: CTA_INVENTARIO, debe: 0, haber: m.costoEstimado }
  ];
  postJournalEntry(tenantId, lineas, { fecha: m.fecha, glosa: 'Merma de ' + (ing ? ing.nombre : 'ingrediente') + ' — ' + m.motivo, origen: 'Merma', referenciaId: m.id });
}

function postAutoEntryForPurchase(tenantId, p) {
  var lineas = [];
  var cuentaPago = cuentaPagoCompra(p.formaPago);
  if (p.tipo === 'Ingredientes') lineas.push({ cuentaCodigo: CTA_INVENTARIO, debe: p.subtotal, haber: 0 });
  else lineas.push({ cuentaCodigo: p.cuentaGastoCodigo || CTA_GASTOS_GENERALES, debe: p.subtotal, haber: 0 });
  if (p.ivaValor > 0) lineas.push({ cuentaCodigo: CTA_IVA_CREDITO, debe: p.ivaValor, haber: 0 });
  lineas.push({ cuentaCodigo: cuentaPago, debe: 0, haber: p.total });
  postJournalEntry(tenantId, lineas, { fecha: p.fecha, glosa: 'Compra ' + p.numero + (p.proveedor ? (' — ' + p.proveedor) : ''), origen: 'Compra', referenciaId: p.id });
}

function postReversalForPurchase(tenantId, p) {
  var original = store.list(tenantId, 'journal_entries').find(function (e) { return e.origen === 'Compra' && e.referenciaId === p.id; });
  if (!original) return;
  var lineas = (original.lineas || []).map(function (l) { return { cuentaCodigo: l.cuentaCodigo, debe: Number(l.haber) || 0, haber: Number(l.debe) || 0 }; });
  postJournalEntry(tenantId, lineas, { fecha: todayISO(), glosa: 'Anulación de compra ' + p.numero, origen: 'Anulación', referenciaId: p.id });
}

// ---- acciones compuestas expuestas a las rutas ----

function emitInvoice(tenantId, items, meta) {
  var totals = computeInvoiceTotals(items);
  var reqs = [];
  items.forEach(function (it) {
    if (it.tipo === 'receta') {
      var rec = recById(tenantId, it.refId);
      if (rec) {
        (rec.ingredientes || []).forEach(function (ri) {
          reqs.push({ ingredienteId: ri.ingredienteId, qty: Number(ri.cantidad) * (Number(it.cantidad) / (Number(rec.porcionesBase) || 1)) });
        });
      }
    }
  });
  var combined = {};
  reqs.forEach(function (r) { combined[r.ingredienteId] = (combined[r.ingredienteId] || 0) + r.qty; });
  Object.keys(combined).forEach(function (id) {
    var avail = stockFor(tenantId, id);
    if (avail + 1e-9 < combined[id] && !meta.forzarSinStock) {
      var ing = ingById(tenantId, id);
      throw Object.assign(new Error('Stock insuficiente de ' + (ing ? ing.nombre : id) + ' (disponible ' + avail.toFixed(2) + ', requerido ' + combined[id].toFixed(2) + ').'), { code: 'stock_insuficiente' });
    }
  });
  Object.keys(combined).forEach(function (id) { deductStock(tenantId, id, combined[id]); });

  var cliente = clientById(tenantId, meta.clienteId);
  var numero = nextInvoiceNumber(tenantId);
  var data = {
    numero: numero, fecha: meta.fecha, clienteId: meta.clienteId,
    clienteNombreSnapshot: cliente ? cliente.nombre : '', clienteIdSnapshot: cliente ? cliente.identificacion : '',
    items: items, subtotal: totals.subtotal, ivaTotal: totals.ivaTotal, total: totals.total,
    formaPago: meta.formaPago, notas: meta.notas || '', estado: 'emitida'
  };
  var doc = store.add(tenantId, 'invoices', data);
  saveSettingsPatch(tenantId, { secuencialFactura: (Number(getSettings(tenantId).secuencialFactura) || 1) + 1 });
  postAutoEntryForInvoice(tenantId, Object.assign({ id: doc.id }, data));
  return doc;
}

function voidInvoice(tenantId, id) {
  var inv = invById(tenantId, id);
  if (!inv) throw new Error('Factura no encontrada.');
  postReversalForInvoice(tenantId, inv);
  return store.update(tenantId, 'invoices', id, { estado: 'anulada' });
}

function savePurchase(tenantId, data) {
  var numero = nextPurchaseNumber(tenantId);
  var body = Object.assign({ numero: numero, estado: 'registrada' }, data);
  var doc = store.add(tenantId, 'purchases', body);
  saveSettingsPatch(tenantId, { proximaCompra: (Number(getSettings(tenantId).proximaCompra) || 1) + 1 });

  if (body.tipo === 'Ingredientes') {
    (body.items || []).forEach(function (it) {
      var ing = ingById(tenantId, it.ingredienteId);
      if (!ing) return;
      var lotData = {
        ingredienteId: it.ingredienteId, cantidad: Number(it.cantidad),
        fechaIngreso: body.fecha,
        fechaVencimiento: ing.perecedero ? addDays(body.fecha, ing.vidaUtilDias || 0) : null,
        proveedor: body.proveedor || '', lote: numero
      };
      store.add(tenantId, 'lots', lotData);
      if (it.actualizarCosto) {
        store.update(tenantId, 'ingredients', ing.id, { costoUnitario: Number(it.costoUnitario) });
      }
    });
  }
  postAutoEntryForPurchase(tenantId, Object.assign({ id: doc.id }, body));
  return doc;
}

function voidPurchase(tenantId, id) {
  var p = purById(tenantId, id);
  if (!p) throw new Error('Compra no encontrada.');
  postReversalForPurchase(tenantId, p);
  return store.update(tenantId, 'purchases', id, { estado: 'anulada' });
}

function registerMerma(tenantId, data) {
  deductStock(tenantId, data.ingredienteId, Number(data.cantidad));
  var doc = store.add(tenantId, 'mermas', data);
  postAutoEntryForMerma(tenantId, Object.assign({ id: doc.id }, data));
  return doc;
}

function produceRecipe(tenantId, recipeId, porciones) {
  var rec = recById(tenantId, recipeId);
  if (!rec) throw new Error('Receta no encontrada.');
  var factor = Number(porciones) / (Number(rec.porcionesBase) || 1);
  (rec.ingredientes || []).forEach(function (it) {
    deductStock(tenantId, it.ingredienteId, Number(it.cantidad) * factor);
  });
  return { ok: true };
}

function runPayroll(tenantId, items, meta) {
  var total = items.reduce(function (s, it) { return s + Number(it.monto || 0); }, 0);
  var data = { periodo: meta.periodo, fecha: meta.fecha, formaPago: meta.formaPago, items: items, total: total };
  var doc = store.add(tenantId, 'payroll_runs', data);
  var cuentaPago = meta.formaPago === 'Transferencia' ? CTA_BANCOS : CTA_CAJA;
  var lineas = [
    { cuentaCodigo: CTA_GASTOS_SUELDOS, debe: total, haber: 0 },
    { cuentaCodigo: cuentaPago, debe: 0, haber: total }
  ];
  postJournalEntry(tenantId, lineas, { fecha: meta.fecha, glosa: 'Planilla de sueldos ' + meta.periodo, origen: 'Nómina', referenciaId: doc.id });
  return doc;
}

function addDays(iso, days) {
  var d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

module.exports = {
  computeInvoiceTotals, purchaseTotals, recipeCosts,
  emitInvoice, voidInvoice, savePurchase, voidPurchase,
  registerMerma, produceRecipe, runPayroll,
  getSettings, saveSettingsPatch,
};
