const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
// Solo planificación geométrica. No descargar imágenes ni usar dependencias externas.
Module._load = function(request, parent, isMain) {
  if (request === 'axios') return { get() { throw new Error('network not expected'); } };
  if (request === 'sharp') return function () { throw new Error('images not expected'); };
  return originalLoad.call(this, request, parent, isMain);
};
const { planificarCeldas } = require('../src/services/tileService');
Module._load = originalLoad;
const bounds = { north: 17.553, south: 17.552, east: -99.498, west: -99.499 };

test('plan con 15% de solape cubre el área sin huecos', () => {
  const plan = planificarCeldas(bounds, { zoom: 19, ladoPx: 640 });
  assert.ok(plan.total >= 1);
  assert.equal(plan.paso, 544);
  for (let i = 1; i < plan.celdas.length; i++) {
    const a = plan.celdas[i - 1], b = plan.celdas[i];
    if (a.fila === b.fila) {
      assert.ok(b.px1 < a.px2, 'solape horizontal real');
      assert.equal(b.px1 - a.px1, plan.paso);
    }
  }
});

test('rectángulos enormes se rechazan antes de asignar celdas', () => {
  assert.throws(() => planificarCeldas({north: 60, south: 1, east: 30, west: -100}, {zoom:20}), /demasiado grande/);
});
