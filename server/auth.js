const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CAMBIA_ESTE_SECRETO_EN_PRODUCCION';
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign(
    { uid: user.id, tenantId: user.tenantId, rol: user.rol, nombre: user.nombre, email: user.email },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token', message: 'Falta iniciar sesión.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token', message: 'Sesión inválida o expirada.' });
  }
}

module.exports = { signToken, authMiddleware, JWT_SECRET };
