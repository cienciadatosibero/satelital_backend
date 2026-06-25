// recorteService.js
// ---------------------------------------------------------------------------
// Guarda los recortes de detección como archivos .jpg en disco (NO en MySQL).
// En la BD solo se almacena la ruta relativa (recorte_path).
//
//   uploads/recortes/<sesionId>/det_<fila>.jpg
//
// El navegador los pide por URL:  /uploads/recortes/<sesionId>/<archivo>.jpg
// (servida como estática en app.js)
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const RAIZ = path.join(__dirname, '..', '..', 'uploads', 'recortes');

function carpetaSesion(sesionId) {
  const dir = path.join(RAIZ, String(sesionId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Guarda un recorte base64 a disco y devuelve su ruta relativa (web).
// indice: número incremental dentro de la sesión (para el nombre).
function guardarRecorte(sesionId, indice, base64) {
  if (!base64) return null;
  const limpio = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(limpio, 'base64');
  const nombre = `det_${String(indice).padStart(5, '0')}.jpg`;
  const dir = carpetaSesion(sesionId);
  fs.writeFileSync(path.join(dir, nombre), buffer);
  // ruta relativa servida por express.static
  return `/uploads/recortes/${sesionId}/${nombre}`;
}

// Guarda la imagen COMPLETA de un cuadrante/celda y devuelve su ruta web.
function guardarCelda(sesionId, fila, col, base64) {
  if (!base64) return null;
  const limpio = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(limpio, 'base64');
  const nombre = `celda_${fila}_${col}.jpg`;
  const dir = carpetaSesion(sesionId);
  fs.writeFileSync(path.join(dir, nombre), buffer);
  return `/uploads/recortes/${sesionId}/${nombre}`;
}

// Guarda una copia de la foto con un CUADRO AZUL y el texto "clase %"
// dibujado sobre la detección. Devuelve la ruta web.
async function guardarDeteccion(sesionId, indice, base64, caja) {
  if (!base64) return null;
  const limpio = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(limpio, 'base64');

  const meta = await sharp(buffer).metadata();
  const W = meta.width || 600;
  const H = meta.height || 600;

  const x = Math.max(0, caja.x);
  const y = Math.max(0, caja.y);
  const w = Math.min(W - x, caja.w);
  const h = Math.min(H - y, caja.h);
  const pct = Math.round((caja.conf || 0) * 100);
  const etiqueta = `${caja.clase} ${pct}%`;

  // Posición del texto: encima de la caja, o dentro si no cabe arriba
  const textoY = y > 22 ? y - 6 : y + 18;
  const anchoTexto = Math.max(60, etiqueta.length * 8.5);

  const svg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="none" stroke="#2D7FF9" stroke-width="3"/>
      <rect x="${x}" y="${textoY - 15}" width="${anchoTexto}" height="20"
            fill="#2D7FF9" opacity="0.9"/>
      <text x="${x + 5}" y="${textoY}" font-family="Arial, sans-serif"
            font-size="14" font-weight="bold" fill="#ffffff">${etiqueta}</text>
    </svg>`;

  const out = await sharp(buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();

  const nombre = `det_${String(indice).padStart(5, '0')}.jpg`;
  const dir = carpetaSesion(sesionId);
  fs.writeFileSync(path.join(dir, nombre), out);
  return `/uploads/recortes/${sesionId}/${nombre}`;
}

// Ruta absoluta en disco a partir de la ruta web guardada en la BD.
function rutaAbsoluta(rutaWeb) {
  if (!rutaWeb) return null;
  const rel = rutaWeb.replace(/^\/uploads\//, '');
  return path.join(__dirname, '..', '..', 'uploads', rel);
}

// Borra todos los recortes de una sesión (al eliminar la sesión).
function borrarSesion(sesionId) {
  const dir = path.join(RAIZ, String(sesionId));
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { guardarRecorte, guardarCelda, guardarDeteccion, rutaAbsoluta, borrarSesion };
