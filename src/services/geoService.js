// Coordenadas precisas sobre imágenes de teselas Web Mercator (EPSG:3857).
// Interpolar la latitud en grados introduce errores: se debe interpolar la Y de Mercator.
const LAT_MAX = 85.05112878;

function latAY(lat) {
  const rad = Math.max(-LAT_MAX, Math.min(LAT_MAX, Number(lat))) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}
function yALat(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}
function pixelABoundsLatLng(bounds, imgW, imgH, bbox) {
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) {
    throw new Error('Dimensiones de imagen inválidas');
  }
  const fx = Math.min(1, Math.max(0, (bbox.x + bbox.w / 2) / imgW));
  const fy = Math.min(1, Math.max(0, (bbox.y + bbox.h / 2) / imgH));
  const lng = Number(bounds.west) + (Number(bounds.east) - Number(bounds.west)) * fx;
  const y = latAY(bounds.north) + (latAY(bounds.south) - latAY(bounds.north)) * fy;
  return { lat: Number(yALat(y).toFixed(8)), lng: Number(lng.toFixed(8)) };
}
module.exports = { pixelABoundsLatLng };
