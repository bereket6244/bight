#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const prefix = '/bight/';
const port = 5202;
const origin = `http://127.0.0.1:${port}`;

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json'],
  ['.wasm', 'application/wasm'],
  ['.gz', 'application/gzip'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

function safeFile(urlPath) {
  if (!urlPath.startsWith(prefix)) return null;
  const relative = decodeURIComponent(urlPath.slice(prefix.length));
  const candidate = path.resolve(dist, relative === '' ? 'index.html' : relative);
  return candidate.startsWith(`${dist}${path.sep}`) ? candidate : null;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', origin);
    let file = safeFile(url.pathname);
    if (file === null) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      await stat(file);
    } catch {
      file = path.join(dist, '404.html');
    }
    const body = await readFile(file);
    const headers = {
      'content-type': types.get(path.extname(file)) ?? 'application/octet-stream',
      'content-length': body.length,
    };
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

let browser;
const failures = [];
function check(value, label) {
  console.log(`  ${value ? 'pass' : 'FAIL'}  ${label}`);
  if (!value) failures.push(label);
}

try {
  const puppeteer = (await import('puppeteer')).default;
  browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? 'unknown';
    // Chromium reports an intentionally bodyless HEAD probe as aborted even
    // after fetch has received its 200 response. The status is asserted below;
    // only an actual asset request failure belongs in this list.
    if (
      request.method() === 'HEAD' &&
      request.url().includes('/models/') &&
      error === 'net::ERR_ABORTED'
    ) return;
    failedRequests.push(`${request.url()} (${error})`);
  });

  const response = await page.goto(`${origin}${prefix}`, { waitUntil: 'networkidle0' });
  check(response?.status() === 200, 'the simulated /bight/ project site loads');
  await page.waitForSelector('[data-testid="home-screen"]');
  check(
    (await page.$eval('[data-testid="web-session-notice"]', (node) => node.textContent ?? ''))
      .includes('progress is kept only for this session'),
    'the session-only notice is visible',
  );

  await page.evaluate(() => {
    const settings = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim().endsWith('Settings'),
    );
    settings?.click();
  });
  await page.waitForSelector('h1');
  check(
    (await page.$('a[href="/bight/ENGINE_LICENSES.md"]')) !== null,
    'the deployed About card links to the engine licences',
  );

  const assets = await page.evaluate(async () => {
    const worker = await fetch('/bight/engine/stockfish-18-lite-single.js');
    const wasm = await fetch('/bight/engine/stockfish-18-lite-single.wasm');
    const model = await fetch('/bight/models/vosk-model-small-en-us-0.15.tar.gz', {
      method: 'HEAD',
    });
    return {
      worker: worker.status,
      wasm: wasm.status,
      wasmType: wasm.headers.get('content-type'),
      model: model.status,
    };
  });
  check(assets.worker === 200, 'the Pages Stockfish Worker URL returns 200');
  check(assets.wasm === 200, 'the Pages Stockfish WASM URL returns 200');
  check(assets.wasmType === 'application/wasm', 'the WASM MIME type is usable');
  check(assets.model === 200, 'the lazy voice-model URL returns 200');

  const engine = await page.evaluate(async () => {
    const worker = new Worker('/bight/engine/stockfish-18-lite-single.js');
    const waitFor = (test, label) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 30000);
        const listener = (event) => {
          const line = String(event.data);
          if (!test(line)) return;
          clearTimeout(timer);
          worker.removeEventListener('message', listener);
          resolve(line);
        };
        worker.addEventListener('message', listener);
      });
    try {
      worker.postMessage('uci');
      await waitFor((line) => line === 'uciok', 'uciok');
      worker.postMessage('isready');
      await waitFor((line) => line === 'readyok', 'readyok');
      worker.postMessage('position startpos');
      worker.postMessage('go depth 1');
      const bestmove = await waitFor((line) => line.startsWith('bestmove '), 'bestmove');
      return String(bestmove);
    } finally {
      worker.terminate();
    }
  });
  check(/^bestmove [a-h][1-8][a-h][1-8]/.test(engine), 'Stockfish returns a move under /bight/');

  const databases = await page.evaluate(async () =>
    typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((db) => db.name) : [],
  );
  check(databases.length === 0, 'the web target creates no IndexedDB database');

  const fallbackPage = await browser.newPage();
  await fallbackPage.goto(`${origin}/bight/future-route`, { waitUntil: 'networkidle0' });
  await fallbackPage.waitForSelector('[data-testid="home-screen"]');
  await fallbackPage.close();
  check(true, 'the 404 fallback can boot the single-page app');
  check(consoleErrors.length === 0, `the browser console has no errors${consoleErrors.length ? `: ${consoleErrors.join('; ')}` : ''}`);
  check(failedRequests.length === 0, `the browser has no failed requests${failedRequests.length ? `: ${failedRequests.join(', ')}` : ''}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n${failures.length} Pages failure(s).`);
if (failures.length > 0) process.exit(1);
