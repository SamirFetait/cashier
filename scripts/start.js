// `npm start` from the repo root: runs the Django API, waits until it accepts connections,
// then runs the Electron app (`npm run dev` in frontend/). When either one exits (you close
// the app window, or the backend dies), the other is stopped too. Ctrl+C stops both.
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

// Must match VITE_API_BASE_URL in frontend/.env (http://127.0.0.1:8000/api by default).
const HOST = '127.0.0.1';
const PORT = 8000;

const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const isWindows = process.platform === 'win32';

const running = new Map(); // child process -> 'backend' | 'frontend'
let stopping = false;

const log = (message) => console.log(`[start] ${message}`);

function isListening() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, HOST);
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function findPython() {
  const venvPython = isWindows
    ? path.join(backendDir, 'venv', 'Scripts', 'python.exe')
    : path.join(backendDir, 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  const fallback = isWindows ? 'python' : 'python3';
  log(`backend/venv not found, using ${fallback} from PATH.`);
  return fallback;
}

function launch(name, command, args, options) {
  const child = spawn(command, args, options);
  running.set(child, name);
  let done = false;
  const onDone = (code, what) => {
    if (done) return;
    done = true;
    running.delete(child);
    if (!stopping) {
      const rest = [...running.values()];
      log(`The ${name} ${what}${rest.length ? `, stopping the ${rest.join(' and ')}` : ''}.`);
    }
    stop(code);
  };
  child.on('error', (error) => onDone(1, `could not be started (${error.message})`));
  child.on('exit', (code, signal) =>
    onDone(code ?? 1, signal ? `was stopped (${signal})` : `exited with code ${code}`),
  );
}

function kill(child) {
  if (isWindows) {
    // child.kill() would end only the top process. Django's autoreloader serves from a
    // process of its own that would outlive it and keep port 8000 busy, so end the tree.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

// Node exits by itself once the children are gone; the timer only covers a child that hangs.
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of running.keys()) kill(child);
  setTimeout(() => {
    for (const child of running.keys()) child.kill('SIGKILL');
    process.exit();
  }, 5000).unref();
}

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
if (isWindows) signals.push('SIGBREAK'); // Ctrl+Break, which Django's banner suggests on Windows
for (const signal of signals) {
  process.on(signal, () => stop(128 + os.constants.signals[signal]));
}

async function main() {
  if (await isListening()) {
    log(`Port ${PORT} is already in use. Is a backend from an earlier run still up? Stop it, then try again.`);
    process.exitCode = 1;
    return;
  }

  log(`Starting the backend on http://${HOST}:${PORT} ...`);
  launch('backend', findPython(), ['manage.py', 'runserver', `${HOST}:${PORT}`], {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  while (!stopping && !(await isListening())) await sleep(250);
  if (stopping) return;

  log('Backend is up, starting the frontend ...');
  // Under `npm start`, npm_execpath is npm's own CLI script. Running it with this Node skips
  // the npm.cmd and cmd.exe wrappers on Windows. Otherwise use whatever npm is on PATH.
  const npmCli = process.env.npm_execpath;
  const viaNode = Boolean(npmCli) && /\.[cm]?js$/.test(npmCli);
  launch('frontend', viaNode ? process.execPath : 'npm run dev', viaNode ? [npmCli, 'run', 'dev'] : [], {
    cwd: frontendDir,
    shell: !viaNode,
    // Tools started from VS Code extensions inherit ELECTRON_RUN_AS_NODE=1, which makes
    // Electron start as plain Node (electron.app is undefined), so drop it.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    // electron-vite never reads the terminal. Leaving stdin out means a Ctrl+C can't leave
    // cmd.exe's "Terminate batch job (Y/N)?" prompt waiting for an answer.
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

main().catch((error) => {
  console.error(error);
  stop(1);
});
