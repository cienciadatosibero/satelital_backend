const multer = require('multer');
const path = require('path');
const fs = require('fs');

const destino = path.join(__dirname, '..', '..', 'uploads', 'weights');
if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, destino),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pt';
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

module.exports = { uploadPesos };
