const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function main() {
  const dbName = process.env.DB_NAME || 'satdataset';
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error('DB_NAME contiene caracteres inválidos');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT) || 3306,
    ...(String(process.env.DB_SSL).toLowerCase() === 'true'
      ? { ssl: { rejectUnauthorized: true } } : {}),
    multipleStatements: true,
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${dbName}\``);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'satdataset.sql'), 'utf8');
  await connection.query(sql);

  // Nunca crear ni restablecer contraseñas públicas/de demostración.
  // Solo se crea el administrador cuando se proporciona contraseña segura.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminPassword) {
    if (adminPassword.length < 12) throw new Error('SEED_ADMIN_PASSWORD debe tener 12 caracteres o más');
    const usuario = process.env.SEED_ADMIN_USER || 'admin';
    const hash = await bcrypt.hash(adminPassword, 10);
    await connection.query(
      `INSERT IGNORE INTO usuarios (nombre, usuario, password_hash, rol, activo)
       VALUES (?, ?, ?, 'admin', 1)`, ['Administrador', usuario, hash]
    );
  } else {
    console.log('Usuarios omitidos: define SEED_ADMIN_PASSWORD si necesitas crear el administrador.');
  }

  // No se debe desactivar ni reemplazar un modelo activo existente.
  // En especial, nunca restablecer la selección del usuario al hacer deploy.
  // El modelo de ejemplo solo se registra si hay un peso instalado y aún
  // no existe ningún modelo registrado.
  const weightsDir = path.join(__dirname, '..', 'uploads', 'weights');
  const weights = (fs.existsSync(weightsDir)
    ? fs.readdirSync(weightsDir).find((name) => name.toLowerCase().endsWith('.pt'))
    : null) || (fs.existsSync(path.join(__dirname, '..', 'src', 'models', 'best.pt'))
      ? 'best.pt' : null);
  if (weights) {
    await connection.query(
      `INSERT INTO modelos (nombre, descripcion, archivo, framework, conf_default, activo)
       SELECT ?, 'Modelo inicial del sistema', ?, 'ultralytics-yolo', 0.200, 1
       WHERE NOT EXISTS (SELECT 1 FROM modelos LIMIT 1)`,
      [weights, weights]
    );
  }

  await connection.end();
  console.log('Esquema inicializado. El usuario admin se crea solo si configuraste SEED_ADMIN_PASSWORD.');
}

main().catch((error) => {
  console.error('No se pudo preparar MySQL:', error.message);
  process.exit(1);
});
