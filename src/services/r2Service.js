// Cliente R2 S3 compatible sin dependencias adicionales: SigV4 sobre TLS.
const crypto = require('node:crypto');

function settings() {
  const cfg = {
    account: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET,
    keyId: process.env.R2_ACCESS_KEY_ID,
    secret: process.env.R2_SECRET_ACCESS_KEY,
  };
  if (Object.values(cfg).some(v => !v || /^TU_|^<.*>$/.test(v))) {
    const e = new Error('Falta configurar R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY en el backend.');
    e.status = 503; throw e;
  }
  if (!/^[a-z0-9-]+$/i.test(cfg.account) || !/^[a-z0-9-]+$/i.test(cfg.bucket)) {
    const e = new Error('Configuración R2 inválida.'); e.status = 503; throw e;
  }
  return cfg;
}

function enc(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

function signedUrl(method, key, expires = 900) {
  const cfg = settings();
  if (!/^models\/[a-f0-9]{32}\.pt$/.test(key)) throw new Error('Clave del modelo inválida');
  const host = `${cfg.account}.r2.cloudflarestorage.com`;
  const pathname = `/${enc(cfg.bucket)}/${key.split('/').map(enc).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.keyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  const canonicalRequest = `${method}\n${pathname}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonicalRequest)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `https://${host}${pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function head(key) {
  const r = await fetch(signedUrl('HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error(`R2 rechazó la consulta del archivo (${r.status}); comprueba las credenciales y permisos del bucket.`); e.status = 502; throw e; }
  return { size: Number(r.headers.get('content-length')), etag: r.headers.get('etag') };
}

async function remove(key) {
  const r = await fetch(signedUrl('DELETE', key, 60), { method: 'DELETE', signal: AbortSignal.timeout(15000) });
  if (!r.ok && r.status !== 404) throw new Error(`No se pudo borrar el archivo de R2 (${r.status})`);
}

module.exports = { signedUrl, head, remove };
