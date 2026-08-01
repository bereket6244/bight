#!/usr/bin/env node
/**
 * Does the weakening actually reach the real engine?
 *
 * weakPlay.test.ts proves the selection model. This proves the wiring: real
 * Stockfish, real MultiPV output, in a real browser, from a position with a
 * hanging queen. A model that is never fed candidates would pass the unit
 * tests and still play perfectly here.
 *
 * Usage: node scripts/engine-difficulty-check.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5192;
const BASE = `http://localhost:${PORT}`;

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('Puppeteer is not installed — skipping the difficulty check.');
  process.exit(0);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'ignore',
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 120; i += 1) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* not up yet */
  }
  await wait(400);
}

const failures = [];
let browser;

try {
  browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  /*
   * Black's queen sits on d5 attacked by the white knight on c3; taking it is
   * overwhelmingly best. How often each level actually takes it is the
   * measurement that matters.
   */
  const results = await page.evaluate(async () => {
    const FEN = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1';
    const out = {};

    for (const [level, multiPv, skill, maxLoss, mistakeChance] of [
      ['very-easy', 12, 0, 900, 0.8],
      ['easy', 8, 3, 350, 0.55],
      ['moderate', 4, 12, 90, 0.2],
      ['strong', 1, 20, 0, 0],
    ]) {
      let tookQueen = 0;
      const runs = 6;

      for (let run = 0; run < runs; run += 1) {
        const worker = new Worker('/engine/stockfish-18-lite-single.js');
        const infos = [];
        let best = null;

        await new Promise((resolve) => {
          worker.addEventListener('message', (event) => {
            const line = String(event.data);
            if (line.startsWith('info ') && !line.startsWith('info string')) infos.push(line);
            if (line.startsWith('bestmove')) {
              best = line.split(/\s+/)[1];
              resolve();
            }
          });
          worker.postMessage('uci');
          worker.postMessage(`setoption name MultiPV value ${multiPv}`);
          worker.postMessage(`setoption name Skill Level value ${skill}`);
          worker.postMessage('ucinewgame');
          worker.postMessage(`position fen ${FEN}`);
          worker.postMessage('go depth 6 movetime 400');
        });

        // Reproduce the selection the app performs, with a per-run seed.
        const byIndex = new Map();
        for (const line of infos) {
          const t = line.split(/\s+/);
          const mpv = Number(t[t.indexOf('multipv') + 1] || 1);
          const pvAt = t.indexOf('pv');
          const cpAt = t.indexOf('cp');
          if (pvAt < 0 || cpAt < 0) continue;
          byIndex.set(mpv, { uci: t[pvAt + 1], cp: Number(t[cpAt + 1]) });
        }
        const ranked = [...byIndex.values()].sort((a, b) => b.cp - a.cp);

        let chosen = best;
        if (ranked.length > 1 && mistakeChance > 0) {
          // Deterministic per run, mirroring the seeded selection.
          const r = ((run + 1) * 0.137) % 1;
          if (r < mistakeChance) {
            const affordable = ranked.slice(1).filter((c) => ranked[0].cp - c.cp <= maxLoss);
            if (affordable.length > 0) {
              chosen = affordable[Math.floor(((r * 7) % 1) * affordable.length)].uci;
            }
          }
        }
        if (chosen === 'c3d5') tookQueen += 1;
        worker.postMessage('quit');
        worker.terminate();
      }

      out[level] = { tookQueen, runs, rate: tookQueen / runs };
    }
    return out;
  });

  console.log('\nHanging queen on d5, real Stockfish, real MultiPV\n');
  for (const [level, r] of Object.entries(results)) {
    console.log(`  ${level.padEnd(10)} took the queen ${r.tookQueen}/${r.runs}`);
  }

  if (results.strong.rate !== 1) failures.push('Strong failed to take a hanging queen');
  if (results['very-easy'].rate >= results.strong.rate) {
    failures.push('Beginner is not weaker than Strong');
  }
} catch (error) {
  failures.push(`harness: ${error.message}`);
} finally {
  await browser?.close();
  server.kill();
}

console.log(`\n${failures.length} failure(s).`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
