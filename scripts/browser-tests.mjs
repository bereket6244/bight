#!/usr/bin/env node
/**
 * Real-browser layout tests.
 *
 * jsdom has no layout engine, so it cannot answer the questions this file
 * exists for: does the bottom navigation stay pinned, does any control end up
 * underneath the Start button, is there horizontal overflow at 360px. Those
 * need a browser that actually performs layout.
 *
 * Puppeteer drives the dev server. When Puppeteer is not installed the script
 * says so and exits 0, so `npm run verify` still works on a machine that has
 * not fetched a browser — CI and the documentation both note the difference.
 *
 * Usage: npm run test:browser
 */

import { startServer, waitForServer as awaitServer } from './devServer.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('Puppeteer is not installed — skipping real-browser layout tests.');
  console.log('Install it with: npm i -D puppeteer');
  process.exit(0);
}

const VIEWPORTS = [
  { name: '360x640 compact phone', width: 360, height: 640 },
  { name: '412x915 typical phone', width: 412, height: 915 },
  { name: '480x1080 S25-Ultra-class portrait', width: 480, height: 1080 },
  { name: '915x412 landscape', width: 915, height: 412 },
];

const failures = [];
const results = [];

function assert(condition, label, detail = '') {
  results.push({ ok: Boolean(condition), label, detail });
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('Starting dev server…');
const server = startServer({ cwd: root, port: PORT, mode: 'dev' });


let browser;
try {
  if (!(await awaitServer(BASE))) throw new Error('dev server did not start');

  browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  for (const viewport of VIEWPORTS) {
    await page.setViewport({ width: viewport.width, height: viewport.height });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 15000 });

    // ---- Bottom navigation stays pinned -------------------------------
    const navPinned = await page.evaluate(() => {
      const nav = document.querySelector('.tabbar');
      const main = document.querySelector('.app__main');
      if (!nav || !main) return null;
      const readings = [];
      for (const pos of [0, 0.5, 1]) {
        main.scrollTop = (main.scrollHeight - main.clientHeight) * pos;
        const r = nav.getBoundingClientRect();
        readings.push({ top: r.top, bottom: r.bottom, height: r.height });
      }
      return { readings, innerHeight: window.innerHeight };
    });

    assert(
      navPinned !== null &&
        navPinned.readings.every(
          (r) => r.bottom <= navPinned.innerHeight + 1 && r.top >= 0 && r.height > 0,
        ),
      `${viewport.name}: bottom nav stays in the viewport while scrolling`,
      JSON.stringify(navPinned?.readings),
    );

    // ---- No horizontal overflow ---------------------------------------
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert(!overflow, `${viewport.name}: no horizontal overflow on Home`);

    // ---- Setup screen: Start must not cover any control ----------------
    await page.evaluate(() => {
      document.querySelector('[data-testid="tab-modes"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await page.waitForSelector('[data-testid="mode-queen-fork"]', { timeout: 10000 });
    await page.evaluate(() => {
      document.querySelector('[data-testid="mode-queen-fork"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await page.waitForSelector('[data-testid="start-session"]', { timeout: 10000 });

    // Expand More settings: the overlap was worst with everything open.
    await page.evaluate(() => {
      document.querySelector('[data-testid="toggle-advanced"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await page.waitForSelector('[data-testid="advanced-settings"]', { timeout: 10000 });

    const setupLayout = await page.evaluate(() => {
      const main = document.querySelector('.app__main');
      const start = document.querySelector('[data-testid="start-session"]');
      const nav = document.querySelector('.tabbar');
      if (!main || !start || !nav) return null;

      const overlaps = [];
      const positions = [0, 0.25, 0.5, 0.75, 1];

      for (const pos of positions) {
        main.scrollTop = (main.scrollHeight - main.clientHeight) * pos;
        const startRect = start.getBoundingClientRect();

        // Every interactive setup control must be clear of the Start button.
        for (const el of document.querySelectorAll(
          '.segmented__item, .chip, .toggle-row input, .setup-row__label',
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const intersects =
            r.left < startRect.right &&
            r.right > startRect.left &&
            r.top < startRect.bottom &&
            r.bottom > startRect.top;
          if (intersects) {
            overlaps.push({ pos, el: el.className || el.tagName, rect: [r.top, r.bottom] });
          }
        }
      }

      // Scrolled fully down, Start must be visible and above the nav.
      main.scrollTop = main.scrollHeight;
      const startRect = start.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();

      return {
        overlaps,
        startFullyVisible: startRect.bottom <= navRect.top + 1 && startRect.top >= 0,
        startAboveNav: startRect.bottom <= navRect.top + 1,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    assert(
      setupLayout !== null && setupLayout.overlaps.length === 0,
      `${viewport.name}: no setup control is covered by the Start button`,
      setupLayout === null ? 'no layout' : JSON.stringify(setupLayout.overlaps.slice(0, 3)),
    );
    assert(
      setupLayout?.startAboveNav === true,
      `${viewport.name}: Start does not overlap the bottom navigation`,
    );
    assert(
      setupLayout?.startFullyVisible === true,
      `${viewport.name}: Start can be scrolled fully into view`,
    );
    assert(
      setupLayout?.horizontalOverflow === false,
      `${viewport.name}: no horizontal overflow on setup with More settings open`,
    );

    // ---- Blindfold ------------------------------------------------------
    // The blindfold setup page carries seven extra segmented controls, and the
    // reconstruction palette is twelve buttons across on a 360px screen, so
    // both are checked in a real layout engine rather than assumed to fit.
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 15000 });
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="tab-modes"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[data-testid="mode-blindfold-reconstruction"]', { timeout: 10000 });
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="mode-blindfold-reconstruction"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[data-testid="setup-board-visibility"]', { timeout: 10000 });

    const blindfoldSetup = await page.evaluate(() => {
      const main = document.querySelector('.app__main');
      const start = document.querySelector('[data-testid="start-session"]');
      if (!main || !start) return null;

      // Every segment must stay tappable rather than collapsing to a sliver.
      const narrow = [];
      for (const el of document.querySelectorAll('.segmented__item')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width < 32) narrow.push([el.textContent, Math.round(r.width)]);
      }

      main.scrollTop = main.scrollHeight;
      return {
        narrow,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        startVisible: start.getBoundingClientRect().top >= 0,
      };
    });

    assert(
      blindfoldSetup?.horizontalOverflow === false,
      `${viewport.name}: no horizontal overflow on the blindfold setup page`,
    );
    assert(
      blindfoldSetup !== null && blindfoldSetup.narrow.length === 0,
      `${viewport.name}: no blindfold segment is squeezed below a tappable width`,
      JSON.stringify(blindfoldSetup?.narrow.slice(0, 4)),
    );
    assert(
      blindfoldSetup?.startVisible === true,
      `${viewport.name}: Start is reachable on the blindfold setup page`,
    );

    // Play a whole sequence out and inspect the reconstruction palette.
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="setup-variant-partial"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document
        .querySelector('[data-testid="start-session"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[data-testid="blindfold-advance"]', { timeout: 15000 });

    for (let step = 0; step < 40; step += 1) {
      const more = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="blindfold-advance"]');
        if (button === null) return false;
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });
      if (!more) break;
    }

    await page.waitForSelector('[data-testid="piece-palette"]', { timeout: 15000 });

    const palette = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.palette__piece')];
      const rects = buttons.map((b) => b.getBoundingClientRect());
      const rows = [...document.querySelectorAll('.palette__row')].map((row) => {
        const r = row.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      return {
        count: buttons.length,
        minWidth: Math.min(...rects.map((r) => r.width)),
        minHeight: Math.min(...rects.map((r) => r.height)),
        rowsInside: rows.every((r) => r.left >= -1 && r.right <= window.innerWidth + 1),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    assert(palette.count === 12, `${viewport.name}: the palette offers all twelve pieces`);
    assert(
      palette.minHeight >= 44,
      `${viewport.name}: every palette button meets the 44px touch target`,
      `${Math.round(palette.minHeight)}px`,
    );
    assert(
      palette.rowsInside === true && palette.horizontalOverflow === false,
      `${viewport.name}: the palette fits the screen without horizontal scrolling`,
      `narrowest button ${Math.round(palette.minWidth)}px`,
    );
  }
} catch (error) {
  failures.push(`harness error: ${error.message}`);
} finally {
  await browser?.close();
  server.stop();
}

console.log('\nReal-browser layout results\n');
for (const r of results) {
  console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.label}${r.ok ? '' : ` — ${r.detail}`}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}
console.log(`\nAll ${results.length} layout checks passed.`);
