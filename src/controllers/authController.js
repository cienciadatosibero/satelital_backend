const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/usuarioModel');

async function autenticar(req, res, next, soloAdmin = false) {
  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password || typeof usuario !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña son obligatorios' });
    }
    const u = await Usuario.buscarPorUsuario(usuario.trim());
    if (!u || !u.activo || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }
    // El endpoint web nunca entrega JWT a cuentas de Windows.
    if (soloAdmin && u.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'El acceso web es exclusivo para administradores. Usa SatDataset para Windows.' });
    }
    const payload = { id: u.id, usuario: u.usuario, rol: u.rol, nombre: u.nombre };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });
    return res.json({ success: true, data: { token, usuario: payload } });
  } catch (err) { next(err); }
}

async function login(req, res, next) { return autenticar(req, res, next, false); }
async function loginAdmin(req, res, next) { return autenticar(req, res, next, true); }

async function perfil(req, res, next) {
  try {
    const u = await Usuario.buscarPorId(req.usuario.id);
    if (!u) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true, data: u });
  } catch (err) { next(err); }
}

module.exports = { login, loginAdmin, perfil };
