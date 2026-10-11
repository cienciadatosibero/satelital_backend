"""Test sin ultralytics: simula la carga para verificar activación y cambios."""
import importlib.util
import os
import tempfile
import sys
import types
from pathlib import Path
from unittest.mock import Mock

class FakeYOLO:
    loads = []
    def __init__(self, weights):
        self.weights = str(weights)
        self.names = {0: 'panel'}
        self.loads.append(self.weights)

fake = types.ModuleType('ultralytics')
fake.YOLO = FakeYOLO
sys.modules['ultralytics'] = fake

api_file = Path(__file__).resolve().parents[1] / 'src/inference_server.py'
spec = importlib.util.spec_from_file_location('local_inference', api_file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as d:
    path_a, path_b = Path(d) / 'a.pt', Path(d) / 'b.pt'
    path_a.write_bytes(b'fake')
    path_b.write_bytes(b'fake')
    model_a = module.get_model(str(path_a), activate=True)
    assert module.get_model() is model_a, 'predict podría volver al modelo por defecto'
    model_b = module.get_model(str(path_b), activate=False)
    assert model_a is not model_b
    assert module.get_model() is model_a, '/load no debe activar el modelo'
    module.get_model(str(path_b), activate=True)
    assert module.get_model() is model_b
    assert len(FakeYOLO.loads) == 2, 'la caché debe reutilizar los modelos'

other_file = Path(__file__).resolve().parents[2] / 'inference/app.py'
spec = importlib.util.spec_from_file_location('external_inference', other_file)
module2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module2)
with tempfile.TemporaryDirectory() as d:
    path_a = Path(d) / 'a.pt'
    path_a.write_bytes(b'fake')
    loaded = module2._cargar_yolo(str(path_a))
    assert module2._cargar_yolo(str(path_a)) is loaded
print('Tests Python de activación/caché: OK')
