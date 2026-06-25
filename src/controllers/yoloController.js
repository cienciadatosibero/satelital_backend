const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function obtenerPythonBin() {
  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim() !== '') {
    return process.env.PYTHON_BIN;
  }

  const rootPath = path.join(__dirname, '..', '..');
  const pythonWindows = path.join(rootPath, '.venv', 'Scripts', 'python.exe');
  const pythonLinuxMac = path.join(rootPath, '.venv', 'bin', 'python');

  if (fs.existsSync(pythonWindows)) return pythonWindows;
  if (fs.existsSync(pythonLinuxMac)) return pythonLinuxMac;

  return 'python';
}

function ejecutarYoloWorker(payload) {
  return new Promise((resolve, reject) => {
    const rootPath = path.join(__dirname, '..', '..');
    const workerPath = path.join(rootPath, 'src', 'service', 'yolo_worker.py');
    const pythonBin = obtenerPythonBin();

    if (!fs.existsSync(workerPath)) {
      reject(new Error(`No se encontró el worker en: ${workerPath}`));
      return;
    }

    const proceso = spawn(pythonBin, [workerPath], {
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let salida = '';
    let error = '';

    const timeout = setTimeout(() => {
      proceso.kill('SIGKILL');
      reject(new Error('Tiempo agotado ejecutando YOLO.'));
    }, 180000);

    proceso.stdout.on('data', (data) => { salida += data.toString(); });
    proceso.stderr.on('data', (data) => { error += data.toString(); });

    proceso.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`No se pudo iniciar Python. Detalle: ${err.message}`));
    });

    proceso.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Python terminó con código ${code}.\nSTDERR:\n${error}`));
        return;
      }
      try {
        const lineas = salida.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const ultimaLinea = lineas[lineas.length - 1];
        if (!ultimaLinea) throw new Error("Python no devolvió JSON.");
        resolve(JSON.parse(ultimaLinea));
      } catch (err) {
        reject(new Error(`Error parseando JSON.\nDetalle: ${err.message}\nSTDOUT: ${salida}`));
      }
    });

    proceso.stdin.write(JSON.stringify(payload));
    proceso.stdin.end();
  });
}

// Lógica original (por si la sigues ocupando)
async function detectarPaneles(req, res) {
  try {
    const latitud = Number(req.body.latitud);
    const longitud = Number(req.body.longitud);
    const radioMetros = Number(req.body.radio_metros || 1000);
    const zoom = Number(req.body.zoom || 18);
    const confianza = Number(req.body.confianza || 0.25);

    const resultado = await ejecutarYoloWorker({
      latitud, longitud, radio_metros: radioMetros, zoom, confianza
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// NUEVA LÓGICA: Análisis por imagen
async function analizarImagen(req, res) {
  try {
    const { imagen_base64, confianza } = req.body;

    if (!imagen_base64) {
      return res.status(400).json({ ok: false, error: 'Falta la imagen base64' });
    }

    // 1. Convertir Base64 a Buffer
    const base64Data = imagen_base64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    // 2. Preparar carpeta temporal en la raíz del proyecto
    const rootPath = path.join(__dirname, '..', '..');
    const tempDir = path.join(rootPath, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 3. Guardar archivo temporal
    const idUnico = Date.now() + Math.floor(Math.random() * 1000);
    const inputPath = path.join(tempDir, `input_${idUnico}.jpg`);
    fs.writeFileSync(inputPath, buffer);

    // 4. Mandar a Python
    const payload = {
      modo: "analisis_imagen",
      ruta_imagen: inputPath,
      confianza: Number(confianza || 0.25)
    };

    const resultadoPython = await ejecutarYoloWorker(payload);

    // 5. Validar que Python devolvió la imagen
    if (!resultadoPython.ruta_resultado || !fs.existsSync(resultadoPython.ruta_resultado)) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      throw new Error("Python no generó la imagen procesada.");
    }

    // 6. Leer resultado y pasarlo a Base64
    const outputBuffer = fs.readFileSync(resultadoPython.ruta_resultado);
    const imagenResultadoBase64 = `data:image/jpeg;base64,${outputBuffer.toString('base64')}`;

    // 7. Limpiar temporales
    fs.unlinkSync(inputPath);
    fs.unlinkSync(resultadoPython.ruta_resultado);

    // 8. Responder a React
    return res.json({
      ok: true,
      imagen_resultado_base64: imagenResultadoBase64
    });

  } catch (error) {
    console.error("Error en analizarImagen:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

function estadoYolo(req, res) {
  const rootPath = path.join(__dirname, '..', '..');
  const workerPath = path.join(rootPath, 'src', 'service', 'yolo_worker.py');
  return res.json({
    ok: true,
    python: obtenerPythonBin(),
    worker_existe: fs.existsSync(workerPath)
  });
}

module.exports = {
  detectarPaneles,
  analizarImagen,
  estadoYolo,
};