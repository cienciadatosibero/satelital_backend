const { rutaPeso } = require('../services/modelPathService');
const { Sesion, Deteccion, Celda } = require('../models/sesionModel');
const Modelo = require('../models/modeloModel');
const Inferencia = require('../services/inferenceService');
const { pixelABoundsLatLng } = require('../services/geoService');
const { construirZipDataset } = require('../services/exportService');
const { planificarCeldas, capturarCelda, capturarCentrada, ZOOM_ESCANEO } = require('../services/tileService');
const { guardarRecorte, guardarDeteccion, borrarSesion, rutaAbsoluta } = require('../services/recorteService');
const fs = require('fs');
const { cajaMundial, deduplicar, asociarSegundaPasada, cajaLimitada } = require('../services/detectionQualityService');

// Vuelve a activar el peso persistido en BD después de reinicios del proceso
// Python. No se debe inferir silenciosamente con otro best.pt.
async function asegurarModelo(modelo) {
  if (!modelo) throw new Error('No hay modelo activo en la base de datos');
  const archivo = rutaPeso(modelo.archivo);
  if (!archivo) throw new Error(`No está instalado el peso del modelo activo: ${modelo.nombre}`);
  const estado = await Inferencia.estado();
  const actual = estado.active_path || estado.model_path;
  if (!actual || require('path').resolve(actual) !== archivo) {
    await Inferencia.activarModelo(archivo);
  }
}

// POST /api/detectar
// body: { imagen_base64, bounds:{north,south,east,west}, zoom, confianza, guardar, nombre_sesion }
// Ejecuta YOLO sobre la captura, georreferencia cada caja y (opcional) crea sesión.
async function detectar(req, res, next) {
  let sesionId = null;
  try {
    const { imagen_base64, bounds, zoom, confianza, guardar, nombre_sesion } = req.body;

    if (!imagen_base64) {
      return res.status(400).json({ success: false, message: 'Falta la imagen capturada' });
    }
    if (!bounds || ['north', 'south', 'east', 'west'].some((key) =>
      !Number.isFinite(Number(bounds[key])) || bounds[key] == null)) {
      return res
        .status(400)
        .json({ success: false, message: 'Faltan los límites geográficos (bounds)' });
    }

    if (Math.abs(Number(bounds.north)) > 85.05112878 || Math.abs(Number(bounds.south)) > 85.05112878 ||
        Math.abs(Number(bounds.east)) > 180 || Math.abs(Number(bounds.west)) > 180 ||
        Number(bounds.north) <= Number(bounds.south) || Number(bounds.east) <= Number(bounds.west)) {
      return res.status(400).json({ success: false, message: 'Coordenadas geográficas inválidas' });
    }
    if (confianza != null && (!Number.isFinite(Number(confianza)) || Number(confianza) < 0.05 || Number(confianza) > 0.95)) {
      return res.status(400).json({ success: false, message: 'Confianza inválida (0.05 a 0.95)' });
    }

    const modeloActivo = await Modelo.buscarActivo();
    if (!modeloActivo) return res.status(409).json({ success: false, message: 'No hay modelo activo' });
    await asegurarModelo(modeloActivo);

    // 1) Inferencia en el microservicio Python
    const resultado = await Inferencia.detectar({
      imagenBase64: imagen_base64,
      confianza: confianza == null ? (modeloActivo?.conf_default ?? 0.25) : Number(confianza),
      devolverRecortes: true,
    });

    const imgW = resultado.image_width;
    const imgH = resultado.image_height;

    // 2) Georreferenciar cada detección (centro de la caja -> lat/lng)
    const detecciones = (resultado.detections || []).map((d) => {
      const { lat, lng } = pixelABoundsLatLng(bounds, imgW, imgH, {
        x: d.x,
        y: d.y,
        w: d.w,
        h: d.h,
      });
      return {
        clase: d.class_name,
        confianza: Number(d.confidence.toFixed(4)),
        lat,
        lng,
        bbox_x: Math.round(d.x),
        bbox_y: Math.round(d.y),
        bbox_w: Math.round(d.w),
        bbox_h: Math.round(d.h),
        recorte_base64: d.crop_base64 || null,
      };
    });

    // 3) Persistir como sesión si se pidió. Imágenes a DISCO, no a MySQL.
    if (guardar) {
      sesionId = await Sesion.crear({
        usuarioId: req.usuario.id,
        modeloId: modeloActivo?.id || null,
        nombre: nombre_sesion,
        bounds,
        zoom,
      });
      // El bbox está definido sobre la imagen COMPLETA. Si guardáramos solo
      // el recorte YOLO, las etiquetas exportadas tendrían coordenadas inválidas.
      for (let i = 0; i < detecciones.length; i++) {
        const d = detecciones[i];
        d.recorte_path = guardarRecorte(sesionId, i, imagen_base64);
        d.deteccion_path = await guardarDeteccion(sesionId, i, imagen_base64, {
          x: d.bbox_x, y: d.bbox_y, w: d.bbox_w, h: d.bbox_h,
          conf: d.confianza, clase: d.clase,
        });
        delete d.recorte_base64;
      }
      const ids = await Deteccion.crearLote(sesionId, detecciones);
      ids.forEach((id, i) => (detecciones[i].id = id));
      await Sesion.actualizarTotal(sesionId);
      if (detecciones.length === 0) await Sesion.actualizarEstado(sesionId, 'revisada');
    }

    const base = `${req.protocol}://${req.get('host')}`;
    const detsSalida = detecciones.map((d) => ({
      ...d,
      recorte_url: d.recorte_path ? base + d.recorte_path : null,
      recorte_base64: undefined,
    }));

    res.json({
      success: true,
      data: {
        sesion_id: sesionId,
        total: detecciones.length,
        image_width: imgW,
        image_height: imgH,
        detecciones: detsSalida,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function detectarArea(req, res, next) {
  const t0 = Date.now();
  let sesionId = null;

  // SSE: emitimos progreso celda por celda. El cliente usa fetch + stream.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const enviar = (evento, datos) => {
    res.write(`event: ${evento}\n`);
    res.write(`data: ${JSON.stringify(datos)}\n\n`);
  };

  try {
    const { bounds, lado_px, zoom, confianza, guardar = true, nombre_sesion } = req.body;

    if (!bounds || ['north', 'south', 'east', 'west'].some((k) =>
      bounds[k] == null || !Number.isFinite(Number(bounds[k])))) {
      enviar('error', { message: 'Faltan las 4 coordenadas del área (bounds)' });
      return res.end();
    }
    if (Math.abs(bounds.north) > 85.05112878 || Math.abs(bounds.south) > 85.05112878 ||
        Math.abs(bounds.east) > 180 || Math.abs(bounds.west) > 180 ||
        Number(bounds.north) <= Number(bounds.south) || Number(bounds.east) <= Number(bounds.west)) {
      enviar('error', { message: 'Coordenadas inválidas: norte>sur y este>oeste' });
      return res.end();
    }

    const conf = confianza == null ? 0.20 : Number(confianza);
    if (!Number.isFinite(conf) || conf < 0.05 || conf > 0.95) {
      enviar('error', { message: 'Confianza inválida (se admite de 0.05 a 0.95)' });
      return res.end();
    }

    // 1) Planificar el barrido a ZOOM FIJO (nítido). El área solo define el
    //    territorio; el zoom NO depende del tamaño del área.
    const plan = planificarCeldas(bounds, {
      ladoPx: Number(lado_px) || 640,
      zoom: Number(zoom) || ZOOM_ESCANEO,
    });

    const modeloActivo = await Modelo.buscarActivo();
    if (!modeloActivo) {
      enviar('error', { message: 'No hay modelo activo' });
      return res.end();
    }
    await asegurarModelo(modeloActivo);

    enviar('inicio', {
      total_celdas: plan.total,
      cols: plan.cols,
      filas: plan.filas,
      zoom: plan.zoom,
    });

    if (guardar) {
      sesionId = await Sesion.crear({
        usuarioId: req.usuario.id,
        modeloId: modeloActivo.id,
        nombre: nombre_sesion || `Área ${new Date().toLocaleString('es-MX')}`,
        bounds,
        zoom: plan.zoom,
      });
    }

    // Primera pasada: detectar candidatos sobre teselas con solape, SIN
    // tomar aún fotografías centradas. Así podemos deduplicar antes de
    // gastar peticiones de red y llamadas extra al modelo.
    const candidatos = [];
    const tiemposCelda = [];
    for (let i = 0; i < plan.celdas.length; i++) {
      const celda = plan.celdas[i];
      const tc = Date.now();
      const img = await capturarCelda(celda);
      const r = await Inferencia.detectar({
        imagenBase64: img.base64, confianza: conf, devolverRecortes: false,
      });
      for (const d of r.detections || []) {
        if (![d.x, d.y, d.w, d.h, d.confidence].every(Number.isFinite) || d.w <= 0 || d.h <= 0) continue;
        const { lat, lng } = pixelABoundsLatLng(celda.bounds, r.image_width, r.image_height, d);
        // Un solape puede producir un centro fuera del área dibujada.
        if (lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) continue;
        candidatos.push({ d, celda, lat, lng, cajaMundial: cajaMundial(celda, d) });
      }
      const msCelda = Date.now() - tc;
      tiemposCelda.push(msCelda);
      enviar('progreso', {
        fase: 'detectando', celda: i + 1, total_celdas: plan.total,
        detecciones_en_celda: r.detections?.length || 0,
        detecciones_acumuladas: candidatos.length,
        ms_celda: msCelda,
      });
    }

    const unicos = deduplicar(candidatos);
    enviar('candidatos', { sin_duplicados: unicos.length, totales: candidatos.length });
    const todas = [];
    let contadorPanel = 0;
    for (let i = 0; i < unicos.length; i++) {
      const { d, lat, lng } = unicos[i];
      const foto = await capturarCentrada(lat, lng, { ladoPx: 600, zoom: plan.zoom });
      const r2 = await Inferencia.detectar({
        imagenBase64: foto.base64, confianza: conf, devolverRecortes: false,
      });
      const match = asociarSegundaPasada(r2.detections, d, foto.width, foto.height);
      // Si la segunda pasada no encuentra la misma clase cercana al centro,
      // conservar el candidato inicial como pendiente para revisión humana.
      // No sustituirlo por otro objeto arbitrario de la foto.
      const elegido = match || {
        ...d,
        x: foto.width / 2 - d.w / 2,
        y: foto.height / 2 - d.h / 2,
      };
      const caja = cajaLimitada(elegido, foto.width, foto.height);
      const coordenadas = match
        ? pixelABoundsLatLng(foto.bounds, foto.width, foto.height, caja)
        : { lat, lng };
      const det = {
        celda_id: null,
        clase: caja.clase,
        confianza: Number(caja.conf.toFixed(4)),
        lat: coordenadas.lat,
        lng: coordenadas.lng,
        bbox_x: caja.x,
        bbox_y: caja.y,
        bbox_w: caja.w,
        bbox_h: caja.h,
        img_w: foto.width,
        img_h: foto.height,
      };
      if (guardar) {
        det.recorte_path = guardarRecorte(sesionId, contadorPanel, foto.base64);
        det.deteccion_path = await guardarDeteccion(sesionId, contadorPanel, foto.base64, caja);
        const [id] = await Deteccion.crearLote(sesionId, [det]);
        det.id = id;
      }
      contadorPanel++;
      todas.push(det);
      enviar('verificacion', {
        fase: 'verificando', celda: i + 1,
        total_celdas: unicos.length,
        detecciones_acumuladas: todas.length,
      });
    }

    if (guardar) {
      await Sesion.actualizarTotal(sesionId);
      // Sin detecciones pendientes: la sesión puede marcarse como revisada.
      // Si hay candidatos, permanece en_progreso hasta la revisión humana.
      if (todas.length === 0) await Sesion.actualizarEstado(sesionId, 'revisada');
    }

    // Para el frontend: URL absoluta de cada foto centrada
    const base = `${req.protocol}://${req.get('host')}`;
    const detsSalida = todas.map((d) => ({
      ...d,
      recorte_url: d.recorte_path ? base + d.recorte_path : null,
      recorte_base64: undefined,
    }));

    const totalMs = Date.now() - t0;
    const promedioCeldaMs = tiemposCelda.length
      ? Math.round(tiemposCelda.reduce((a, b) => a + b, 0) / tiemposCelda.length)
      : 0;

    // Evento final con todo el resultado
    enviar('fin', {
      sesion_id: sesionId,
      total: todas.length,
      candidatos_brutos: candidatos.length,
      duplicados_descartados: candidatos.length - unicos.length,
      detecciones: detsSalida,
      cuadricula: {
        cols: plan.cols,
        filas: plan.filas,
        total_celdas: plan.total,
        zoom: plan.zoom,
        lado_metros: plan.ladoMetros,
      },
      tiempos: {
        total_ms: totalMs,
        promedio_celda_ms: promedioCeldaMs,
      },
    });
    res.end();
  } catch (err) {
    // El ENUM real de TiDB no tiene 'error': mantener en_progreso para que
    // pueda revisarse/eliminarse la sesión parcial sin escribir un estado inválido.
    if (sesionId) console.error(`Escaneo interrumpido; sesión ${sesionId} conservada en en_progreso:`, err.message);
    try {
      enviar('error', { message: err.message || 'Error en el escaneo de área' });
      res.end();
    } catch {
      next(err);
    }
  }
}

// GET /api/sesiones
async function listarSesiones(req, res, next) {
  try {
    const sesiones = await Sesion.listarPorUsuario(req.usuario.id);
    res.json({ success: true, data: sesiones });
  } catch (err) {
    next(err);
  }
}

// GET /api/sesiones/:id/detecciones
async function detallesSesion(req, res, next) {
  try {
    const { id } = req.params;
    const sesion = await Sesion.buscarPorId(id);
    if (!sesion || sesion.usuario_id !== req.usuario.id) {
      // los admin pueden ver cualquiera
      if (!sesion || req.usuario.rol !== 'admin') {
        return res.status(404).json({ success: false, message: 'Sesión no encontrada' });
      }
    }
    const filas = await Deteccion.listarPorSesion(id);
    const base = `${req.protocol}://${req.get('host')}`;
    const detecciones = filas.map((d) => ({
      ...d,
      recorte_url: d.recorte_path ? base + d.recorte_path : null,
    }));
    res.json({ success: true, data: { sesion, detecciones } });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/detecciones/:id  body:{ revision: 'confirmado'|'descartado' }
async function revisarDeteccion(req, res, next) {
  try {
    const { id } = req.params;
    const { revision } = req.body;
    if (!['confirmado', 'descartado', 'pendiente'].includes(revision)) {
      return res.status(400).json({ success: false, message: 'Revisión inválida' });
    }
    const deteccion = await Deteccion.buscarPorId(id);
    if (!deteccion) return res.status(404).json({ success: false, message: 'Detección no encontrada' });
    if (Number(deteccion.usuario_id) !== Number(req.usuario.id) && req.usuario.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'No tienes permiso para revisar esta detección' });
    }
    await Deteccion.actualizarRevision(id, revision);
    await Sesion.actualizarEstadoSegunRevision(deteccion.sesion_id);
    res.json({ success: true, message: 'Detección actualizada' });
  } catch (err) {
    next(err);
  }
}

// GET /api/sesiones/:id/exportar  -> descarga ZIP del dataset
async function exportar(req, res, next) {
  try {
    const { id } = req.params;
    const sesion = await Sesion.buscarPorId(id);
    if (!sesion) return res.status(404).json({ success: false, message: 'Sesión no encontrada' });
    if (Number(sesion.usuario_id) !== Number(req.usuario.id) && req.usuario.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'Sin permiso' });
    }

    const confirmadas = await Deteccion.listarConfirmadas(id);
    if (!confirmadas.length) {
      return res.status(400).json({ success: false, message: 'Confirma al menos una detección antes de exportar' });
    }
    // No generar un ZIP vacío si faltan archivos del disco o del volumen persistente.
    const faltantes = confirmadas.filter((d) => {
      const ruta = rutaAbsoluta(d.recorte_path);
      return !ruta || !fs.existsSync(ruta);
    });
    if (faltantes.length) {
      return res.status(409).json({ success: false, message:
        `No se puede exportar: faltan ${faltantes.length} imágenes de detecciones confirmadas en el almacenamiento.` });
    }

    const modelo = sesion.modelo_id ? await Modelo.buscarPorId(sesion.modelo_id) : null;
    // La tabla real permite 'exportada'; usarla únicamente tras generar el ZIP.
    await construirZipDataset(res, {
      detecciones: confirmadas,
      nombreSesion: sesion.nombre,
      modeloNombre: modelo?.nombre,
    });
    await Sesion.actualizarEstado(id, 'exportada');
  } catch (err) {
    next(err);
  }
}

// DELETE /api/sesiones/:id
async function eliminarSesion(req, res, next) {
  try {
    const { id } = req.params;
    const sesion = await Sesion.buscarPorId(id);
    if (!sesion) return res.status(404).json({ success: false, message: 'Sesión no encontrada' });
    if (Number(sesion.usuario_id) !== Number(req.usuario.id) && req.usuario.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'Sin permiso para eliminar esta sesión' });
    }
    await Sesion.eliminar(id);
    borrarSesion(id);
    res.json({ success: true, message: 'Sesión eliminada' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  detectar,
  detectarArea,
  listarSesiones,
  detallesSesion,
  revisarDeteccion,
  exportar,
  eliminarSesion,
};
