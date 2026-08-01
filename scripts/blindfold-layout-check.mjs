#!/usr/bin/env node
/**
 * Layout checks that only a real layout engine can answer.
 *
 * jsdom will happily tell you an element is absent from the tree; it cannot
 * tell you that a *present* element is reserving 340 pixels of blank space, or
 * that a button the user is meant to press has been painted invisible. Both of
 * those shipped, and both were found on a real Android phone rather than here.
 *
 * Usage: node scripts/blindfold-layout-check.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5194;
const BASE = `http://localhost:${PORT}`;

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('Puppeteer is not installed — skipping the blindfold layout checks.');
  process.exit(0);
}

const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640 },
  { name: '412x915', width: 412, height: 915 },
  { name: '480x1080', width: 480, height: 1080 },
  { name: '915x412 landscape', width: 915, height: 412 },
];

const results = [];
const failures = [];

function assert(ok, label, detail = '') {
  results.push({ ok, label, detail });
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'ignore',
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE)).ok) return true;
    } catch {
      /* not up yet */
    }
    await wait(400);
  }
  return false;
}

let browser;
let page;

const click = (selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) throw new Error(`No element for ${s}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, selector);

const exists = (selector) => page.evaluate((s) => document.querySelector(s) !== null, selector);

async function openMode(modeId) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="home-screen"]');
  await click('[data-testid="tab-modes"]');
  await page.waitForSelector(`[data-testid="mode-${modeId}"]`);
  await click(`[data-testid="mode-${modeId}"]`);
  await page.waitForSelector('[data-testid="start-session"]');
}

/** Everything the user can actually see and press, with real geometry. */
const squareGeometry = () =>
  page.evaluate(() => {
    const squares = [...document.querySelectorAll('[data-testid^="square-"]')];
    const visible = squares.filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0.05 &&
        rect.width > 0 &&
        rect.height > 0 &&
        el.closest('[aria-hidden="true"]') === null
      );
    });
    const rect = visible[0]?.getBoundingClientRect();
    return {
      total: squares.length,
      visible: visible.length,
      size: rect === undefined ? 0 : Math.min(rect.width, rect.height),
      pieces: document.querySelectorAll('.square svg').length,
    };
  });

/** Vertical space anything board-shaped is occupying right now. */
const boardHeight = () =>
  page.evaluate(() => {
    const wrap = document.querySelector('.board-wrap');
    if (wrap === null) return 0;
    return Math.round(wrap.getBoundingClientRect().height);
  });

try {
  if (!(await waitForServer())) throw new Error('preview server did not start');

  browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  page = await browser.newPage();

  console.log('\nBlindfold layout — real Chromium\n');

  for (const viewport of VIEWPORTS) {
    await page.setViewport({ width: viewport.width, height: viewport.height });

    /* ---- Reconstruction: no blank board gap during hidden playback ---- */
    await openMode('blindfold-reconstruction');
    await click('[data-testid="setup-variant-partial"]');
    await click('[data-testid="setup-board-visibility-never"]');
    await click('[data-testid="start-session"]');
    await page.waitForSelector('[data-testid="blindfold-advance"]', { timeout: 15000 });

    const gap = await boardHeight();
    assert(
      gap === 0,
      `${viewport.name}: hidden reconstruction playback reserves no board space`,
      `${gap}px`,
    );
    assert(
      await exists('[data-testid="board-collapsed-note"]'),
      `${viewport.name}: the hidden board is explained in one line`,
    );

    // Play it out, then check the palette really does sit next to the board.
    for (let i = 0; i < 40; i += 1) {
      if (!(await exists('[data-testid="blindfold-advance"]'))) break;
      await click('[data-testid="blindfold-advance"]');
    }
    await page.waitForSelector('[data-testid="piece-palette"]', { timeout: 15000 });

    const adjacency = await page.evaluate(() => {
      const board = document.querySelector('[data-testid="board"]');
      const palette = document.querySelector('[data-testid="piece-palette"]');
      if (board === null || palette === null) return null;
      const b = board.getBoundingClientRect();
      const p = palette.getBoundingClientRect();
      const buttons = [...palette.querySelectorAll('.palette__piece')];
      const smallest = Math.min(...buttons.map((el) => el.getBoundingClientRect().height));
      return {
        gapPx: Math.round(p.top - b.bottom),
        buttons: buttons.length,
        smallestButton: Math.round(smallest),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    assert(
      adjacency !== null && adjacency.gapPx < 80,
      `${viewport.name}: the palette follows the reconstruction board directly`,
      `${adjacency?.gapPx}px between them`,
    );
    assert(
      adjacency?.buttons === 12 && adjacency.smallestButton >= 44,
      `${viewport.name}: palette buttons meet the touch target`,
      `${adjacency?.buttons} buttons, smallest ${adjacency?.smallestButton}px`,
    );
    assert(adjacency?.overflow === false, `${viewport.name}: no horizontal overflow`);

    /* ---- Engine game: the hidden board is still usable ---------------- */
    await openMode('blindfold-engine-game');
    await click('[data-testid="start-session"]');
    await page.waitForSelector('[data-testid="engine-setup"]', { timeout: 20000 });
    await click('[data-testid="engine-visibility-never"]');
    await click('[data-testid="engine-difficulty-very-easy"]');
    await click('[data-testid="engine-start"]');
    await page.waitForSelector('[data-testid="engine-game"]', { timeout: 60000 });

    const grid = await squareGeometry();
    assert(
      grid.visible === 64,
      `${viewport.name}: the blindfold move grid is visible and complete`,
      `${grid.visible}/${grid.total} squares visible`,
    );
    assert(
      grid.pieces === 0,
      `${viewport.name}: no pieces are drawn on the blindfold grid`,
      `${grid.pieces} pieces`,
    );
    assert(
      grid.size >= 32,
      `${viewport.name}: blindfold squares are big enough to tap`,
      `${Math.round(grid.size)}px`,
    );

    // And it actually accepts a move.
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="engine-turn"]')
          ?.textContent?.includes('Your move') ?? false,
      { timeout: 60000 },
    );
    await wait(300);
    await click('[data-testid="square-e2"]');
    await click('[data-testid="square-e4"]');
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="engine-moves"]')?.textContent ?? '').includes('e4'),
      { timeout: 30000 },
    );
    assert(true, `${viewport.name}: a move can be entered on the hidden grid`);
  }
} catch (error) {
  assert(false, 'harness', error.message);
} finally {
  await browser?.close();
  server.kill();
}

console.log(`\n${results.length} checks, ${failures.length} failure(s).`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
