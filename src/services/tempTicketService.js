const crypto = require('node:crypto');

function generarTicket({ usuarioId, secreto, now = Date.now(), nonce = crypto.randomUUID() }) {
  if (!secreto || secreto.length < 24) throw new Error('TEMP_MODEL_SIGNING_KEY debe contener 24 caracteres o más');
  const exp = Math.floor(now / 1000) + 600;
  const payload = `v1.${exp}.${nonce}.${usuarioId}`;
  const firma = crypto.createHmac('sha256', secreto).update(payload).digest('hex');
  return { token: `${payload}.${firma}`, expires_at: new Date(exp * 1000).toISOString() };
}

module.exports = { generarTicket };
