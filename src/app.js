const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const rutas = require('./routes');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

const app = express();

const allowedOrigins = String(process.env.CORS_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
}));
app.use(morgan('dev'));
// Las capturas de mapa en base64 son grandes
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

// Publicar solo las fotos para revisión; NUNCA exponer uploads/weights.
// Las imágenes permanecen accesibles por URL a quien conozca su enlace.
app.use('/uploads/recortes', express.static(path.join(__dirname, '..', 'uploads', 'recortes')));

app.get('/', (req, res) => res.json({ success: true, service: 'satdataset-api', health: '/api/health' }));
app.use('/api', rutas);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
