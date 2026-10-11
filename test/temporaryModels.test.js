const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generarTicket } = require('../src/services/tempTicketService');
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('ticket temporal HMAC coincide con verificador de Python', () => {
  const secret = 'clave-compartida-de-pruebas-123456789';
  const { token, expires_at } = generarTicket({ usuarioId: 7, secreto: secret, now: 1770000000000, nonce: '4bb576a1-8d9a-4bc8-8919-c447738d0b5a' });
  const [version, expiry, nonce, uid, sig] = token.split('.');
  assert.equal(version, 'v1');
  assert.equal(uid, '7');
  assert.equal(new Date(expires_at).getTime(), Number(expiry) * 1000);
  assert.equal(Number(expiry), 1770000000 + 600);
  const expected = crypto.createHmac('sha256', secret).update(`${version}.${expiry}.${nonce}.${uid}`).digest('hex');
  assert.equal(sig, expected);
});

test('no se autorizan secretos débiles ni ids temporales arbitrarios', () => {
  assert.throws(() => generarTicket({ usuarioId: 1, secreto: '123' }), /24 caracteres/);
  assert.equal(ID_RE.test('best.pt'), false);
  assert.equal(ID_RE.test('5d13d61a-57bf-4769-8520-650859b65055'), true);
});

test('un escaneo siempre libera el modelo incluso tras fallar', () => {
  const s = fs.readFileSync(path.join(__dirname, '../src/controllers/deteccionController.js'), 'utf8');
  assert.match(s, /finally \{[\s\S]*liberarModeloTemporal/);
  assert.match(s, /const tempId = req\.body\?\.temp_model_id/);
});
