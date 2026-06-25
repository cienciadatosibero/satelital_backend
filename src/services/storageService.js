// storageService.js
// ---------------------------------------------------------------------------
// Mide cuánto espacio ocupa el sistema:
//   - Recortes en disco (uploads/recortes) por sesión
//   - Pesos de modelos (uploads/weights)
//   - Tamaño aproximado de la base de datos MySQL
// Devuelve cifras en bytes; el frontend las formatea.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
const RECORTES = path.join(UPLOADS, 'recortes');
const WEIGHTS = path.join(UPLOADS, 'weights');

// Suma recursiva del tamaño de una carpeta (bytes)
function tamCarpeta(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) total += tamCarpeta(p);
    else {
      try {
        total += fs.statSync(p).size;
      } catch {
        /* archivo borrado entre el listado y el stat */
      }
    }
  }
  return total;
}

// Cuenta archivos en una carpeta (recursivo)
function contarArchivos(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += contarArchivos(path.join(dir, e.name));
    else n++;
  }
  return n;
}

const StorageService = {
  async resumen({ limiteBytes = 1024 * 1024 * 1024 } = {}) {
    // --- Disco: recortes por sesión ---
    const porSesion = [];
    let totalRecortes = 0;
    if (fs.existsSync(RECORTES)) {
      for (const e of fs.readdirSync(RECORTES, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = path.join(RECORTES, e.name);
        const bytes = tamCarpeta(dir);
        totalRecortes += bytes;
        porSesion.push({
          sesion_id: Number(e.name) || e.name,
          archivos: contarArchivos(dir),
          bytes,
        });
      }
    }
    porSesion.sort((a, b) => b.bytes - a.bytes);

    const bytesPesos = tamCarpeta(WEIGHTS);

    // --- Base de datos: tamaño aproximado por tabla ---
    let tablas = [];
    let totalBd = 0;
    try {
      const [rows] = await pool.query(
        `SELECT table_name AS tabla,
                (data_length + index_length) AS bytes,
                table_rows AS filas
           FROM information_schema.TABLES
          WHERE table_schema = DATABASE()
          ORDER BY (data_length + index_length) DESC`
      );
      tablas = rows.map((r) => ({
        tabla: r.tabla,
        bytes: Number(r.bytes) || 0,
        filas: Number(r.filas) || 0,
      }));
      totalBd = tablas.reduce((a, t) => a + t.bytes, 0);
    } catch {
      tablas = [];
    }

    const totalUsado = totalRecortes + bytesPesos + totalBd;

    return {
      limite_bytes: limiteBytes,
      total_usado_bytes: totalUsado,
      porcentaje: limiteBytes ? Math.min(100, (totalUsado / limiteBytes) * 100) : 0,
      disco: {
        recortes_bytes: totalRecortes,
        pesos_bytes: bytesPesos,
        por_sesion: porSesion,
      },
      base_datos: {
        total_bytes: totalBd,
        tablas,
      },
    };
  },
  // Recupera espacio en disco que MySQL marca como libre pero no devuelve
  // al SO. Corre OPTIMIZE TABLE sobre todas las tablas de la base.
  async optimizar() {
    const [rows] = await pool.query(
      `SELECT table_name AS tabla FROM information_schema.TABLES
        WHERE table_schema = DATABASE()`
    );
    const optimizadas = [];
    for (const r of rows) {
      try {
        await pool.query(`OPTIMIZE TABLE \`${r.tabla}\``);
        optimizadas.push(r.tabla);
      } catch {
        /* algunas tablas/engines no soportan OPTIMIZE; se ignora */
      }
    }
    return optimizadas;
  },
};

module.exports = StorageService;