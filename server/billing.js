// Cobro de suscripciones con Stripe. No hace nada mágico: necesitas tu
// propia cuenta de Stripe y crear ahí 3 "Prices" recurrentes (uno por
// plan) y pegar sus IDs en las variables de entorno de abajo. Mientras no
// configures STRIPE_SECRET_KEY, los endpoints de cobro devuelven un error
// claro en vez de fallar de forma confusa — así puedes vender/probar el
// resto de la app sin tener Stripe listo todavía.
const db = require('./db');

const PLANS = {
  basico: { label: 'Básico', priceEnv: 'STRIPE_PRICE_BASICO' },
  pro: { label: 'Pro', priceEnv: 'STRIPE_PRICE_PRO' },
  total: { label: 'Total', priceEnv: 'STRIPE_PRICE_TOTAL' },
};

function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}
function getStripe() {
  if (!stripeConfigured()) return null;
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function createCheckoutSession({ tenantId, tenantNombre, plan, successUrl, cancelUrl, customerEmail }) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Los cobros con Stripe todavía no están configurados en este servidor (falta STRIPE_SECRET_KEY). Revisa el README.');
    err.code = 'stripe_no_configurado';
    throw err;
  }
  const planMeta = PLANS[plan];
  if (!planMeta) throw Object.assign(new Error('Plan no reconocido.'), { code: 'plan_invalido' });
  const priceId = process.env[planMeta.priceEnv];
  if (!priceId) {
    const err = new Error('Falta configurar el precio de Stripe para el plan "' + planMeta.label + '" (variable ' + planMeta.priceEnv + ').');
    err.code = 'precio_no_configurado';
    throw err;
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: customerEmail,
    client_reference_id: tenantId,
    metadata: { tenantId, tenantNombre, plan },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return session;
}

function applyPlanFromEvent(event) {
  const obj = event.data.object;
  const tenantId = obj.metadata && obj.metadata.tenantId ? obj.metadata.tenantId : obj.client_reference_id;
  if (!tenantId) return;
  if (event.type === 'checkout.session.completed') {
    const plan = obj.metadata && obj.metadata.plan;
    if (plan) db.prepare('UPDATE tenants SET plan = ?, activo = 1 WHERE id = ?').run(plan, tenantId);
  } else if (event.type === 'customer.subscription.deleted') {
    db.prepare('UPDATE tenants SET plan = ? WHERE id = ?').run('trial', tenantId);
  }
}

module.exports = { PLANS, stripeConfigured, getStripe, createCheckoutSession, applyPlanFromEvent };
