/**
 * Une candidatos que representan el mismo objeto cuando una zona se escanea
 * con ventanas solapadas. Las cajas se comparan en píxeles MUNDIALES del mismo
 * zoom, no dentro de cada celda. Conserva la detección de mayor confianza.
 */
function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const aa = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const bb = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return inter / Math.max(aa + bb - inter, 1e-9);
}

function cajaMundial(celda, d) {
  return {
    x1: celda.px1 + Number(d.x), y1: celda.py1 + Number(d.y),
    x2: celda.px1 + Number(d.x) + Number(d.w),
    y2: celda.py1 + Number(d.y) + Number(d.h),
  };
}

function deduplicar(candidatos, umbral = 0.35) {
  const ordenados = [...candidatos].sort((a, b) => Number(b.d.confidence) - Number(a.d.confidence));
  const resultado = [];
  for (const candidato of ordenados) {
    if (resultado.some((previo) =>
      String(previo.d.class_name) === String(candidato.d.class_name) &&
      iou(previo.cajaMundial, candidato.cajaMundial) >= umbral
    )) continue;
    resultado.push(candidato);
  }
  return resultado;
}

/** Selecciona únicamente la misma clase cerca del centro donde está el objeto. */
function asociarSegundaPasada(detecciones, primera, ancho, alto) {
  const cx = ancho / 2;
  const cy = alto / 2;
  const limite = Math.min(ancho, alto) * 0.22;
  return (detecciones || [])
    .filter((e) => String(e.class_name) === String(primera.class_name))
    .map((e) => ({ e, dist: Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy) }))
    .filter(({ dist }) => dist <= limite)
    .sort((a, b) => a.dist - b.dist || b.e.confidence - a.e.confidence)[0]?.e || null;
}

/** Mantiene siempre la caja dentro de la foto de salida. */
function cajaLimitada(d, ancho, alto) {
  const x1 = Math.max(0, Math.min(ancho - 1, Math.round(d.x)));
  const y1 = Math.max(0, Math.min(alto - 1, Math.round(d.y)));
  const x2 = Math.min(ancho, Math.max(x1 + 1, Math.round(Number(d.x) + Number(d.w))));
  const y2 = Math.min(alto, Math.max(y1 + 1, Math.round(Number(d.y) + Number(d.h))));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1,
    conf: Number(d.confidence), clase: String(d.class_name) };
}
module.exports = { iou, cajaMundial, deduplicar, asociarSegundaPasada, cajaLimitada };
