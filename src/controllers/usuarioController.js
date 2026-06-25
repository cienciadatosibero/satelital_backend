const bcrypt = require('bcryptjs');
const Usuario = require('../models/usuarioModel');

async function listar(req, res, next) {
  try {
    const usuarios = await Usuario.listar();
    res.json({ success: true, data: usuarios });
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    const { nombre, usuario, password, rol } = req.body;
    if (!nombre || !usuario || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Nombre, usuario y contraseña son obligatorios' });
    }
    if (!['admin', 'invitado'].includes(rol)) {
      return res.status(400).json({ success: false, message: 'Rol inválido' });
    }

    const existente = await Usuario.buscarPorUsuario(usuario.trim());
    if (existente) {
      return res.status(409).json({ success: false, message: 'Ese usuario ya existe' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = await Usuario.crear({
      nombre: nombre.trim(),
      usuario: usuario.trim(),
      passwordHash,
      rol,
    });
    res.status(201).json({ success: true, data: { id } });
  } catch (err) {
    next(err);
  }
}

async function actualizar(req, res, next) {
  try {
    const { id } = req.params;
    const { nombre, rol, activo, password } = req.body;
    const u = await Usuario.buscarPorId(id);
    if (!u) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    await Usuario.actualizar(id, {
      nombre: nombre ?? u.nombre,
      rol: rol ?? u.rol,
      activo: activo ?? u.activo,
    });

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await Usuario.actualizarPassword(id, hash);
    }

    res.json({ success: true, message: 'Usuario actualizado' });
  } catch (err) {
    next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const { id } = req.params;
    if (Number(id) === req.usuario.id) {
      return res
        .status(400)
        .json({ success: false, message: 'No puedes eliminar tu propia cuenta' });
    }
    await Usuario.eliminar(id);
    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, crear, actualizar, eliminar };
