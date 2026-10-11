const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const rutas = require('./routes');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(morgan('dev'));
// Las capturas de mapa en base64 son grandes
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

// Publicar solo las fotos para revisión; NUNCA exponer uploads/weights.
// Las imágenes permanecen accesibles por URL a quien conozca su enlace.
app.use('/uploads/recortes', express.static(path.join(__dirname, '..', 'uploads', 'recortes')));

app.use('/api', rutas);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
