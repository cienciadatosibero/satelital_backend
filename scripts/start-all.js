const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const children = [];

function launch(command, args, label) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`${label} terminó con código ${code}`);
  });
}

const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
launch(python, ['src/inference_server.py'], 'Inferencia');
launch(process.execPath, ['src/server.js'], 'API');

function stop() {
  for (const child of children) if (!child.killed) child.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
