const axios = require('axios');

const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:8000';
const DYNAMIC_INFERENCE_URL = (process.env.DYNAMIC_INFERENCE_URL || '').replace(/\/+$/, '');

const cliente = axios.create({
  baseURL: INFERENCE_URL,
  ...(process.env.INFERENCE_API_TOKEN
    ? { headers: { Authorization: `Bearer ${process.env.INFERENCE_API_TOKEN}` } }
    : {}),
  timeout: 180000,
  maxContentLength: 100 * 1024 * 1024,
  maxBodyLength: 100 * 1024 * 1024,
});

const temporal = axios.create({
  baseURL: DYNAMIC_INFERENCE_URL || 'http://localhost:8800',
  timeout: 180000,
  headers: process.env.INFERENCE_API_TOKEN
    ? { Authorization: `Bearer ${process.env.INFERENCE_API_TOKEN}` } : {},
  maxBodyLength: 30 * 1024 * 1024,
});

function asegurarTemporal() {
  if (!DYNAMIC_INFERENCE_URL || !process.env.INFERENCE_API_TOKEN) {
    throw Object.assign(new Error('Configura DYNAMIC_INFERENCE_URL e INFERENCE_API_TOKEN en el backend y Python'), { status: 503 });
  }
}

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

  // En el modo temporal la imagen va al servicio Python, nunca el .pt a Vercel.
  async detectar({ imagenBase64, confianza, devolverRecortes = true, tempModelId = null }) {
    if (tempModelId) {
      asegurarTemporal();
      const { data } = await temporal.post('/temporary/predict', {
        temp_model_id: tempModelId,
        image_base64: imagenBase64,
        conf: confianza ?? 0.25,
        return_crops: devolverRecortes,
      });
      return data;
    }
    const { data } = await cliente.post('/predict', {
      image_base64: imagenBase64,
      conf: confianza ?? 0.25,
      return_crops: devolverRecortes,
    });
    return data; // { ok, detections: [...], image_width, image_height }
  },

  async liberarModeloTemporal(tempModelId) {
    asegurarTemporal();
    try {
      await temporal.post('/temporary/release', { temp_model_id: tempModelId }, { timeout: 10000 });
    } catch (error) {
      if (error.response?.status !== 404) throw error;
    }
  },

  async estado() {
    const { data } = await cliente.get('/health', { timeout: 5000 });
    return data;
  },
};

module.exports = InferenciaService;
