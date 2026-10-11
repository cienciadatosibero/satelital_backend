"""Inferencia local YOLO. Ejecutar desde API con `npm start`.

La selección de `/load` NO cambia el modelo activo. `/predict` usa el modelo
activado o, si no hay activación todavía, el peso por defecto. Esto evita el
error anterior que restablecía best.pt en cada predicción.
"""
import base64
import io
import os
from pathlib import Path
from threading import RLock

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT / 'src' / 'models' / 'best.pt'
MODEL_IMAGE_SIZE = max(640, min(1280, int(os.getenv('YOLO_IMGSZ', '960'))))
INFERENCE_API_TOKEN = os.getenv('INFERENCE_API_TOKEN', '').strip()

app = FastAPI(title='SatDataset YOLO', version='1.1.0')
_model = None
_model_path = None
_cache = {}
_model_lock = RLock()


class ModelRequest(BaseModel):
    weights_path: str


class PredictRequest(BaseModel):
    image_base64: str
    conf: float = Field(default=0.20, ge=0.05, le=0.95)
    return_crops: bool = True


def check_token(authorization: str | None):
    if INFERENCE_API_TOKEN and authorization != f'Bearer {INFERENCE_API_TOKEN}':
        raise HTTPException(status_code=401, detail='No autorizado')


def resolve_weights(value: str | None) -> Path:
    candidate = Path(value) if value else DEFAULT_MODEL
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    candidate = candidate.resolve()
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail=f'No existe el modelo: {candidate.name}')
    return candidate


def get_model(value: str | None = None, activate: bool = False):
    global _model, _model_path
    with _model_lock:
        # Predicción sin ruta: respeta la selección activa en memoria.
        if value is None and _model is not None and not activate:
            return _model
        requested = resolve_weights(value)
        if requested not in _cache:
            _cache[requested] = YOLO(str(requested))
        loaded = _cache[requested]
        if activate or (_model is None and value is None):
            _model, _model_path = loaded, requested
        return loaded


def classes_for(yolo):
    names = yolo.names or {}
    return {str(k): v for k, v in (names.items() if isinstance(names, dict) else enumerate(names))}


def open_image(image_base64: str):
    try:
        raw = base64.b64decode(image_base64.split(',', 1)[-1], validate=True)
        if len(raw) > 15 * 1024 * 1024:
            raise ValueError('Imagen demasiado grande (máximo 15 MB)')
        image = Image.open(io.BytesIO(raw))
        image.load()
        if image.width * image.height > 16_000_000:
            raise ValueError('Máximo 16 megapíxeles por imagen')
        return image.convert('RGB')
    except (ValueError, UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f'Imagen inválida: {exc}') from exc


@app.get('/health')
def health():
    return {'ok': True, 'model_loaded': _model is not None,
            'active_path': str(_model_path) if _model_path else None,
            'classes': classes_for(_model) if _model else {}}


@app.post('/load')
def load(req: ModelRequest, authorization: str | None = Header(default=None)):
    check_token(authorization)
    yolo = get_model(req.weights_path)
    return {'ok': True, 'classes': classes_for(yolo), 'framework': 'ultralytics-yolo'}


@app.post('/activate')
def activate(req: ModelRequest, authorization: str | None = Header(default=None)):
    check_token(authorization)
    yolo = get_model(req.weights_path, activate=True)
    return {'ok': True, 'classes': classes_for(yolo), 'framework': 'ultralytics-yolo'}


@app.post('/predict')
def predict(req: PredictRequest, authorization: str | None = Header(default=None)):
    check_token(authorization)
    image = open_image(req.image_base64)
    yolo = get_model()
    with _model_lock:
        result = yolo.predict(source=image, conf=req.conf, imgsz=MODEL_IMAGE_SIZE,
                              iou=0.45, verbose=False)[0]
    detections = []
    for box in result.boxes or []:
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(image.width, x2), min(image.height, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        class_id = int(box.cls[0].item())
        det = {'class_id': class_id,
               'class_name': result.names.get(class_id, str(class_id)),
               'confidence': float(box.conf[0].item()),
               'x': x1, 'y': y1, 'w': x2 - x1, 'h': y2 - y1}
        if req.return_crops:
            crop = image.crop((int(x1), int(y1), int(x2), int(y2)))
            output = io.BytesIO()
            crop.save(output, format='JPEG', quality=90)
            det['crop_base64'] = 'data:image/jpeg;base64,' + base64.b64encode(output.getvalue()).decode('ascii')
        detections.append(det)
    return {'ok': True, 'image_width': image.width,
            'image_height': image.height, 'detections': detections}


if __name__ == '__main__':
    uvicorn.run(app, host=os.getenv('INFERENCE_BIND', '127.0.0.1'),
                port=int(os.getenv('INFERENCE_PORT', '8000')))
