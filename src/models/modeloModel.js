const pool = require('../config/db');

const Modelo = {
  async listar() {
    const [rows] = await pool.query(
      `SELECT m.*, u.nombre AS subido_por_nombre
         FROM modelos m
         LEFT JOIN usuarios u ON u.id = m.subido_por
         ORDER BY m.created_at DESC`
    );
    return rows;
  },

  async buscarPorId(id) {
    const [rows] = await pool.query('SELECT * FROM modelos WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async buscarActivo() {
    const [rows] = await pool.query(
      'SELECT * FROM modelos WHERE activo = 1 ORDER BY updated_at DESC LIMIT 1'
    );
    return rows[0] || null;
  },

  async crear({ nombre, descripcion, archivo, framework, clases, confDefault, subidoPor }) {
    const [res] = await pool.query(
      `INSERT INTO modelos (nombre, descripcion, archivo, framework, clases, conf_default, subido_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nombre,
        descripcion || null,
        archivo,
        framework || 'yolo',
        clases ? JSON.stringify(clases) : null,
        confDefault || 0.25,
        subidoPor || null,
      ]
    );
    return res.insertId;
  },

  async activar(id) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE modelos SET activo = 0');
      await conn.query('UPDATE modelos SET activo = 1 WHERE id = ?', [id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  async eliminar(id) {
    await pool.query('DELETE FROM modelos WHERE id = ?', [id]);
  },
};

module.exports = Modelo;
