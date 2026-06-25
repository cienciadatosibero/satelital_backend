const pool = require('../config/db');

const Usuario = {
  async buscarPorUsuario(usuario) {
    const [rows] = await pool.query(
      'SELECT * FROM usuarios WHERE usuario = ? LIMIT 1',
      [usuario]
    );
    return rows[0] || null;
  },

  async buscarPorId(id) {
    const [rows] = await pool.query(
      'SELECT id, nombre, usuario, rol, activo, created_at FROM usuarios WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  async listar() {
    const [rows] = await pool.query(
      'SELECT id, nombre, usuario, rol, activo, created_at FROM usuarios ORDER BY created_at DESC'
    );
    return rows;
  },

  async crear({ nombre, usuario, passwordHash, rol }) {
    const [res] = await pool.query(
      'INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)',
      [nombre, usuario, passwordHash, rol]
    );
    return res.insertId;
  },

  async actualizar(id, { nombre, rol, activo }) {
    await pool.query(
      'UPDATE usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?',
      [nombre, rol, activo ? 1 : 0, id]
    );
  },

  async actualizarPassword(id, passwordHash) {
    await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [
      passwordHash,
      id,
    ]);
  },

  async eliminar(id) {
    await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
  },
};

module.exports = Usuario;
