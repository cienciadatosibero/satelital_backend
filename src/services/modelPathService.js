const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads', 'weights');
const BUNDLED_DIR = path.join(PROJECT_ROOT, 'src', 'models');

// Nunca interpretar rutas absolutas o segmentos ../ que vinieran de la BD.
function rutaPeso(nombreArchivo) {
  if (typeof nombreArchivo !== 'string' ||
      !nombreArchivo || path.basename(nombreArchivo) !== nombreArchivo ||
      !/^[\w.\- ]+\.(pt|pth|onnx|weights)$/i.test(nombreArchivo)) {
    return null;
  }
  for (const directorio of [UPLOAD_DIR, BUNDLED_DIR]) {
    const archivo = path.join(directorio, nombreArchivo);
    if (fs.existsSync(archivo) && fs.statSync(archivo).isFile()) return archivo;
  }
  return null;
}

function esPesoSubido(ruta) {
  return !!ruta && path.dirname(path.resolve(ruta)) === UPLOAD_DIR;
}

module.exports = { rutaPeso, esPesoSubido };
