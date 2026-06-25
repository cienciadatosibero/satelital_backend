// Manejo centralizado de errores -> respuesta JSON consistente
function errorHandler(err, req, res, next) {
  // Si el error viene de una llamada axios (al microservicio Python),
  // el detalle útil está en err.response.data, no en err.message.
  let mensaje = err.publicMessage || err.message || 'Error interno del servidor';
  if (err.response) {
    const data = err.response.data;
    const detalle = data?.detail || data?.message || JSON.stringify(data);
    mensaje = `Inferencia respondió ${err.response.status}: ${detalle}`;
  } else if (err.code === 'ECONNREFUSED') {
    mensaje =
      'No se pudo conectar con el microservicio de inferencia (¿está corriendo en el puerto 8000?)';
  }

  console.error('🔴', mensaje);
  // Si ya empezamos a responder (p.ej. un stream SSE), no podemos volver a
  // escribir cabeceras: solo cerramos la conexión.
  if (res.headersSent) {
    return res.end();
  }
  const status = err.status || err.response?.status || 500;
  res.status(status).json({ success: false, message: mensaje });
}

// 404 para rutas no encontradas
function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Recurso no encontrado' });
}

module.exports = { errorHandler, notFound };
