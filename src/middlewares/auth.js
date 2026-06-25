const jwt = require('jsonwebtoken');

// Verifica el token y adjunta req.usuario
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Sesión requerida' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload; // { id, usuario, rol, nombre }
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Sesión inválida o expirada' });
  }
}

// Restringe a roles concretos: requireRole('admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res
        .status(403)
        .json({ success: false, message: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
