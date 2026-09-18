// Envío de correo (verificación de cuenta, recuperación de contraseña).
// Si configuras SMTP_HOST/SMTP_USER/SMTP_PASS como variables de entorno,
// los correos se envían de verdad. Si NO las configuras (por ejemplo,
// mientras pruebas localmente), no falla: registra el enlace en la consola
// del servidor y lo devuelve también en la respuesta de la API marcado
// como "modoDesarrollo" para que puedas seguir probando sin un proveedor
// de correo real. Quítalo/ajústalo antes de vender el producto en serio.
const nodemailer = require('nodemailer');

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter = null;
function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Devuelve { enviado: boolean, modoDesarrollo: boolean }
async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log('[email] SMTP no configurado — enlace de ' + subject + ' para ' + to + ':\n' + text);
    return { enviado: false, modoDesarrollo: true };
  }
  await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html, text });
  return { enviado: true, modoDesarrollo: false };
}

function verificationEmail(nombre, link) {
  return {
    subject: 'Verifica tu correo en GastroPlus',
    text: 'Hola ' + nombre + ', confirma tu correo en GastroPlus entrando a este enlace: ' + link,
    html: '<p>Hola ' + nombre + ',</p><p>Confirma tu correo en GastroPlus:</p><p><a href="' + link + '">' + link + '</a></p>',
  };
}
function resetEmail(nombre, link) {
  return {
    subject: 'Recupera tu contraseña de GastroPlus',
    text: 'Hola ' + nombre + ', restablece tu contraseña en GastroPlus entrando a este enlace (vence en 1 hora): ' + link,
    html: '<p>Hola ' + nombre + ',</p><p>Restablece tu contraseña (el enlace vence en 1 hora):</p><p><a href="' + link + '">' + link + '</a></p>',
  };
}

module.exports = { sendMail, smtpConfigured, verificationEmail, resetEmail };
