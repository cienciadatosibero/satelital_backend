const test = require('node:test');
const assert = require('node:assert/strict');
const { iou, cajaMundial, deduplicar, asociarSegundaPasada, cajaLimitada } = require('../src/services/detectionQualityService');
const { pixelABoundsLatLng } = require('../src/services/geoService');

test('deduplicar conserva más confianza en solapes', () => {
  const celda1 = { px1: 1000, py1: 500 };
  const celda2 = { px1: 1100, py1: 500 };
  const a = { x: 120, y: 70, w: 70, h: 40, confidence: 0.35, class_name: 'solar' };
  const b = { x: 20, y: 70, w: 70, h: 40, confidence: 0.80, class_name: 'solar' };
  const c = { x: 25, y: 70, w: 70, h: 40, confidence: 0.50, class_name: 'techo' };
  const objetos = [{ d: a, cajaMundial: cajaMundial(celda1, a) },
                   { d: b, cajaMundial: cajaMundial(celda2, b) },
                   { d: c, cajaMundial: cajaMundial(celda2, c) }];
  const unicos = deduplicar(objetos);
  assert.equal(unicos.length, 2);
  assert.equal(unicos[0].d.confidence, 0.8);
  assert.equal(iou(objetos[0].cajaMundial, objetos[1].cajaMundial), 1);
});

test('segunda pasada rechaza clases equivocadas y objetos lejanos', () => {
  const inicial = { class_name: 'solar' };
  const detecciones = [
    { class_name: 'arbol', x: 295, y: 295, w: 20, h: 20, confidence: .95 },
    { class_name: 'solar', x: 520, y: 520, w: 30, h: 30, confidence: .95 },
    { class_name: 'solar', x: 300, y: 300, w: 30, h: 30, confidence: .45 },
  ];
  assert.equal(asociarSegundaPasada(detecciones, inicial, 600, 600), detecciones[2]);
  assert.equal(asociarSegundaPasada(detecciones.slice(0, 2), inicial, 600, 600), null);
});

test('cajas siempre dentro de imagen', () => {
  const c = cajaLimitada({ x: -20, y: 590, w: 60, h: 100, confidence: .3, class_name: 'solar' }, 600, 600);
  assert.deepEqual([c.x, c.y, c.w, c.h], [0, 590, 40, 10]);
});

test('Web Mercator interpola correctamente el centro y conserva las esquinas', () => {
  const bounds = { north: 50, south: 10, west: -100, east: -90 };
  const centro = pixelABoundsLatLng(bounds, 600, 600, { x: 295, y: 295, w: 10, h: 10 });
  assert.equal(centro.lng, -95);
  assert.ok(centro.lat > 30); // curva Mercator: no usar promedio lineal 30
  const borde = pixelABoundsLatLng(bounds, 600, 600, { x: 0, y: 0, w: 0, h: 0 });
  assert.ok(Math.abs(borde.lat - 50) < 1e-6);
});
