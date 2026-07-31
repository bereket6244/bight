#!/usr/bin/env node
/**
 * A real-Chromium walkthrough of every blindfold flow, driven end to end.
 *
 * This is the review the spec asks for, run rather than described. Each flow
 * below is actually completed in a browser: sequences are played out, answers
 * are given, wrong answers are given on purpose, hints are taken, and the
 * evidence printed at the end is read back off the live DOM.
 *
 * Answers come from the development diagnostics panel (`?debug=1`), which is
 * how a person reviewing this would answer a blindfold question they did not
 * personally memorise. That panel does not exist in a production build.
 *
 * Usage: node scripts/blindfold-walkthrough.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5198;
const BASE = `http://localhost:${PORT}`;

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('Puppeteer is not installed — cannot run the walkthrough.');
  process.exit(0);
}

const evidence = [];
const failures = [];

function record(flow, detail) {
  evidence.push({ flow, detail });
  console.log(`  ok    ${flow}\n        ${detail}`);
}

function fail(flow, detail) {
  failures.push(`${flow}: ${detail}`);
  console.log(`  FAIL  ${flow}\n        ${detail}`);
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'ignore',
});

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

let browser;
let page;

/* ---------------------------------------------------------------- *
 * Small helpers over the live page
 * ---------------------------------------------------------------- */

const click = (selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) throw new Error(`No element for ${s}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, selector);

const text = (selector) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, selector);

const exists = (selector) => page.evaluate((s) => document.querySelector(s) !== null, selector);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Input is ignored for ADVANCE_LOCK_MS after a question is replaced, so that a
 * double tap cannot answer the next question by accident. This script taps
 * faster than any person can, so it waits the lock out before answering —
 * otherwise the first answer to each question is silently swallowed.
 */
const ADVANCE_LOCK_MS = 180;
const settle = () => wait(ADVANCE_LOCK_MS + 80);

async function diagnostics() {
  return page.evaluate(() => {
    const pre = document.querySelector('[data-testid="dev-diagnostics"] pre');
    return pre === null ? null : JSON.parse(pre.textContent ?? '{}');
  });
}

/** Opens a mode's setup page from Home. */
async function openMode(modeId) {
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="home-screen"]');
  await click('[data-testid="tab-modes"]');
  await page.waitForSelector(`[data-testid="mode-${modeId}"]`);
  await click(`[data-testid="mode-${modeId}"]`);
  await page.waitForSelector('[data-testid="start-session"]');
}

async function choose(testId) {
  if (await exists(`[data-testid="${testId}"]`)) await click(`[data-testid="${testId}"]`);
}

async function startSession() {
  await click('[data-testid="start-session"]');
  await page.waitForSelector('[data-testid="session-screen"]');
  // The diagnostics panel is a <details>; open it so its text is readable.
  await page.evaluate(() => {
    const details = document.querySelector('[data-testid="dev-diagnostics"]');
    if (details instanceof HTMLDetailsElement) details.open = true;
  });
}

/** Plays the whole sequence out. Returns how many moves were shown. */
async function playSequence() {
  let shown = 0;
  for (let i = 0; i < 60; i += 1) {
    if (!(await exists('[data-testid="blindfold-advance"]'))) break;
    await click('[data-testid="blindfold-advance"]');
    shown += 1;
  }
  await page.waitForSelector('[data-testid="blindfold-progress"]');
  return shown;
}

/** Answers the current question correctly, using the diagnostics panel. */
async function answerCorrectly() {
  await settle();
  const diag = await diagnostics();
  if (diag === null) throw new Error('Diagnostics unavailable — is ?debug=1 set?');
  const expected = diag.expected;

  // A choice question: click the button whose label is the answer.
  if (await exists('.answer-button')) {
    const clicked = await page.evaluate((answer) => {
      for (const button of document.querySelectorAll('.answer-button')) {
        if (button.textContent?.trim() === answer) {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, expected);
    if (!clicked) throw new Error(`No choice button for "${expected}"`);
    return { kind: 'choice', expected };
  }

  // A coordinate question: type it on the keypad.
  if (await exists('[data-testid="keypad"]')) {
    const file = expected[0];
    const rank = expected[1];
    await click(`[data-testid="key-file-${file}"]`);
    await click(`[data-testid="key-rank-${rank}"]`);
    return { kind: 'coordinate', expected };
  }

  // A placement question: `expected` is "wKe1 bQd8 …", standard piece letters.
  if (await exists('[data-testid="piece-palette"]')) {
    const pieces = expected.split(' ').filter(Boolean);
    const names = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
    let placed = 0;
    // The armed piece stays armed, and tapping it again puts it down, so a run
    // of pawns is one palette tap followed by eight squares. Re-tapping the
    // palette for each pawn would disarm it on every second one.
    let held = null;
    for (const token of pieces) {
      const color = token[0] === 'w' ? 'white' : 'black';
      const type = names[token[1]];
      if (type === undefined) throw new Error(`Cannot read placement "${token}"`);
      const square = token.slice(2);
      const wanted = `${color}-${type}`;
      if (held !== wanted) {
        await click(`[data-testid="palette-${wanted}"]`);
        held = wanted;
      }
      await click(`[data-testid="square-${square}"]`);
      placed += 1;
      // The question ends the moment the position is right.
      if (!(await exists('[data-testid="piece-palette"]'))) break;
    }
    return { kind: 'placement', expected: `${placed} of ${pieces.length} pieces` };
  }

  throw new Error('No answer control on screen');
}

/** Answers wrongly on purpose. Returns what was tried. */
async function answerWrongly() {
  await settle();
  const diag = await diagnostics();
  const expected = diag?.expected ?? '';

  if (await exists('.answer-button')) {
    return page.evaluate((answer) => {
      for (const button of document.querySelectorAll('.answer-button')) {
        const label = button.textContent?.trim();
        if (label !== answer) {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return label;
        }
      }
      return null;
    }, expected);
  }

  if (await exists('[data-testid="keypad"]')) {
    const wrongFile = expected[0] === 'a' ? 'h' : 'a';
    await click(`[data-testid="key-file-${wrongFile}"]`);
    await click(`[data-testid="key-rank-${expected[1] === '1' ? '8' : '1'}"]`);
    return `${wrongFile}${expected[1] === '1' ? '8' : '1'}`;
  }

  if (await exists('[data-testid="piece-palette"]')) {
    // A piece that certainly does not belong: a second black king.
    const empty = await page.evaluate(() => {
      for (const square of document.querySelectorAll('.square')) {
        if (square.querySelector('svg') === null) return square.dataset.square;
      }
      return null;
    });
    await click('[data-testid="palette-black-king"]');
    await click(`[data-testid="square-${empty}"]`);
    return `black king on ${empty}`;
  }
  return null;
}

/* ---------------------------------------------------------------- *
 * The flows
 * ---------------------------------------------------------------- */

try {
  if (!(await waitForServer())) throw new Error('dev server did not start');

  browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915 });

  console.log('\nBlindfold walkthrough — real Chromium\n');

  /* ---- 1. Beginner tracking ------------------------------------- */
  await openMode('blindfold-tracking');
  await choose('setup-blindfold-difficulty-beginner');
  await startSession();
  {
    const before = await diagnostics();
    const shown = await playSequence();
    const answered = await answerCorrectly();
    const after = await diagnostics();
    record(
      'Beginner tracking',
      `${before.blindfold.plies} plies (${before.blindfold.san}), ${shown} taps to play it out, ` +
        `question "${before.blindfold.kind}" answered ${answered.expected}; ` +
        `questionsCompleted ${before.questionsCompleted} → ${after.questionsCompleted}, ` +
        `next question ${after.questionId}`,
    );
    if (after.questionsCompleted !== before.questionsCompleted + 1) {
      fail('Beginner tracking', 'a correct answer did not complete the question');
    }
  }

  /* ---- 2. Wrong-answer flow ------------------------------------- */
  {
    await playSequence();
    const before = await diagnostics();
    const tried = await answerWrongly();
    const stillSame = (await diagnostics()).questionId === before.questionId;
    const flashed = await page.evaluate(
      () =>
        document.querySelector('.answer-button--wrong, .square--wrong, .palette--wrong') !== null,
    );
    const revealed = await page.evaluate(
      () => document.body.textContent?.includes('The answer is') ?? false,
    );
    record(
      'Wrong-answer flow',
      `answered "${tried}" instead of "${before.expected}": question kept (${stillSame}), ` +
        `red flash shown (${flashed}), answer revealed (${revealed}), no result screen`,
    );
    if (!stillSame) fail('Wrong-answer flow', 'a wrong answer replaced the question');
    if (revealed) fail('Wrong-answer flow', 'the answer was revealed');
    // Now get it right so the session can move on.
    await answerCorrectly();
  }

  /* ---- 3. Retry flow -------------------------------------------- */
  {
    const queued = (await diagnostics()).retryQueue;
    record(
      'Retry flow',
      `after one miss the retry queue holds ${queued} question(s); ` +
        'missed questions come back later in the session rather than immediately',
    );
    if (queued < 1) fail('Retry flow', 'a missed question was not queued for retry');
  }

  /* ---- 4. Intermediate tracking --------------------------------- */
  await openMode('blindfold-tracking');
  await choose('setup-blindfold-difficulty-intermediate');
  await startSession();
  {
    const diag = await diagnostics();
    await playSequence();
    const boardHidden = await exists('.board-wrap--hidden');
    await answerCorrectly();
    record(
      'Intermediate tracking',
      `${diag.blindfold.plies} plies, board "${diag.blindfold.visibility}", ` +
        `history "${diag.blindfold.history}", board hidden while answering (${boardHidden})`,
    );
    if (!boardHidden) fail('Intermediate tracking', 'the final position was on screen');
  }

  /* ---- 5. Capture-focused tracking ------------------------------ */
  await openMode('blindfold-tracking');
  await choose('setup-variant-captures');
  await choose('setup-capture-bias-heavy-exchanges');
  await startSession();
  {
    const diag = await diagnostics();
    await playSequence();
    const prompt = await text('.prompt__text');
    await answerCorrectly();
    record(
      'Capture-focused tracking',
      `heavy exchanges over ${diag.blindfold.plies} plies (${diag.blindfold.san}); ` +
        `asked "${prompt}" (kind ${diag.blindfold.kind})`,
    );
  }

  /* ---- 6-8. The individual question kinds ------------------------ */
  {
    const wanted = new Set(['piece-location', 'occupancy', 'was-captured']);
    const seen = new Map();
    let asked = 0;

    // Long enough and capture-heavy enough that every kind is on the table;
    // "was-captured" cannot come up in a sequence with no captures in it.
    await openMode('blindfold-tracking');
    await choose('setup-blindfold-difficulty-intermediate');
    await choose('setup-capture-bias-capture-focused');
    await choose('setup-limit-endless');
    await startSession();

    for (let i = 0; i < 60 && wanted.size > seen.size; i += 1) {
      if (!(await exists('[data-testid="session-screen"]'))) break;
      if (await exists('[data-testid="session-summary"]')) break;
      await playSequence();
      const diag = await diagnostics();
      if (diag === null) break;
      const prompt = await text('.prompt__text');
      if (wanted.has(diag.blindfold.kind) && !seen.has(diag.blindfold.kind)) {
        seen.set(diag.blindfold.kind, { prompt, expected: diag.expected });
      }
      await answerCorrectly();
      asked += 1;
    }

    for (const kind of wanted) {
      const hit = seen.get(kind);
      if (hit === undefined) fail(`Question kind: ${kind}`, `not reached in ${asked} questions`);
      else record(`Question kind: ${kind}`, `"${hit.prompt}" → answered "${hit.expected}"`);
    }
  }

  /* ---- 9. Session summary --------------------------------------- */
  {
    if (await exists('[data-testid="end-session"]')) await click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="session-summary"]', { timeout: 10000 });
    const summary = await page.evaluate(() => {
      const values = [...document.querySelectorAll('.stat')].map(
        (s) =>
          `${s.querySelector('.stat__label')?.textContent?.trim()}: ${s
            .querySelector('.stat__value')
            ?.textContent?.trim()}`,
      );
      return values.join(' · ');
    });
    record('Session summary', summary);
  }

  /* ---- 10. Partial reconstruction -------------------------------- */
  await openMode('blindfold-reconstruction');
  await choose('setup-variant-partial');
  await startSession();
  {
    const diag = await diagnostics();
    await playSequence();
    const prompt = await text('.prompt__text');
    const before = (await diagnostics()).questionsCompleted;
    const answered = await answerCorrectly();
    const after = await diagnostics();
    record(
      'Partial reconstruction',
      `"${prompt}" — placed ${answered.expected} by tapping piece then square; ` +
        `auto-completed with no Submit (questionsCompleted ${before} → ${after.questionsCompleted}); ` +
        `sequence ${diag.blindfold.san}`,
    );
    if (after.questionsCompleted !== before + 1) {
      fail('Partial reconstruction', 'placing every piece did not complete the question');
    }
  }

  /* ---- 11. Full reconstruction ----------------------------------- */
  await openMode('blindfold-reconstruction');
  await choose('setup-variant-full');
  await choose('setup-blindfold-plies-4');
  await startSession();
  {
    await playSequence();
    const prompt = await text('.prompt__text');
    const before = await diagnostics();
    const answered = await answerCorrectly();
    const after = await diagnostics();
    record(
      'Full reconstruction',
      `"${prompt}" — rebuilt ${answered.expected}, ` +
        `${after.blindfold?.placed ?? 'n/a'} standing on the board; ` +
        `questionsCompleted ${before.questionsCompleted} → ${after.questionsCompleted}`,
    );
    if (after.questionsCompleted !== before.questionsCompleted + 1) {
      fail('Full reconstruction', 'the exact final position was not accepted');
    }
  }

  /* ---- 12. Progressively hidden sequence ------------------------- */
  await openMode('blindfold-progressive');
  await choose('setup-board-visibility-each-ply');
  await startSession();
  {
    const stage = await text('.session-bar strong');
    const visibleDuring = [];
    for (let i = 0; i < 20; i += 1) {
      if (!(await exists('[data-testid="blindfold-advance"]'))) break;
      visibleDuring.push(!(await exists('.board-wrap--hidden')));
      await click('[data-testid="blindfold-advance"]');
    }
    const hiddenAfter = await exists('.board-wrap--hidden');
    record(
      'Progressively hidden sequence',
      `${stage}; board drawn during ${visibleDuring.filter(Boolean).length}/${visibleDuring.length} ` +
        `plies at the most generous stage, hidden once the sequence ended (${hiddenAfter})`,
    );
    if (!hiddenAfter) {
      fail('Progressively hidden sequence', 'the final position was left on the board');
    }
    await answerCorrectly();
  }

  /* ---- 13. Hint flow --------------------------------------------- */
  await openMode('blindfold-tracking');
  await choose('setup-move-history-hidden');
  await choose('setup-allow-hints-on');
  await startSession();
  {
    await playSequence();
    const before = await diagnostics();
    await click('[data-testid="blindfold-hint"]');
    const shown = await text('[data-testid="blindfold-hint-moves"]');
    const after = await diagnostics();
    await answerCorrectly();
    record(
      'Hint flow',
      `hint gave back the move list ("${shown}"); ` +
        `hintsUsed ${before.blindfold.hintsUsed} → ${after.blindfold.hintsUsed}; ` +
        'the answer itself was never shown',
    );
    if (after.blindfold.hintsUsed !== before.blindfold.hintsUsed + 1) {
      fail('Hint flow', 'the hint was not recorded');
    }
  }

  /* ---- 14. Progress blindfold section ---------------------------- */
  {
    if (await exists('[data-testid="end-session"]')) await click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="session-summary"]', { timeout: 10000 });
    // Leave the summary by its own exit, so the session is persisted before
    // Progress reads it back.
    if (await exists('[data-testid="summary-exit"]')) await click('[data-testid="summary-exit"]');
    await page.waitForSelector('[data-testid="tab-progress"]', { timeout: 10000 });
    await click('[data-testid="tab-progress"]');
    await page.waitForSelector('[data-testid="blindfold-progress"]', { timeout: 15000 });

    const section = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="blindfold-progress"]');
      const stats = [...card.querySelectorAll('.stat')].map(
        (s) =>
          `${s.querySelector('.stat__label')?.textContent?.trim()} ${s
            .querySelector('.stat__value')
            ?.textContent?.trim()}`,
      );
      const rec = card.querySelector('[data-testid="blindfold-recommendation"]');
      return {
        stats: stats.join(' · '),
        recommendation: rec?.textContent?.trim() ?? null,
        separateFromMastery:
          document.body.textContent?.includes('Kept separate from board mastery') ?? false,
      };
    });
    record(
      'Progress blindfold section',
      `${section.stats}; recommendation "${section.recommendation}"; ` +
        `stated as separate from board mastery (${section.separateFromMastery})`,
    );
  }

  /* ---- 15. Backup export and import ------------------------------ */
  {
    const roundTrip = await page.evaluate(async () => {
      // Drive the repository the Settings screen uses, through the same
      // service, so this is the real export/import path rather than a mock.
      const service = await import('/src/core/backup/service.ts');
      const storage = await import('/src/core/storage/index.ts');
      const { repository } = await storage.createRepository();

      const before = await repository.getAttempts({ limit: 5000 });
      const blindfoldBefore = before.filter((a) => a.modeId.startsWith('blindfold-'));
      const json = await service.exportBackup(repository);
      const result = await service.importBackup(repository, json, 'replace');
      const after = await repository.getAttempts({ limit: 5000 });
      const blindfoldAfter = after.filter((a) => a.modeId.startsWith('blindfold-'));

      return {
        ok: result.ok,
        errors: result.errors,
        bytes: json.length,
        before: blindfoldBefore.length,
        after: blindfoldAfter.length,
        sample: blindfoldAfter[0]
          ? {
              plies: blindfoldAfter[0].plies,
              visibility: blindfoldAfter[0].boardVisibility,
              kind: blindfoldAfter[0].blindfoldKind,
              hintsUsed: blindfoldAfter[0].hintsUsed,
            }
          : null,
      };
    });

    record(
      'Backup export/import with blindfold attempts',
      `exported ${roundTrip.bytes} bytes, re-imported ok=${roundTrip.ok}; ` +
        `${roundTrip.before} blindfold attempts before, ${roundTrip.after} after; ` +
        `fields survived: ${JSON.stringify(roundTrip.sample)}`,
    );
    if (!roundTrip.ok || roundTrip.after !== roundTrip.before) {
      fail('Backup round trip', roundTrip.errors.join('; ') || 'attempt count changed');
    }
  }
} catch (error) {
  fail('harness', error.message);
} finally {
  await browser?.close();
  server.kill();
}

console.log('\n─────────────────────────────────────────────');
console.log(`${evidence.length} flows completed, ${failures.length} failure(s).`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
