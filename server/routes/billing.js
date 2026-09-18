const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../auth');
const billing = require('../billing');

const router = express.Router();
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

router.get('/planes', authMiddleware, (req, res) => {
  const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(req.user.tenantId);
  res.json({ planActual: tenant ? tenant.plan : 'trial', disponible: billing.stripeConfigured(), planes: billing.PLANS });
});

router.post('/checkout', authMiddleware, (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Sólo el administrador del restaurante puede cambiar el plan.' });
  const { plan } = req.body || {};
  billing.createCheckoutSession({
    tenantId: req.user.tenantId,
    tenantNombre: req.user.nombre,
    plan,
    customerEmail: req.user.email,
    successUrl: APP_URL + '/?pago=exito',
    cancelUrl: APP_URL + '/?pago=cancelado',
  }).then((session) => res.json({ url: session.url }))
    .catch((e) => res.status(e.code === 'stripe_no_configurado' ? 501 : 400).json({ error: e.code || 'error', message: e.message }));
});

// Nota: el webhook de Stripe (que necesita el cuerpo crudo, sin parsear
// como JSON) se define directamente en server/index.js, montado ANTES del
// express.json() global — por eso no vive en este router.

module.exports = router;
