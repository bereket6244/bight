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
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Newest modification time anywhere under a directory, or 0 if it is absent. */
function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(path));
    else newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * Refuses to serve a `dist/` older than the source it was built from.
 *
 * Preview mode serves the built bundle, which says nothing about the working
 * tree. A stale bundle does not fail loudly — it passes every check that the
 * previous build passed, and fails only the ones covering work you just did,
 * which reads exactly like a broken feature. That happened, and cost a wrong
 * diagnosis; the fix is one line, so nothing should have to guess again.
 */
function assertFreshBuild(cwd) {
  const built = newestMtime(join(cwd, 'dist'));
  if (built === 0) {
    throw new Error('There is no dist/ to preview. Run `npm run build` first.');
  }
  const source = Math.max(newestMtime(join(cwd, 'src')), newestMtime(join(cwd, 'public')));
  if (source > built) {
    const age = Math.round((source - built) / 1000);
    throw new Error(
      `dist/ is ${age}s older than src/, so this would test the previous build. ` +
        'Run `npm run build` first.',
    );
  }
}

export function startServer({ cwd, port, mode = 'dev' }) {
  if (mode === 'preview') assertFreshBuild(cwd);

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
