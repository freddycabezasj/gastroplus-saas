const express = require('express');
const { authMiddleware } = require('../auth');
const { canDo } = require('../permissions');
const logic = require('../logic');

const router = express.Router();
router.use(authMiddleware);

function gate(action) {
  return function (req, res, next) {
    if (!canDo(req.user.rol, action)) return res.status(403).json({ error: 'forbidden', message: 'Tu rol no puede realizar esta acción.' });
    next();
  };
}

function handle(res, fn) {
  try {
    const result = fn();
    res.json(result);
  } catch (e) {
    const status = e.code === 'stock_insuficiente' ? 409 : 400;
    res.status(status).json({ error: e.code || 'error', message: e.message });
  }
}

router.post('/invoices/emit', gate('invoices.emit'), (req, res) => {
  const { items, ...meta } = req.body || {};
  handle(res, () => logic.emitInvoice(req.user.tenantId, items || [], meta));
});

router.post('/invoices/:id/void', gate('invoices.void'), (req, res) => {
  handle(res, () => logic.voidInvoice(req.user.tenantId, req.params.id));
});

router.post('/purchases', gate('purchases.save'), (req, res) => {
  handle(res, () => logic.savePurchase(req.user.tenantId, req.body || {}));
});

router.post('/purchases/:id/void', gate('purchases.void'), (req, res) => {
  handle(res, () => logic.voidPurchase(req.user.tenantId, req.params.id));
});

router.post('/mermas', gate('mermas.register'), (req, res) => {
  handle(res, () => logic.registerMerma(req.user.tenantId, req.body || {}));
});

router.post('/produce', gate('produce.recipe'), (req, res) => {
  const { recipeId, porciones } = req.body || {};
  handle(res, () => logic.produceRecipe(req.user.tenantId, recipeId, porciones));
});

router.post('/payroll/run', gate('payroll.run'), (req, res) => {
  const { items, ...meta } = req.body || {};
  handle(res, () => logic.runPayroll(req.user.tenantId, items || [], meta));
});

module.exports = router;
