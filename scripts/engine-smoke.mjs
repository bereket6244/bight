#!/usr/bin/env node
/**
 * Does the engine actually run? Answered in a real browser, before anything is
 * built on top of it.
 *
 * Loads the Worker exactly as the app will, speaks UCI to it, and checks that
 * it reaches `uciok`, `readyok`, and returns a legal `bestmove` — first from
 * the opening position, then from a position with one forced answer.
 *
 * Run against the dev server by default, or against a production build with
 * `--dist`, which is the case that matters for the APK.
 *
 * Usage: node scripts/engine-smoke.mjs [--dist]
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useDist = process.argv.includes('--dist');
const PORT = useDist ? 5197 : 5196;
const BASE = `http://localhost:${PORT}`;

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('Puppeteer is not installed — skipping the engine smoke test.');
  process.exit(0);
}

const args = useDist
  ? ['vite', 'preview', '--port', String(PORT), '--strictPort']
  : ['vite', '--port', String(PORT), '--strictPort'];

const server = spawn('npx', args, { cwd: root, shell: true, stdio: 'ignore' });

async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const results = [];
const failures = [];

function assert(ok, label, detail = '') {
  results.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

let browser;
try {
  if (!(await waitForServer())) throw new Error('server did not start');

  browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`    [console] ${message.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  // The asset must be served, and served as WebAssembly.
  const assetCheck = await page.evaluate(async () => {
    const js = await fetch('/engine/stockfish-18-lite-single.js');
    const wasm = await fetch('/engine/stockfish-18-lite-single.wasm');
    return {
      jsOk: js.ok,
      wasmOk: wasm.ok,
      wasmType: wasm.headers.get('content-type'),
      wasmBytes: Number(wasm.headers.get('content-length') ?? 0),
    };
  });
  assert(assetCheck.jsOk, 'the worker script is served');
  assert(assetCheck.wasmOk, 'the wasm binary is served', assetCheck.wasmType ?? '');

  const run = await page.evaluate(async () => {
    const lines = [];
    const started = performance.now();

    const worker = new Worker('/engine/stockfish-18-lite-single.js');
    const say = (command) => worker.postMessage(command);

    /** Resolves when a line matching `test` arrives, or rejects on timeout. */
    const until = (test, ms, what) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
        const listener = (event) => {
          const line = String(event.data);
          lines.push(line);
          if (test(line)) {
            clearTimeout(timer);
            worker.removeEventListener('message', listener);
            resolve(line);
          }
        };
        worker.addEventListener('message', listener);
      });

    try {
      say('uci');
      const uciok = await until((l) => l === 'uciok', 60000, 'uciok');
      const bootMs = Math.round(performance.now() - started);

      say('isready');
      await until((l) => l === 'readyok', 20000, 'readyok');

      say('ucinewgame');
      say('isready');
      await until((l) => l === 'readyok', 20000, 'readyok after ucinewgame');

      // 1. A move from the opening position.
      say('position startpos');
      say('go movetime 300');
      const opening = await until((l) => l.startsWith('bestmove'), 20000, 'bestmove');

      // 2. A position with exactly one sane answer: mate in one.
      say('position fen 6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
      say('go movetime 500');
      const mate = await until((l) => l.startsWith('bestmove'), 20000, 'bestmove (mate)');

      // 3. Weakened play still answers.
      say('setoption name Skill Level value 0');
      say('position startpos moves e2e4');
      say('go movetime 200');
      const weak = await until((l) => l.startsWith('bestmove'), 20000, 'bestmove (skill 0)');

      say('quit');
      worker.terminate();

      const idLine = lines.find((l) => l.startsWith('id name'));
      const options = lines.filter((l) => l.startsWith('option name')).length;

      return {
        ok: true,
        bootMs,
        uciok,
        id: idLine ?? null,
        options,
        opening,
        mate,
        weak,
        totalLines: lines.length,
      };
    } catch (error) {
      worker.terminate();
      return { ok: false, error: String(error), lines: lines.slice(-20) };
    }
  });

  if (!run.ok) {
    assert(false, 'the engine answers UCI', run.error);
    console.log('    last lines:', JSON.stringify(run.lines, null, 2));
  } else {
    assert(true, 'reaches uciok', `${run.bootMs}ms to boot`);
    assert(run.id !== null, 'identifies itself', run.id ?? '');
    assert(run.options > 5, 'advertises UCI options', `${run.options} options`);
    assert(
      /^bestmove [a-h][1-8][a-h][1-8]/.test(run.opening),
      'returns a move from the opening',
      run.opening,
    );
    assert(run.mate.startsWith('bestmove a1a8'), 'finds mate in one', run.mate);
    assert(
      /^bestmove [a-h][1-8][a-h][1-8]/.test(run.weak),
      'still answers at Skill Level 0',
      run.weak,
    );
  }
} catch (error) {
  assert(false, 'harness', error.message);
} finally {
  await browser?.close();
  server.kill();
}

console.log(`\n${results.length} checks, ${failures.length} failure(s).`);
if (failures.length > 0) process.exit(1);
