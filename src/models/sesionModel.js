const pool = require('../config/db');

const Sesion = {
  async crear({ usuarioId, modeloId, nombre, bounds, zoom }) {
    const [res] = await pool.query(
      `INSERT INTO sesiones_busqueda
        (usuario_id, modelo_id, nombre, bounds_north, bounds_south, bounds_east, bounds_west, zoom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuarioId,
        modeloId || null,
        nombre || 'Sesión sin título',
        bounds?.north ?? null,
        bounds?.south ?? null,
        bounds?.east ?? null,
        bounds?.west ?? null,
        zoom ?? null,
      ]
    );
    return res.insertId;
  },

  async listarPorUsuario(usuarioId) {
    const [rows] = await pool.query(
      `SELECT * FROM sesiones_busqueda WHERE usuario_id = ? ORDER BY created_at DESC`,
      [usuarioId]
    );
    return rows;
  },

  async buscarPorId(id) {
    const [rows] = await pool.query('SELECT * FROM sesiones_busqueda WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async actualizarEstado(id, estado) {
    await pool.query('UPDATE sesiones_busqueda SET estado = ? WHERE id = ?', [estado, id]);
  },

  async actualizarTotal(id) {
    await pool.query(
      `UPDATE sesiones_busqueda s
         SET total_detecciones = (SELECT COUNT(*) FROM detecciones d WHERE d.sesion_id = s.id)
       WHERE s.id = ?`,
      [id]
    );
  },

  async eliminar(id) {
    await pool.query('DELETE FROM sesiones_busqueda WHERE id = ?', [id]);
  },
};

const Deteccion = {
  async crearLote(sesionId, detecciones) {
    if (!detecciones?.length) return [];
    // Las imágenes NO van a MySQL. Guardamos la ruta del recorte en disco y,
    // si la detección pertenece a una celda, su celda_id (para el .txt YOLO).
    const ids = [];
    for (const d of detecciones) {
      const [res] = await pool.query(
        `INSERT INTO detecciones
          (sesion_id, celda_id, clase, confianza, lat, lng, bbox_x, bbox_y, bbox_w, bbox_h, recorte_path, deteccion_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sesionId,
          d.celda_id || null,
          d.clase,
          d.confianza,
          d.lat,
          d.lng,
          d.bbox_x,
          d.bbox_y,
          d.bbox_w,
          d.bbox_h,
          d.recorte_path || null,
          d.deteccion_path || null,
        ]
      );
      ids.push(res.insertId);
    }
    return ids;
  },

  async listarPorSesion(sesionId) {
    // Ya no hay columna pesada: siempre devolvemos todo (incluida recorte_path)
    const [rows] = await pool.query(
      `SELECT id, sesion_id, clase, confianza, lat, lng,
              bbox_x, bbox_y, bbox_w, bbox_h, recorte_path, deteccion_path, revision, created_at
         FROM detecciones WHERE sesion_id = ? ORDER BY id ASC`,
      [sesionId]
    );
    return rows;
  },

  async actualizarRevision(id, revision) {
    await pool.query('UPDATE detecciones SET revision = ? WHERE id = ?', [revision, id]);
  },

  async listarConfirmadas(sesionId) {
    const [rows] = await pool.query(
      `SELECT * FROM detecciones WHERE sesion_id = ? AND revision = 'confirmado' ORDER BY id ASC`,
      [sesionId]
    );
    return rows;
  },
};

const Celda = {
  // Crea una celda y devuelve su id
  async crear(sesionId, c) {
    const [res] = await pool.query(
      `INSERT INTO celdas
        (sesion_id, fila, col, north, south, east, west, img_path, img_w, img_h)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sesionId,
        c.fila,
        c.col,
        c.bounds.north,
        c.bounds.south,
        c.bounds.east,
        c.bounds.west,
        c.img_path || null,
        c.img_w || null,
        c.img_h || null,
      ]
    );
    return res.insertId;
  },

  async listarPorSesion(sesionId) {
    const [rows] = await pool.query(
      `SELECT * FROM celdas WHERE sesion_id = ? ORDER BY fila, col`,
      [sesionId]
    );
    return rows;
  },

  // Todas las detecciones de una celda (para escribir su .txt)
  async deteccionesDe(celdaId, soloConfirmadas = false) {
    const filtro = soloConfirmadas ? "AND revision = 'confirmado'" : '';
    const [rows] = await pool.query(
      `SELECT * FROM detecciones WHERE celda_id = ? ${filtro} ORDER BY id`,
      [celdaId]
    );
    return rows;
  },
};

module.exports = { Sesion, Deteccion, Celda };
