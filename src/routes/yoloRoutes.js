const express = require('express');
const {
  detectarPaneles,
  analizarImagen,
  estadoYolo,
} = require('../controllers/yoloController'); // Asegúrate de que esta ruta suba un nivel (../) y entre a controllers

const router = express.Router();

router.get('/estado', estadoYolo);
router.post('/detectar-paneles', detectarPaneles);
router.post('/analizar-imagen', analizarImagen);

module.exports = router;