const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.production'), override: false });

const useSSL = String(process.env.DB_SSL).toLowerCase() === 'true';

function buildSslConfig() {
  if (!useSSL) return undefined;

  const caPath = process.env.DB_SSL_CA_PATH;
  const caText = process.env.DB_SSL_CA;
  const ssl = { rejectUnauthorized: true };

  if (caPath && caPath !== '<CA_PATH>' && fs.existsSync(caPath)) {
    ssl.ca = fs.readFileSync(caPath, 'utf8');
  } else if (caText && caText !== '<CA_PATH>') {
    ssl.ca = caText;
  }

  return ssl;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectTimeout: 8000,
  connectionLimit: process.env.VERCEL ? 2 : 10,
  queueLimit: 0,
  ...(useSSL ? { ssl: buildSslConfig() } : {}),
});

if (!process.env.VERCEL) (async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Conexión a MySQL establecida');
    conn.release();
  } catch (err) {
    console.error('❌ Error de conexión a MySQL:', err.message);
  }
})();

module.exports = pool;
