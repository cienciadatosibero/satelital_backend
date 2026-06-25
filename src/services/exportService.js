const archiver = require('archiver');
const sharp = require('sharp');
const fs = require('fs');
const { rutaAbsoluta } = require('./recorteService');

// Tamaño uniforme de salida para TODAS las imágenes del dataset.
const SALIDA_PX = 600;

// Construye un ZIP de dataset YOLO. Cada imagen es una FOTO NÍTIDA centrada en
// un panel detectado, a 600x600 px, con su etiqueta (el panel queda al centro).
//
//   dataset/
//     images/        foto centrada de cada panel confirmado (600x600 jpg)
//     labels/        .txt YOLO por imagen (class_id cx cy w h, normalizado)
//     classes.txt    índice -> nombre de clase
//     coordenadas.csv  id, clase, confianza, lat, lng, archivo
//     README.txt
async function construirZipDataset(res, { detecciones, nombreSesion, modeloNombre }) {
  const clases = [];
  const claseId = (nombre) => {
    let i = clases.indexOf(nombre);
    if (i === -1) {
      clases.push(nombre);
      i = clases.length - 1;
    }
    return i;
  };

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    throw err;
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="dataset_${Date.now()}.zip"`);
  archive.pipe(res);

  const filasCsv = ['id,clase,confianza,lat,lng,archivo'];

  for (const d of detecciones) {
    const rutaAbs = rutaAbsoluta(d.recorte_path);
    if (!rutaAbs || !fs.existsSync(rutaAbs)) continue;

    const nombreBase = `panel_${String(d.id).padStart(5, '0')}`;
    const id = claseId(d.clase);

    // Foto limpia (sin recuadro) a 600x600
    const meta = await sharp(rutaAbs).metadata();
    const escalaX = SALIDA_PX / (meta.width || SALIDA_PX);
    const escalaY = SALIDA_PX / (meta.height || SALIDA_PX);
    const buffer600 = await sharp(rutaAbs)
      .resize(SALIDA_PX, SALIDA_PX, { fit: 'fill' })
      .jpeg({ quality: 90 })
      .toBuffer();
    archive.append(buffer600, { name: `dataset/images/${nombreBase}.jpg` });

    // Etiqueta YOLO con la caja REAL (normalizada sobre la imagen 600x600)
    const cx = ((d.bbox_x + d.bbox_w / 2) / (meta.width || SALIDA_PX)).toFixed(6);
    const cy = ((d.bbox_y + d.bbox_h / 2) / (meta.height || SALIDA_PX)).toFixed(6);
    const w = (d.bbox_w / (meta.width || SALIDA_PX)).toFixed(6);
    const h = (d.bbox_h / (meta.height || SALIDA_PX)).toFixed(6);
    const labelLine = `${id} ${cx} ${cy} ${w} ${h}`;
    archive.append(labelLine + '\n', { name: `dataset/labels/${nombreBase}.txt` });

    // Imagen con el cuadro azul + "clase %" (carpeta deteccion/)
    const rutaDet = rutaAbsoluta(d.deteccion_path);
    if (rutaDet && fs.existsSync(rutaDet)) {
      const det600 = await sharp(rutaDet)
        .resize(SALIDA_PX, SALIDA_PX, { fit: 'fill' })
        .jpeg({ quality: 90 })
        .toBuffer();
      archive.append(det600, { name: `dataset/deteccion/${nombreBase}.jpg` });
    }

    filasCsv.push(
      `${d.id},${d.clase},${Number(d.confianza).toFixed(4)},${d.lat},${d.lng},${nombreBase}.jpg`
    );
  }

  archive.append(clases.join('\n') + '\n', { name: 'dataset/classes.txt' });
  archive.append(filasCsv.join('\n') + '\n', { name: 'dataset/coordenadas.csv' });

  const readme = [
    'DATASET SATELITAL YOLO',
    '======================',
    `Sesion: ${nombreSesion || 'sin nombre'}`,
    `Modelo: ${modeloNombre || 'desconocido'}`,
    `Paneles confirmados: ${detecciones.length}`,
    `Clases: ${clases.join(', ') || 'ninguna'}`,
    `Tamano de imagen: ${SALIDA_PX}x${SALIDA_PX} px`,
    '',
    'Cada imagen es una foto NITIDA centrada en un panel detectado (zoom alto).',
    'Estructura (lista para reentrenar):',
    '  images/     Foto 600x600 centrada en el panel (limpia).',
    '  labels/     .txt YOLO (class_id cx cy w h) con la caja real.',
    '  deteccion/  Misma foto con el recuadro azul + clase y % dibujados.',
    '  classes.txt      Indice de clases.',
    '  coordenadas.csv  Coordenadas geograficas de cada panel.',
  ].join('\n');
  archive.append(readme, { name: 'dataset/README.txt' });

  await archive.finalize();
}

module.exports = { construirZipDataset };
