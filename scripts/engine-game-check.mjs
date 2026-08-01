#!/usr/bin/env node
/**
 * Plays a real game against the real engine, in real Chromium, against the
 * production build.
 *
 * The unit tests use a fake engine because the failure modes are what matter
 * there. This is the other half: proof that the whole chain — Worker, wasm,
 * UCI, chess.js validation, the screen — actually plays chess.
 *
 * Usage: node scripts/engine-game-check.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, waitForServer as awaitServer } from './devServer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5195, BASE = `http://localhost:${PORT}`;
const puppeteer = (await import('puppeteer')).default;
const server = startServer({ cwd: root, port: PORT, mode: 'preview' });

if (!(await awaitServer(BASE))) {
  console.error('preview server did not start');
  process.exit(1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  await wait(400);
}

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915 });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console error]', m.text()); });
const click = (s) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no ${sel}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, s);
const textOf = (s) => page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, s);

try {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="home-screen"]');
  await click('[data-testid="tab-modes"]');
  await page.waitForSelector('[data-testid="mode-blindfold-engine-game"]');
  await click('[data-testid="mode-blindfold-engine-game"]');
  await page.waitForSelector('[data-testid="start-session"]');
  await click('[data-testid="start-session"]');

  await page.waitForSelector('[data-testid="engine-setup"]', { timeout: 20000 });
  await click('[data-testid="engine-difficulty-very-easy"]');
  await click('[data-testid="engine-visibility-always"]');
  // The move list defaults to the latest move only; this check reads the whole
  // score sheet, so it opts into it.
  await click('[data-testid="engine-history-full"]');
  await click('[data-testid="engine-start"]');
  await page.waitForSelector('[data-testid="engine-game"]', { timeout: 60000 });

  const moves = [['e2','e4'],['g1','f3'],['f1','c4']];
  for (const [from, to] of moves) {
    await page.waitForFunction(
      () => document.querySelector('[data-testid="engine-turn"]')?.textContent?.includes('Your move'),
      { timeout: 60000 },
    );
    await click(`[data-testid="square-${from}"]`);
    await click(`[data-testid="square-${to}"]`);
    await wait(300);
  }
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="engine-moves"]')?.textContent ?? '').split(' ').length > 6,
    { timeout: 60000 },
  );

  console.log('  pass  played a real game against the real engine');
  console.log('        moves:', await textOf('[data-testid="engine-moves"]'));
  console.log('        last: ', await textOf('[data-testid="engine-last-move"]'));
  console.log('        turn: ', await textOf('[data-testid="engine-turn"]'));
  const err = await textOf('[data-testid="engine-error"]');
  if (err !== null) { console.log('  FAIL  engine error:', err); process.exitCode = 1; }
} catch (e) {
  console.log('  state at failure:');
  console.log('    setup? ', await page.evaluate(() => document.querySelector('[data-testid="engine-setup"]') !== null));
  console.log('    game?  ', await page.evaluate(() => document.querySelector('[data-testid="engine-game"]') !== null));
  console.log('    turn:  ', await textOf('[data-testid="engine-turn"]'));
  console.log('    moves: ', await textOf('[data-testid="engine-moves"]'));
  console.log('    error: ', await textOf('[data-testid="engine-error"]'));
  console.log('  FAIL ', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.stop();
}
