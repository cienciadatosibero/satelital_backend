// Convierte una caja en píxeles (sobre la captura del mapa) a coordenadas
// geográficas, usando los límites (bounds) del mapa visible al momento de
// la captura. Es una interpolación lineal: válida para zooms altos donde el
// área cubierta es pequeña y la distorsión de Mercator es despreciable.
//
// bounds: { north, south, east, west }  (lat/lng de los bordes de la captura)
// imgW, imgH: dimensiones en píxeles de la imagen capturada
// bbox: { x, y, w, h } en píxeles (esquina superior izquierda + tamaño)
//
// Devuelve el centro de la caja en { lat, lng }.
function pixelABoundsLatLng(bounds, imgW, imgH, bbox) {
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;

  const fracX = cx / imgW; // 0 = oeste, 1 = este
  const fracY = cy / imgH; // 0 = norte, 1 = sur

  const lng = bounds.west + (bounds.east - bounds.west) * fracX;
  const lat = bounds.north - (bounds.north - bounds.south) * fracY;

  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
  };
}

module.exports = { pixelABoundsLatLng };
