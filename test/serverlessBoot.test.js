const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Simulate read-only Vercel filesystem without requiring installed packages.
function loadUpload({ vercel = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/middlewares/upload.js'), 'utf8');
  const fsMock = {
    ...fs,
    mkdirSync() { throw Object.assign(new Error('EROFS: read-only'), { code: 'EROFS' }); },
    mkdir(p, options, cb) { cb(null); },
  };
  const multerMock = Object.assign(
    (opts) => ({ single: () => (req, res, next) => next(), opts }),
    { memoryStorage: () => ({ memory: true }), diskStorage: (opts) => ({ opts }) }
  );
  const exports = {};
  const module = { exports };
  const fakeRequire = (name) => {
    if (name === 'multer') return multerMock;
    if (name === 'path') return path;
    if (name === 'fs') return fsMock;
    throw new Error('unexpected require ' + name);
  };
  vm.runInNewContext(`(function(require,module,exports,__dirname,process){${source}\n})`, { }, { filename: 'src/middlewares/upload.js' })(fakeRequire,module,exports,path.join(__dirname, '../src/middlewares'), { env: vercel ? { VERCEL: '1' } : {} });
  return module.exports;
}

test('importar middleware de subida no escribe en disco de Vercel', () => {
  const { uploadPesos } = loadUpload();
  assert.equal(uploadPesos.opts.storage.memory, true);
});

test('importar middleware tampoco crea carpeta en arranque local', () => {
  const { uploadPesos } = loadUpload({ vercel: false });
  assert.equal(typeof uploadPesos.opts.storage.opts.destination, 'function');
});

test('Vercel bloquea subida temporal sin prometer persistencia', () => {
  const { requiereAlmacenamientoDeModelos } = loadUpload();
  let body;
  let status;
  requiereAlmacenamientoDeModelos({}, { status(n) { status=n; return this; }, json(obj) { body=obj; } }, () => { throw new Error('next must not be called'); });
  assert.equal(status, 501);
  assert.match(body.message, /Vercel/);
});

test('sistema puede arrancar sin cargar sharp nativo', () => {
  for(const f of ['recorteService.js','exportService.js']) {
    const s=fs.readFileSync(path.join(__dirname,'../src/services',f),'utf8');
    assert.match(s, /function sharp\(/);
    assert.doesNotMatch(s, /const sharp\s*=\s*require\(['"]sharp['"]\)/);
  }
});

test('health de inferencia tiene límite de 5 segundos', () => {
  const s=fs.readFileSync(path.join(__dirname, '../src/services/inferenceService.js'),'utf8');
  assert.match(s, /get\('\/health', \{ timeout: 5000 \}\)/);
});
