const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middlewares/auth');
const { uploadPesos } = require('../middlewares/upload');

const auth = require('../controllers/authController');
const usuarios = require('../controllers/usuarioController');
const modelos = require('../controllers/modeloController');
const det = require('../controllers/deteccionController');
const almacenamiento = require('../controllers/almacenamientoController');
const Inferencia = require('../services/inferenceService');

// ---------- Autenticación ----------
router.post('/auth/login', auth.login);
router.get('/auth/perfil', requireAuth, auth.perfil);

// ---------- Usuarios (solo admin) ----------
router.get('/usuarios', requireAuth, requireRole('admin'), usuarios.listar);
router.post('/usuarios', requireAuth, requireRole('admin'), usuarios.crear);
router.put('/usuarios/:id', requireAuth, requireRole('admin'), usuarios.actualizar);
router.delete('/usuarios/:id', requireAuth, requireRole('admin'), usuarios.eliminar);

// ---------- Modelos / pesos ----------
router.get('/modelos', requireAuth, modelos.listar);
router.get('/modelos/activo', requireAuth, modelos.activo);
router.post(
  '/modelos',
  requireAuth,
  requireRole('admin'),
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
  let inferencia = false;
  try {
    const r = await Inferencia.estado();
    inferencia = !!r.ok;
  } catch {
    inferencia = false;
  }
  res.json({ success: true, data: { api: true, inferencia } });
});

module.exports = router;
