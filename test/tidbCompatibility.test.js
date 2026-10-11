const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'satdataset.sql'), 'utf8');

function getTableSql(table) {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS \`${table}\``);
  assert.notEqual(start, -1, `Falta ${table}`);
  const end = sql.indexOf(';', start);
  return sql.slice(start, end);
}

test('el esquema incluido coincide con las claves y estados de producción TiDB', () => {
  for (const table of ['usuarios', 'modelos', 'sesiones_busqueda', 'celdas', 'detecciones']) {
    const ddl = getTableSql(table);
    assert.match(ddl, /`id` int NOT NULL AUTO_INCREMENT/);
  }
  const sesiones = getTableSql('sesiones_busqueda');
  assert.match(sesiones, /`estado` enum\('en_progreso','revisada','exportada'\)/);
  assert.doesNotMatch(sesiones, /'completada'|'error'/);
  assert.match(getTableSql('usuarios'), /`usuario` varchar\(60\)/);
  assert.match(getTableSql('modelos'), /`conf_default` decimal\(4,3\)/);
  assert.match(getTableSql('detecciones'), /`confianza` decimal\(5,4\)/);
  assert.match(getTableSql('detecciones'), /`lat` decimal\(10,7\)/);
  assert.match(getTableSql('detecciones'), /ON DELETE CASCADE/);
});

// Modelo de datos sin conectarse a ninguna cuenta TiDB. Comprueba las sentencias
// que se usarán en producción ante revisiones pendientes y completadas.
const queries = [];
let pendientes = 0;
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    async query(q, params) {
      queries.push({ sql: q, params });
      if (q.includes('COUNT(*) AS pendientes')) return [[{ pendientes }]];
      return [{ affectedRows: 1 }];
    },
  },
};
const { Sesion } = require('../src/models/sesionModel');

test('sesiones con detecciones pendientes mantienen estado en_progreso', async () => {
  pendientes = 2;
  queries.length = 0;
  assert.equal(await Sesion.actualizarEstadoSegunRevision(13), 'en_progreso');
  assert.deepEqual(queries.at(-1).params, ['en_progreso', 13]);
});

test('sesiones revisadas utilizan estado revisada, existente en TiDB', async () => {
  pendientes = 0;
  queries.length = 0;
  assert.equal(await Sesion.actualizarEstadoSegunRevision(13), 'revisada');
  assert.deepEqual(queries.at(-1).params, ['revisada', 13]);
});

test('setup-db nunca desactiva todos los modelos existentes', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-database.js'), 'utf8');
  assert.doesNotMatch(script, /UPDATE modelos SET activo = 0/);
  assert.match(script, /WHERE NOT EXISTS \(SELECT 1 FROM modelos LIMIT 1\)/);
});

test('modelo de fábrica best.pt se puede localizar sin tocar uploads', () => {
  const { rutaPeso, esPesoSubido } = require('../src/services/modelPathService');
  const ruta = rutaPeso('best.pt');
  assert.equal(ruta, path.join(__dirname, '..', 'src', 'models', 'best.pt'), 'Debe localizar el modelo incluido en el repositorio en Windows, Linux y macOS');
  assert.equal(esPesoSubido(ruta), false);
  assert.equal(rutaPeso('../best.pt'), null);
  assert.equal(rutaPeso('/etc/passwd'), null);
});

test('no se expone por static la carpeta de pesos a Internet', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /app\.use\('\/uploads\/recortes'/);
  assert.doesNotMatch(app, /app\.use\('\/uploads',/);
});
