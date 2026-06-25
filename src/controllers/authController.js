const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/usuarioModel');

async function login(req, res, next) {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Usuario y contraseña son obligatorios' });
    }

    const u = await Usuario.buscarPorUsuario(usuario.trim());
    if (!u || !u.activo) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    const payload = { id: u.id, usuario: u.usuario, rol: u.rol, nombre: u.nombre };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES || '8h',
    });

    res.json({ success: true, data: { token, usuario: payload } });
  } catch (err) {
    next(err);
  }
}

async function perfil(req, res, next) {
  try {
    const u = await Usuario.buscarPorId(req.usuario.id);
    if (!u) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true, data: u });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, perfil };
