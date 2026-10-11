const path = require('path');
const fs = require('fs');
const { rutaPeso, esPesoSubido } = require('../services/modelPathService');
const Modelo = require('../models/modeloModel');
const Inferencia = require('../services/inferenceService');

const dirPesos = path.join(__dirname, '..', '..', 'uploads', 'weights');

// GET /api/modelos  (cualquiera autenticado)
async function listar(req, res, next) {
  try {
    const modelos = await Modelo.listar();
    const data = modelos.map((m) => ({
      ...m,
      clases: m.clases ? safeParse(m.clases) : null,
      // no exponemos rutas absolutas
      archivo: undefined,
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/modelos  (admin) — multipart con campo "peso"
async function subir(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Falta el archivo del peso' });
    }
    const { nombre, descripcion, conf_default } = req.body;
    const rutaAbs = req.file.path;

    // Pedimos al microservicio que cargue el peso y nos diga sus clases
    let clases = null;
    let framework = 'yolo';
    try {
      const info = await Inferencia.cargarModelo(rutaAbs);
      clases = info.classes || null;
      framework = info.framework || 'yolo';
    } catch (e) {
      // El peso se guarda igual; las clases se resolverán al activarlo
      console.warn('No se pudieron leer clases al subir:', e.message);
    }

    const id = await Modelo.crear({
      nombre: nombre || req.file.originalname,
      descripcion,
      archivo: req.file.filename,
      framework,
      clases,
      confDefault: Number.isFinite(Number(conf_default)) && conf_default !== ''
        ? Number(conf_default) : 0.25,
      subidoPor: req.usuario.id,
    });

    res.status(201).json({ success: true, data: { id, clases } });
  } catch (err) {
    next(err);
  }
}

// POST /api/modelos/:id/activar  (admin)
async function activar(req, res, next) {
  try {
    const { id } = req.params;
    const m = await Modelo.buscarPorId(id);
    if (!m) return res.status(404).json({ success: false, message: 'Modelo no encontrado' });

    const rutaAbs = rutaPeso(m.archivo);
    if (!rutaAbs) {
      return res
        .status(410)
        .json({ success: false, message: 'El archivo del peso ya no existe en el servidor' });
    }

    try {
      await Inferencia.activarModelo(rutaAbs);
    } catch (error) {
      if (error.response?.status === 400 || error.response?.status === 404) {
        return res.status(409).json({ success: false, message:
          'El microservicio de inferencia no puede abrir ese .pt. Si está desplegado por separado, el peso debe existir también en ese servidor; las rutas del API no son compartidas.' });
      }
      throw error;
    }
    await Modelo.activar(id);
    res.json({ success: true, message: 'Modelo activado' });
  } catch (err) {
    next(err);
  }
}

// GET /api/modelos/activo
async function activo(req, res, next) {
  try {
    const m = await Modelo.buscarActivo();
    if (!m) return res.json({ success: true, data: null });
    res.json({
      success: true,
      data: { ...m, clases: m.clases ? safeParse(m.clases) : null, archivo: undefined },
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/modelos/:id  (admin)
async function eliminar(req, res, next) {
  try {
    const { id } = req.params;
    const m = await Modelo.buscarPorId(id);
    if (m) {
      const rutaAbs = rutaPeso(m.archivo);
      // Un peso incluido en el repositorio no debe eliminarse del sistema.
      if (esPesoSubido(rutaAbs) && fs.existsSync(rutaAbs)) fs.unlinkSync(rutaAbs);
      await Modelo.eliminar(id);
    }
    res.json({ success: true, message: 'Modelo eliminado' });
  } catch (err) {
    next(err);
  }
}

function safeParse(v) {
  try {
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}

module.exports = { listar, subir, activar, activo, eliminar };
