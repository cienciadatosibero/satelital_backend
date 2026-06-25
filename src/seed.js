// Crea (o reescribe) los usuarios iniciales con hashes bcrypt válidos
// generados en TU entorno. Ejecuta: npm run seed
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
  const usuarios = [
    { nombre: 'Administrador', usuario: 'admin', password: 'admin123', rol: 'admin' },
    { nombre: 'Invitado Demo', usuario: 'invitado', password: 'invitado123', rol: 'invitado' },
  ];

  for (const u of usuarios) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO usuarios (nombre, usuario, password_hash, rol)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), rol = VALUES(rol), nombre = VALUES(nombre)`,
      [u.nombre, u.usuario, hash, u.rol]
    );
    console.log(`✔ Usuario "${u.usuario}" listo (contraseña: ${u.password})`);
  }

  console.log('\nSeed completado. Cambia las contraseñas tras el primer login.');
  process.exit(0);
}

seed().catch((e) => {
  console.error('Error en seed:', e.message);
  process.exit(1);
});
