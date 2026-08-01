/**
 * Starting and *actually* stopping a dev/preview server for the browser tests.
 *
 * `spawn('npx', …, { shell: true })` puts a shell and an npx wrapper between
 * us and vite, so `child.kill()` reaps the wrapper and leaves the real server
 * running. Repeated script runs then pile up servers that hold file locks on
 * `dist/`, and the next build fails with EPERM — which is exactly what
 * happened here.
 *
 * This kills the whole process tree instead.
 */

import { spawn, execFileSync } from 'node:child_process';

export function startServer({ cwd, port, mode = 'dev' }) {
  const args =
    mode === 'preview'
      ? ['vite', 'preview', '--port', String(port), '--strictPort']
      : ['vite', '--port', String(port), '--strictPort'];

  const child = spawn('npx', args, { cwd, shell: true, stdio: 'ignore' });

  return {
    child,
    stop() {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') {
          // /T takes the children with it, which is the whole point.
          execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } else {
          process.kill(-child.pid, 'SIGTERM');
        }
      } catch {
        // Already gone.
      }
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    },
  };
}

export async function waitForServer(base, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}
