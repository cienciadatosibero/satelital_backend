// tileService.js
// ---------------------------------------------------------------------------
// Descarga tiles satelitales de Google por COORDENADAS (no por pantalla) y
// los divide en celdas listas para inferencia. Toda la lógica de proyección
// usa Web Mercator (EPSG:3857), igual que Leaflet/Google, así que los
// píxeles que devolvemos son georreferenciables linealmente dentro de cada
// celda con el mismo geoService que ya usabas.
//
// Conceptos:
//   - Un "tile" mide 256x256 px en un zoom dado.
//   - En un zoom Z hay 2^Z tiles por lado en todo el mundo.
//   - lng/lat -> (x,y) de tile mundial es una fórmula cerrada (Mercator).
//
// Exporta:
//   planificarCeldas(bounds, zoom, celdaPx) -> { celdas:[...], zoom, ... }
//   capturarCelda(celda) -> { base64, width, height }
// ---------------------------------------------------------------------------

const axios = require('axios');

const TILE = 256;

// --- Proyección Web Mercator -----------------------------------------------
function lngADxMundial(lng, z) {
  return ((lng + 180) / 360) * Math.pow(2, z); // en "unidades de tile"
}
function latADyMundial(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, z)
  );
}
// inversa: de unidad-de-tile mundial -> lng / lat
function dxMundialALng(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function dyMundialALat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Zoom de barrido: nivel donde la imagen satelital de Google se ve nítida.
const ZOOM_ESCANEO = 20;

// ---------------------------------------------------------------------------
// Planifica el barrido: divide el área en segmentos cuadrados de `ladoPx`
// píxeles a ZOOM FIJO (nítido). El área SOLO define el territorio; el zoom no
// depende del tamaño del área. Cada segmento trae sus bounds geográficos.
// ---------------------------------------------------------------------------
function planificarCeldas(bounds, { ladoPx = 640, zoom = ZOOM_ESCANEO, solape = 0.15 } = {}) {
  if (!Number.isFinite(Number(ladoPx)) || ladoPx < 256 || ladoPx > 1024) {
    throw new Error('lado_px debe estar entre 256 y 1024');
  }
  if (!Number.isFinite(Number(zoom)) || zoom < 1 || zoom > 21) {
    throw new Error('Zoom fuera del rango admitido (1-21)');
  }
  const z = Math.max(1, Math.min(21, Math.round(zoom)));

  // Esquinas en píxeles mundiales (256 * unidad-de-tile) al zoom fijo
  const pxOeste = lngADxMundial(bounds.west, z) * TILE;
  const pxEste = lngADxMundial(bounds.east, z) * TILE;
  const pxNorte = latADyMundial(bounds.north, z) * TILE;
  const pxSur = latADyMundial(bounds.south, z) * TILE;

  const anchoPx = Math.abs(pxEste - pxOeste);
  const altoPx = Math.abs(pxSur - pxNorte);

  // Ventanas con solape para no perder paneles cortados por el borde de una tesela.
  const paso = Math.round(ladoPx * (1 - Math.min(0.4, Math.max(0, solape))));
  const cols = Math.max(1, Math.ceil(Math.max(0, anchoPx - ladoPx) / paso) + 1);
  const filas = Math.max(1, Math.ceil(Math.max(0, altoPx - ladoPx) / paso) + 1);
  const total = cols * filas;
  const limite = Number(process.env.MAX_CELDAS_ESCANEO) || 2500;
  if (total > limite) {
    throw new Error(`Área demasiado grande al zoom seleccionado (${total} celdas; máximo ${limite}). Reduce el rectángulo.`);
  }

  const x0 = Math.min(pxOeste, pxEste);
  const y0 = Math.min(pxNorte, pxSur);

  const celdas = [];
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < cols; c++) {
      const px1 = x0 + c * paso;
      const py1 = y0 + f * paso;
      const px2 = px1 + ladoPx;
      const py2 = py1 + ladoPx;

      const celdaBounds = {
        west: dxMundialALng(px1 / TILE, z),
        east: dxMundialALng(px2 / TILE, z),
        north: dyMundialALat(py1 / TILE, z),
        south: dyMundialALat(py2 / TILE, z),
      };

      celdas.push({ fila: f, col: c, zoom: z, px1, py1, px2, py2, bounds: celdaBounds });
    }
  }

  return { zoom: z, cols, filas, total, ladoPx, paso, celdas };
}

// ---------------------------------------------------------------------------
// Descarga y ensambla una celda: baja todos los tiles 256x256 que la cubren,
// los pega en un canvas con `sharp` y recorta exactamente la celda.
// ---------------------------------------------------------------------------
let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const TILE_URL = (x, y, z) =>
  `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;

async function bajarTile(x, y, z) {
  const { data } = await axios.get(TILE_URL(x, y, z), {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (SatDataset tile fetcher)' },
  });
  return Buffer.from(data);
}

async function capturarCelda(celda) {
  if (!sharp) {
    throw new Error(
      "Falta la dependencia 'sharp'. Instala con: npm install sharp"
    );
  }
  const z = celda.zoom;
  const tileX0 = Math.floor(celda.px1 / TILE);
  const tileY0 = Math.floor(celda.py1 / TILE);
  const tileX1 = Math.floor((celda.px2 - 1) / TILE);
  const tileY1 = Math.floor((celda.py2 - 1) / TILE);

  const tilesAncho = tileX1 - tileX0 + 1;
  const tilesAlto = tileY1 - tileY0 + 1;
  const lienzoW = tilesAncho * TILE;
  const lienzoH = tilesAlto * TILE;

  // Descarga todos los tiles del bloque en paralelo
  const composites = [];
  const descargas = [];
  for (let ty = tileY0; ty <= tileY1; ty++) {
    for (let tx = tileX0; tx <= tileX1; tx++) {
      descargas.push(
        bajarTile(tx, ty, z).then((buf) => {
          composites.push({
            input: buf,
            top: (ty - tileY0) * TILE,
            left: (tx - tileX0) * TILE,
          });
        })
      );
    }
  }
  await Promise.all(descargas);

  // Lienzo base + pegado de tiles
  const lienzo = sharp({
    create: {
      width: lienzoW,
      height: lienzoH,
      channels: 3,
      background: { r: 7, g: 10, b: 15 },
    },
  }).composite(composites);

  // Recorte exacto de la celda dentro del lienzo de tiles, con CLAMP a los
  // límites del lienzo para evitar "bad extract area" de sharp.
  let offsetX = Math.round(celda.px1 - tileX0 * TILE);
  let offsetY = Math.round(celda.py1 - tileY0 * TILE);
  let cropW = Math.round(celda.px2 - celda.px1);
  let cropH = Math.round(celda.py2 - celda.py1);

  // No permitir offsets negativos
  if (offsetX < 0) {
    cropW += offsetX;
    offsetX = 0;
  }
  if (offsetY < 0) {
    cropH += offsetY;
    offsetY = 0;
  }
  // No salirse por la derecha/abajo del lienzo
  if (offsetX + cropW > lienzoW) cropW = lienzoW - offsetX;
  if (offsetY + cropH > lienzoH) cropH = lienzoH - offsetY;
  // Tamaño mínimo válido
  cropW = Math.max(1, cropW);
  cropH = Math.max(1, cropH);

  const jpg = await lienzo
    .png() // preservar píxeles antes del recorte: evita doble compresión JPEG
    .toBuffer()
    .then((buf) =>
      sharp(buf)
        .extract({
          left: offsetX,
          top: offsetY,
          width: cropW,
          height: cropH,
        })
        .jpeg({ quality: 92 })
        .toBuffer()
    );

  return {
    base64: 'data:image/jpeg;base64,' + jpg.toString('base64'),
    width: cropW,
    height: cropH,
  };
}

// ---------------------------------------------------------------------------
// Captura una foto NÍTIDA centrada en una coordenada (lat/lng), a zoom fijo.
// Devuelve la imagen y sus bounds (para poder reubicar la caja si hiciera falta).
// ladoPx: tamaño del recorte cuadrado alrededor del punto.
// ---------------------------------------------------------------------------
async function capturarCentrada(lat, lng, { ladoPx = 600, zoom = ZOOM_ESCANEO } = {}) {
  const z = Math.max(1, Math.min(21, Math.round(zoom)));
  // Centro en píxeles mundiales
  const cx = lngADxMundial(lng, z) * TILE;
  const cy = latADyMundial(lat, z) * TILE;

  const px1 = cx - ladoPx / 2;
  const py1 = cy - ladoPx / 2;
  const px2 = cx + ladoPx / 2;
  const py2 = cy + ladoPx / 2;

  const celda = {
    fila: 0,
    col: 0,
    zoom: z,
    px1,
    py1,
    px2,
    py2,
    bounds: {
      west: dxMundialALng(px1 / TILE, z),
      east: dxMundialALng(px2 / TILE, z),
      north: dyMundialALat(py1 / TILE, z),
      south: dyMundialALat(py2 / TILE, z),
    },
  };

  const img = await capturarCelda(celda);
  return { ...img, bounds: celda.bounds };
}

module.exports = { planificarCeldas, capturarCelda, capturarCentrada, ZOOM_ESCANEO };
