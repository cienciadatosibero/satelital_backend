// Crea (o reescribe) los usuarios iniciales con hashes bcrypt válidos
// generados en TU entorno. Ejecuta: npm run seed
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
  const usuarios = [
    { nombre: 'Administrador', usuario: process.env.SEED_ADMIN_USER || 'admin', password: process.env.SEED_ADMIN_PASSWORD, rol: 'admin' },
    ...(process.env.SEED_INVITADO_PASSWORD ? [{ nombre: 'Invitado', usuario: process.env.SEED_INVITADO_USER || 'invitado', password: process.env.SEED_INVITADO_PASSWORD, rol: 'invitado' }] : []),
  ];

  if (!usuarios[0].password || usuarios[0].password.length < 12) {
    throw new Error('Define SEED_ADMIN_PASSWORD con al menos 12 caracteres antes de ejecutar npm run seed');
  }

  for (const u of usuarios) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO usuarios (nombre, usuario, password_hash, rol)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), rol = VALUES(rol), nombre = VALUES(nombre)`,
      [u.nombre, u.usuario, hash, u.rol]
    );
    console.log(`✔ Usuario "${u.usuario}" listo`);
  }

  console.log('\nSeed completado. Cambia las contraseñas tras el primer login.');
  process.exit(0);
}

seed().catch((e) => {
  console.error('Error en seed:', e.message);
  process.exit(1);
});
