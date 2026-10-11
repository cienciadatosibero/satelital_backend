Cambios aplicados en el backend:
- Configuración de producción incluida en .env.production.
- vercel.json con variables de entorno y ruteo hacia api/index.js.
- api/index.js para desplegar Express como función en Vercel.
- CORS restringido a https://satelital.vercel.app.
- Conexión MySQL/TiDB con soporte para SSL y CA opcional.
