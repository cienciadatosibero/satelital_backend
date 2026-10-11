const axios = require('axios');

const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:8000';

const cliente = axios.create({
  baseURL: INFERENCE_URL,
  ...(process.env.INFERENCE_API_TOKEN
    ? { headers: { Authorization: `Bearer ${process.env.INFERENCE_API_TOKEN}` } }
    : {}),
  timeout: 180000,
  maxContentLength: 100 * 1024 * 1024,
  maxBodyLength: 100 * 1024 * 1024,
});

const InferenciaService = {
  // Pide al microservicio que cargue un peso y devuelva sus clases
  async cargarModelo(rutaArchivo) {
    const { data } = await cliente.post('/load', { weights_path: rutaArchivo });
    return data; // { ok, classes: {...}, framework }
  },

  // Activa (mantiene en memoria) un modelo concreto
  async activarModelo(rutaArchivo) {
    const { data } = await cliente.post('/activate', { weights_path: rutaArchivo });
    return data;
  },

  // Ejecuta detección sobre una imagen base64. Devuelve cajas + recortes.
  async detectar({ imagenBase64, confianza, devolverRecortes = true }) {
    const { data } = await cliente.post('/predict', {
      image_base64: imagenBase64,
      conf: confianza ?? 0.25,
      return_crops: devolverRecortes,
    });
    return data; // { ok, detections: [...], image_width, image_height }
  },

  async estado() {
    const { data } = await cliente.get('/health');
    return data;
  },
};

module.exports = InferenciaService;
