const express = require('express');
const cors = require('cors');
const path = require('path');
const billing = require('./billing');

const app = express();
app.use(cors());

// El webhook de Stripe necesita el cuerpo SIN parsear (para validar la
// firma), así que se monta antes del express.json() global.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = billing.getStripe();
  if (!stripe) return res.status(501).send('Stripe no configurado');
  let event;
  try {
    event = process.env.STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).send('Webhook inválido: ' + e.message);
  }
  billing.applyPlanFromEvent(event);
  res.json({ received: true });
});

app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/data', require('./routes/data'));
app.use('/api/actions', require('./routes/actions'));
app.use('/api/billing', require('./routes/billing'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('GastroPlus SaaS escuchando en puerto ' + PORT));

if (process.env.DISABLE_AUTO_BACKUP !== '1') {
  require('./backup').schedule();
}
