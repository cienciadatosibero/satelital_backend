const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middlewares/auth');
const { uploadPesos, requiereAlmacenamientoDeModelos } = require('../middlewares/upload');

const auth = require('../controllers/authController');
const usuarios = require('../controllers/usuarioController');
const modelos = require('../controllers/modeloController');
const modeloTemporal = require('../controllers/modeloTemporalController');
const det = require('../controllers/deteccionController');
const almacenamiento = require('../controllers/almacenamientoController');
const Inferencia = require('../services/inferenceService');

// ---------- Autenticación ----------
router.post('/auth/login', auth.login); // Windows (admin + invitado)
router.post('/auth/admin/login', auth.loginAdmin); // Web (solo admin)
router.get('/auth/perfil', requireAuth, auth.perfil);

// ---------- Usuarios (solo admin) ----------
router.get('/usuarios', requireAuth, requireRole('admin'), usuarios.listar);
router.post('/usuarios', requireAuth, requireRole('admin'), usuarios.crear);
router.put('/usuarios/:id', requireAuth, requireRole('admin'), usuarios.actualizar);
router.delete('/usuarios/:id', requireAuth, requireRole('admin'), usuarios.eliminar);

// ---------- Modelo temporal para un solo escaneo (sin R2 ni TiDB) ----------
router.post('/modelos/temporal/ticket', requireAuth, requireRole('admin'), modeloTemporal.ticket);
router.post('/modelos/temporal/release', requireAuth, requireRole('admin'), modeloTemporal.liberar);

// ---------- Modelos / pesos ----------
router.get('/modelos', requireAuth, modelos.listar);
router.get('/modelos/activo', requireAuth, modelos.activo);
router.post(
  '/modelos',
  requireAuth,
  requireRole('admin'),
  requiereAlmacenamientoDeModelos,
  uploadPesos.single('peso'),
  modelos.subir
);
router.post('/modelos/:id/activar', requireAuth, requireRole('admin'), modelos.activar);
router.delete('/modelos/:id', requireAuth, requireRole('admin'), modelos.eliminar);

// ---------- Detección y datasets (admin + invitado) ----------
router.post('/detectar', requireAuth, det.detectar);
router.post('/detectar-area', requireAuth, det.detectarArea);
router.get('/sesiones', requireAuth, det.listarSesiones);
router.get('/sesiones/:id/detecciones', requireAuth, det.detallesSesion);
router.get('/sesiones/:id/exportar', requireAuth, det.exportar);
router.delete('/sesiones/:id', requireAuth, det.eliminarSesion);
router.patch('/detecciones/:id', requireAuth, det.revisarDeteccion);

// ---------- Almacenamiento (solo admin) ----------
router.get('/almacenamiento', requireAuth, requireRole('admin'), almacenamiento.resumen);
router.post('/almacenamiento/optimizar', requireAuth, requireRole('admin'), almacenamiento.optimizar);

// ---------- Salud ----------
router.get('/health', async (req, res) => {
  const pool = require('../config/db');
  const [db, inferencia] = await Promise.all([
    pool.query('SELECT 1 AS ok').then(() => true).catch((e) => {
      console.error('Health DB:', e.code || e.message);
      return false;
    }),
    Inferencia.estado().then((r) => Boolean(r.ok)).catch(() => false),
  ]);
  res.status(db ? 200 : 503).json({ success: db, data: { api: true, db, inferencia } });
});

module.exports = router;
