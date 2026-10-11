// En Vercel el proyecto es de solo lectura: NO crear carpetas al importar.
// La subida persistente de nuevos pesos se deshabilita en serverless: necesita object storage.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const destino = path.join(__dirname, '..', '..', 'uploads', 'weights');
const esVercel = Boolean(process.env.VERCEL);

const storage = esVercel
  ? multer.memoryStorage()
  : multer.diskStorage({
    destination: (req, file, cb) => {
      // Crear solo al subir, nunca durante el arranque del servidor.
      fs.mkdir(destino, { recursive: true }, (err) => cb(err, destino));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.pt';
      const base = path.basename(file.originalname, ext)
        .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  });

const fileFilter = (req, file, cb) => {
  const permitidas = ['.pt', '.pth', '.onnx', '.weights'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (permitidas.includes(ext)) cb(null, true);
  else cb(new Error('Formato no permitido. Usa .pt, .pth, .onnx o .weights'));
};

const uploadPesos = multer({
  storage,
  fileFilter,
  limits: { fileSize: esVercel ? 4 * 1024 * 1024 : 500 * 1024 * 1024 },
});

function requiereAlmacenamientoDeModelos(req, res, next) {
  if (esVercel) {
    return res.status(501).json({
      success: false,
      message: 'Vercel no almacena archivos .pt de forma persistente. Publica el modelo ONNX en inferencia o configura almacenamiento externo.',
    });
  }
  next();
}

module.exports = { uploadPesos, requiereAlmacenamientoDeModelos };
