const { Sesion, Deteccion, Celda } = require('../models/sesionModel');
const Modelo = require('../models/modeloModel');
const Inferencia = require('../services/inferenceService');
const { pixelABoundsLatLng } = require('../services/geoService');
const { construirZipDataset } = require('../services/exportService');
const { planificarCeldas, capturarCelda, capturarCentrada, ZOOM_ESCANEO } = require('../services/tileService');
const { guardarRecorte, guardarDeteccion, borrarSesion } = require('../services/recorteService');

// POST /api/detectar
// body: { imagen_base64, bounds:{north,south,east,west}, zoom, confianza, guardar, nombre_sesion }
// Ejecuta YOLO sobre la captura, georreferencia cada caja y (opcional) crea sesión.
async function detectar(req, res, next) {
  try {
    const { imagen_base64, bounds, zoom, confianza, guardar, nombre_sesion } = req.body;

    if (!imagen_base64) {
      return res.status(400).json({ success: false, message: 'Falta la imagen capturada' });
    }
    if (!bounds || bounds.north == null || bounds.south == null) {
      return res
        .status(400)
        .json({ success: false, message: 'Faltan los límites geográficos (bounds)' });
    }

    const modeloActivo = await Modelo.buscarActivo();

    // 1) Inferencia en el microservicio Python
    const resultado = await Inferencia.detectar({
      imagenBase64: imagen_base64,
      confianza: Number(confianza) || (modeloActivo?.conf_default ?? 0.25),
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
    let sesionId = null;
    if (guardar) {
      sesionId = await Sesion.crear({
        usuarioId: req.usuario.id,
        modeloId: modeloActivo?.id || null,
        nombre: nombre_sesion,
        bounds,
        zoom,
      });
      detecciones.forEach((d, i) => {
        d.recorte_path = guardarRecorte(sesionId, i, d.recorte_base64);
        delete d.recorte_base64;
      });
      const ids = await Deteccion.crearLote(sesionId, detecciones);
      ids.forEach((id, i) => (detecciones[i].id = id));
      await Sesion.actualizarTotal(sesionId);
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

    if (
      !bounds ||
      bounds.north == null || bounds.south == null ||
      bounds.east == null || bounds.west == null
    ) {
      enviar('error', { message: 'Faltan las 4 coordenadas del área (bounds)' });
      return res.end();
    }
    if (bounds.north <= bounds.south || bounds.east <= bounds.west) {
      enviar('error', { message: 'Coordenadas inválidas: norte>sur y este>oeste' });
      return res.end();
    }

    const conf = Number(confianza) || 0.05; // máxima sensibilidad

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

    enviar('inicio', {
      total_celdas: plan.total,
      cols: plan.cols,
      filas: plan.filas,
      zoom: plan.zoom,
    });

    let sesionId = null;
    if (guardar) {
      sesionId = await Sesion.crear({
        usuarioId: req.usuario.id,
        modeloId: modeloActivo.id,
        nombre: nombre_sesion || `Área ${new Date().toLocaleString('es-MX')}`,
        bounds,
        zoom: plan.zoom,
      });
    }

    // 2) Barrer segmento por segmento
    const todas = [];
    const tiemposCelda = [];
    let contadorPanel = 0;

    for (let i = 0; i < plan.celdas.length; i++) {
      const celda = plan.celdas[i];
      const tc = Date.now();

      // Foto del segmento (solo para detectar; NO se guarda)
      const img = await capturarCelda(celda);
      const resultado = await Inferencia.detectar({
        imagenBase64: img.base64,
        confianza: conf,
        devolverRecortes: false,
      });

      // 3) Por cada panel: centrar la cámara en él, tomar foto nítida 600x600
      //    y RE-ANALIZAR esa foto con YOLO para obtener la caja real sobre ella.
      const detsCelda = [];
      for (const d of resultado.detections || []) {
        const { lat, lng } = pixelABoundsLatLng(
          celda.bounds,
          resultado.image_width,
          resultado.image_height,
          { x: d.x, y: d.y, w: d.w, h: d.h }
        );

        // Foto centrada en la coordenada del panel
        const foto = await capturarCentrada(lat, lng, { ladoPx: 600, zoom: plan.zoom });

        // Segundo análisis sobre la foto centrada (caja precisa sobre ESTA imagen)
        const r2 = await Inferencia.detectar({
          imagenBase64: foto.base64,
          confianza: conf,
          devolverRecortes: false,
        });

        // Tomamos la detección más cercana al centro (es el panel objetivo)
        const cxFoto = foto.width / 2;
        const cyFoto = foto.height / 2;
        let mejor = null;
        let mejorDist = Infinity;
        for (const e of r2.detections || []) {
          const ex = e.x + e.w / 2;
          const ey = e.y + e.h / 2;
          const dist = Math.hypot(ex - cxFoto, ey - cyFoto);
          if (dist < mejorDist) {
            mejorDist = dist;
            mejor = e;
          }
        }

        // Caja final: la del segundo análisis si la hay; si no, una centrada
        const caja = mejor
          ? {
              x: Math.round(mejor.x),
              y: Math.round(mejor.y),
              w: Math.round(mejor.w),
              h: Math.round(mejor.h),
              conf: Number(mejor.confidence.toFixed(4)),
              clase: mejor.class_name,
            }
          : {
              x: Math.round(cxFoto - d.w / 2),
              y: Math.round(cyFoto - d.h / 2),
              w: Math.round(d.w),
              h: Math.round(d.h),
              conf: Number(d.confidence.toFixed(4)),
              clase: d.class_name,
            };

        const det = {
          celda_id: null,
          clase: caja.clase,
          confianza: caja.conf,
          lat,
          lng,
          bbox_x: caja.x,
          bbox_y: caja.y,
          bbox_w: caja.w,
          bbox_h: caja.h,
          img_w: foto.width,
          img_h: foto.height,
          recorte_base64: foto.base64,
        };

        if (guardar) {
          // Imagen limpia (la foto centrada)
          det.recorte_path = guardarRecorte(sesionId, contadorPanel, det.recorte_base64);
          // Imagen con el cuadro azul + "clase %" sobre la misma foto
          det.deteccion_path = await guardarDeteccion(
            sesionId,
            contadorPanel,
            det.recorte_base64,
            { ...caja }
          );
          contadorPanel++;
          delete det.recorte_base64;
        }
        detsCelda.push(det);
      }

      if (guardar && detsCelda.length) {
        const ids = await Deteccion.crearLote(sesionId, detsCelda);
        ids.forEach((id, k) => (detsCelda[k].id = id));
      }

      todas.push(...detsCelda);

      const msCelda = Date.now() - tc;
      tiemposCelda.push(msCelda);

      enviar('progreso', {
        celda: i + 1,
        total_celdas: plan.total,
        detecciones_en_celda: detsCelda.length,
        detecciones_acumuladas: todas.length,
        ms_celda: msCelda,
      });
    }

    if (guardar) {
      await Sesion.actualizarTotal(sesionId);
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
    await Deteccion.actualizarRevision(id, revision);
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
    if (sesion.usuario_id !== req.usuario.id && req.usuario.rol !== 'admin') {
      return res.status(403).json({ success: false, message: 'Sin permiso' });
    }

    const confirmadas = await Deteccion.listarConfirmadas(id);

    const modelo = sesion.modelo_id ? await Modelo.buscarPorId(sesion.modelo_id) : null;
    await Sesion.actualizarEstado(id, 'exportada');

    // El servicio escribe directamente en la respuesta (stream).
    // Exporta TODOS los cuadrantes + labels de las detecciones confirmadas.
    await construirZipDataset(res, {
      detecciones: confirmadas,
      nombreSesion: sesion.nombre,
      modeloNombre: modelo?.nombre,
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/sesiones/:id
async function eliminarSesion(req, res, next) {
  try {
    const { id } = req.params;
    const sesion = await Sesion.buscarPorId(id);
    if (sesion && (sesion.usuario_id === req.usuario.id || req.usuario.rol === 'admin')) {
      await Sesion.eliminar(id);
      borrarSesion(id); // borra también los recortes en disco
    }
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
