const mysql = require('mysql2/promise');
require('dotenv').config();

const useSSL = String(process.env.DB_SSL).toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ...(useSSL ? { ssl: { rejectUnauthorized: true } } : {}),
});

// Prueba de conexión al arrancar
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Conexión a MySQL establecida');
    conn.release();
  } catch (err) {
    console.error('❌ Error de conexión a MySQL:', err.message);
  }
})();

module.exports = pool;
