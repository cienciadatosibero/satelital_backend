const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const Modelo = require('../models/modeloModel');
const Inferencia = require('../services/inferenceService');
const R2 = require('../services/r2Service');

const LIMITE = 200 * 1024 * 1024;
const esR2 = (key) => /^models\/[a-f0-9]{32}\.pt$/.test(String(key));
const confValida = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0.05 && Number(value) <= 0.95;
const clean = (m) => ({ ...m, clases: m.clases ? safeParse(m.clases) : null, archivo: undefined });

function safeParse(s) {
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
}
async function listar(req, res, next) {
  try { res.json({ success: true, data: (await Modelo.listar()).map(clean) }); } catch (e) { next(e); }
}
async function activo(req, res, next) {
  try { const m = await Modelo.buscarActivo(); res.json({ success: true, data: m ? clean(m) : null }); } catch (e) { next(e); }
}

// El navegador manda el fichero directamente a R2 con la URL temporal.
async function prepararSubida(req, res, next) {
  try {
    const { filename, size, nombre, descripcion, conf_default } = req.body;
    if (!/\.pt$/i.test(String(filename || '')) || String(filename).length > 200) {
      return res.status(400).json({ success: false, message: 'Selecciona un peso YOLO .pt' });
    }
    if (!Number.isSafeInteger(size) || size < 1024 || size > LIMITE) {
      return res.status(400).json({ success: false, message: 'El archivo debe pesar entre 1 KB y 200 MB.' });
    }
    if (!confValida(conf_default)) return res.status(400).json({ success: false, message: 'Confianza inválida (0.05 a 0.95)' });
    const etiqueta = String(nombre || filename).trim().slice(0, 140);
    const detalle = String(descripcion || '').trim().slice(0, 2000);
    if (!etiqueta) return res.status(400).json({ success: false, message: 'Escribe un nombre del modelo.' });
    const key = `models/${crypto.randomUUID().replace(/-/g, '')}.pt`;
    const url = R2.signedUrl('PUT', key, 900);
    const ticket = jwt.sign({ tipo: 'subida-r2', key, size, etiqueta, detalle, conf: Number(conf_default), uid: req.usuario.id }, process.env.JWT_SECRET, { expiresIn: '20m' });
    res.json({ success: true, data: { upload_url: url, ticket, expires_seconds: 900, max_bytes: LIMITE } });
  } catch (e) { next(e); }
}

// Solo registra después de comprobar que el objeto existe y se puede abrir.
async function confirmarSubida(req, res, next) {
  try {
    let ticket;
    try { ticket = jwt.verify(String(req.body.ticket || ''), process.env.JWT_SECRET); }
    catch { return res.status(400).json({ success: false, message: 'La autorización de subida expiró. Vuelve a seleccionar el archivo.' }); }
    if (ticket.tipo !== 'subida-r2' || ticket.uid !== req.usuario.id || !esR2(ticket.key)) {
      return res.status(403).json({ success: false, message: 'Subida no autorizada.' });
    }
    const existing = await Modelo.buscarPorArchivo(ticket.key);
    if (existing) return res.json({ success: true, data: { id: existing.id, clases: safeParse(existing.clases) } });
    const obj = await R2.head(ticket.key);
    if (!obj || obj.size !== ticket.size) return res.status(409).json({ success: false, message: 'R2 no recibió el archivo completo. Reintenta la subida.' });
    let info;
    try { info = await Inferencia.cargarModelo(ticket.key); }
    catch (e) {
      return res.status(422).json({ success: false, message: `El servicio YOLO no pudo abrir ese modelo: ${e.response?.data?.detail || e.message}` });
    }
    const id = await Modelo.crear({
      nombre: ticket.etiqueta, descripcion: ticket.detalle, archivo: ticket.key,
      framework: info.framework || 'ultralytics-yolo', clases: info.classes || null,
      confDefault: ticket.conf, subidoPor: req.usuario.id,
    });
    res.status(201).json({ success: true, data: { id, clases: info.classes || null } });
  } catch (e) { next(e); }
}

// El POST multipart anterior ya no puede funcionar de forma persistente en Vercel.
function subirAnterior(req, res) {
  res.status(410).json({ success: false, message: 'La carga de pesos ahora utiliza subida directa a R2. Actualiza el frontend.' });
}

async function activar(req, res, next) {
  try {
    const m = await Modelo.buscarPorId(req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Modelo no encontrado' });
    if (!esR2(m.archivo) && m.archivo !== 'best.pt') {
      return res.status(410).json({ success: false, message: 'Este modelo no está disponible en R2 ni incluido en el servidor.' });
    }
    await Inferencia.activarModelo(m.archivo);
    await Modelo.activar(m.id);
    res.json({ success: true, message: 'Modelo activado', data: { id: m.id } });
  } catch (e) { next(e); }
}

async function eliminar(req, res, next) {
  try {
    const m = await Modelo.buscarPorId(req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Modelo no encontrado' });
    await Modelo.eliminar(m.id);
    if (esR2(m.archivo)) {
      try { await R2.remove(m.archivo); } catch (e) { console.error('No se pudo limpiar R2:', e.message); }
    }
    res.json({ success: true, message: 'Modelo eliminado' });
  } catch (e) { next(e); }
}

module.exports = { listar, activo, prepararSubida, confirmarSubida, subir: subirAnterior, activar, eliminar };
