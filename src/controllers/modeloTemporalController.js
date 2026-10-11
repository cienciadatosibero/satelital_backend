const { generarTicket } = require('../services/tempTicketService');
const Inferencia = require('../services/inferenceService');

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getConfig() {
  const url = (process.env.DYNAMIC_INFERENCE_URL || '').replace(/\/+$/, '');
  const secreto = process.env.TEMP_MODEL_SIGNING_KEY;
  if (!url || !/^https:\/\//.test(url) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(?::\d+)?$/.test(url))) {
    throw Object.assign(new Error('Configura DYNAMIC_INFERENCE_URL con el servicio Python para modelos temporales'), { status: 503 });
  }
  if (!secreto || secreto.length < 24) {
    throw Object.assign(new Error('Configura TEMP_MODEL_SIGNING_KEY (24+ caracteres) en backend y Python'), { status: 503 });
  }
  return { url, secreto };
}

async function ticket(req, res, next) {
  try {
    const { url, secreto } = getConfig();
    const { token, expires_at } = generarTicket({ usuarioId: req.usuario.id, secreto });
    res.json({ success: true, data: { upload_url: `${url}/temporary/upload`, token, expires_at, max_mb: 200 } });
  } catch (e) { next(e); }
}

async function liberar(req, res, next) {
  try {
    const id = req.body?.temp_model_id;
    if (!ID_RE.test(id || '')) return res.status(400).json({ success: false, message: 'Identificador temporal inválido' });
    await Inferencia.liberarModeloTemporal(id);
    res.json({ success: true, message: 'Modelo temporal liberado' });
  } catch (e) { next(e); }
}

module.exports = { ticket, liberar, ID_RE };
