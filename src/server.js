const app = require('./app');
require('./config/db'); // dispara la prueba de conexión

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 API del Generador de Datasets Satelitales en http://localhost:${PORT}`);
  console.log(`   Microservicio de inferencia: ${process.env.INFERENCE_URL || 'http://localhost:8000'}`);
});
