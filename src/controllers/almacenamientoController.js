// almacenamientoController.js
const Storage = require('../services/storageService');

// GET /api/almacenamiento
// Devuelve el resumen de uso de disco y base de datos.
// El límite por defecto es 1 GB (configurable con LIMITE_ALMACENAMIENTO_MB en .env).
async function resumen(req, res, next) {
  try {
    const mb = Number(process.env.LIMITE_ALMACENAMIENTO_MB) || 1024;
    const data = await Storage.resumen({ limiteBytes: mb * 1024 * 1024 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/almacenamiento/optimizar
// Corre OPTIMIZE TABLE para recuperar espacio liberado en MySQL.
async function optimizar(req, res, next) {
  try {
    const tablas = await Storage.optimizar();
    res.json({ success: true, data: { optimizadas: tablas } });
  } catch (err) {
    next(err);
  }
}

module.exports = { resumen, optimizar };