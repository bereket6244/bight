/**
 * Blindfold question tests.
 *
 * Every answer is re-derived here from an independent replay of the question's
 * own SAN through chess.js, rather than from anything the generator recorded.
 * A generator that wrote down its own answer key would pass its own tests and
 * fail these.
 */

import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  BLINDFOLD_PRESETS,
  DIFFICULTY_ORDER,
  DIFFICULTY_PLIES,
  LADDER_PROMOTION_STREAK,
  PROGRESSIVE_STAGES,
  RECONSTRUCTION_VARIANTS,
  TRACKING_VARIANTS,
  generateProgressiveQuestion,
  generateReconstructionQuestion,
  generateTrackingQuestion,
  ladderStage,
  stageIndexFor,
} from './blindfold';
import { createRng } from '../../rng';
import { gradeQuestion } from '../grade';
import { occupancyFromFen } from '../../chess/position';
import { emptyFilters, type GeneratorContext, type Question } from '../types';
import type { SquareName } from '../../chess/types';

function context(overrides: Partial<GeneratorContext> = {}): GeneratorContext {
  return {
    filters: emptyFilters(),
    orientation: 'white',
    labels: 'always',
    layout: 'custom',
    difficulty: 'beginner',
    plies: 6,
    captureBias: 'ordinary',
    boardVisibility: 'start-only',
    moveHistory: 'visible',
    pacing: 'manual',
    ...overrides,
  };
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

/**
 * Replays a question's own move list independently and returns the position it
 * really produces. Everything asserted below is checked against this, never
 * against the generator's bookkeeping.
 */
function replay(question: Question): Chess {
  const blindfold = question.blindfold;
  if (blindfold === undefined) throw new Error('Not a blindfold question');
  const board = new Chess();
  for (const san of blindfold.san) board.move(san);
  return board;
}

function placementOf(fen: string): string {
  return fen.split(' ')[0] as string;
}

/**
 * Which kind of tracking question this is, read back off the prompt.
 *
 * The variant list deliberately does not expose one card per question kind, so
 * the kinds are reached by sampling the mix. Classifying from the prompt keeps
 * these tests outside the generator rather than reaching into its internals.
 */
function kindOf(question: Question): string {
  const text = question.prompt.text;
  if (text.startsWith('Where is')) return 'piece-location';
  if (text.startsWith('What is on')) return 'square-contents';
  if (text.startsWith('Is there a piece on')) return 'occupancy';
  if (text.startsWith('Whose move')) return 'side-to-move';
  if (text.endsWith('still on the board?')) return 'was-captured';
  if (text.startsWith('What did')) return 'what-was-captured';
  if (text.startsWith('Does')) return 'attacks';
  return `unclassified: ${text}`;
}

/** Every question of one kind found in `count` seeds of the mixed variant. */
function sample(
  count: number,
  kind: string,
  overrides: Partial<GeneratorContext> = {},
): Array<{ question: Question; seed: number }> {
  const found: Array<{ question: Question; seed: number }> = [];
  for (let seed = 1; seed <= count; seed += 1) {
    const question = generateTrackingQuestion(context(overrides), createRng(seed), 'mixed');
    if (kindOf(question) === kind) found.push({ question, seed });
  }
  return found;
}

describe('blindfold tracking', () => {
  it('carries a sequence whose moves are all legal from the start position', () => {
    for (const seed of SEEDS) {
      const question = generateTrackingQuestion(context(), createRng(seed), 'mixed');
      const blindfold = question.blindfold;
      expect(blindfold, 'every tracking question presents a sequence').toBeDefined();
      // `replay` throws on an illegal move, which is the assertion.
      const board = replay(question);
      expect(blindfold?.san.length).toBe(6);
      expect(placementOf(board.fen())).toBe(placementOf(question.positionFen ?? ''));
    }
  });

  it('records a position after each ply that matches an independent replay', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const question = generateTrackingQuestion(context(), createRng(seed), 'mixed');
      const blindfold = question.blindfold!;
      const board = new Chess();
      blindfold.san.forEach((san, index) => {
        board.move(san);
        expect(blindfold.fenAfterPly[index], `ply ${index + 1} of seed ${seed}`).toBe(
          placementOf(board.fen()),
        );
      });
    }
  });

  it('never draws the final position on the board', () => {
    // The board a tracking question ships is the *start* of the sequence. The
    // answer lives in the position the moves produce, which the session screen
    // is responsible for never showing while the question is live.
    for (const seed of SEEDS) {
      const question = generateTrackingQuestion(context(), createRng(seed), 'mixed');
      expect(question.board.fen).toBe(question.blindfold!.startFen);
      expect(question.board.fen).not.toBe(placementOf(question.positionFen ?? ''));
    }
  });

  it('answers "where is it" with the square the replay puts the piece on', () => {
    for (const seed of SEEDS) {
      const question = generateTrackingQuestion(context(), createRng(seed), 'piece-location');
      const expected = question.expected;
      expect(expected.kind).toBe('coordinate');
      if (expected.kind !== 'coordinate') continue;

      const board = replay(question);
      const piece = board.get(expected.square as never);
      expect(piece, `seed ${seed}: ${expected.square} should hold a piece`).toBeTruthy();
    }
  });

  it('only asks about pieces that are still on the board', () => {
    for (const seed of SEEDS) {
      const question = generateTrackingQuestion(context(), createRng(seed), 'piece-location');
      // A captured piece has no square, so an answer that grades correct
      // against a replayed board is proof the target survived.
      const grade = gradeQuestion(question, {
        kind: 'coordinate',
        square: (question.expected as { square: SquareName }).square,
      });
      expect(grade.correct).toBe(true);
    }
  });

  it('answers occupancy questions from the replayed position', () => {
    const asked = sample(120, 'occupancy');
    expect(asked.length, 'the mix should include occupancy questions').toBeGreaterThan(5);

    for (const { question, seed } of asked) {
      const square = question.primarySquare as SquareName;
      const occupied = occupancyFromFen(placementOf(replay(question).fen())).has(square);
      expect((question.expected as { correct: string }).correct, `seed ${seed}, ${square}`).toBe(
        occupied ? 'Yes' : 'No',
      );
    }
  });

  it('balances occupied against empty so neither answer is a safe guess', () => {
    const asked = sample(300, 'occupancy');
    const yes = asked.filter(
      ({ question }) => (question.expected as { correct: string }).correct === 'Yes',
    ).length;
    // Fifty-fifty by construction; the window is wide enough not to be flaky.
    expect(yes / asked.length).toBeGreaterThan(0.25);
    expect(yes / asked.length).toBeLessThan(0.75);
  });

  it('answers side-to-move from the replay', () => {
    const asked = sample(160, 'side-to-move', { plies: 7 });
    expect(asked.length).toBeGreaterThan(3);

    for (const { question } of asked) {
      const turn = replay(question).turn() === 'w' ? 'White' : 'Black';
      expect((question.expected as { correct: string }).correct).toBe(turn);
    }
  });

  it('only asks side-to-move when the ply count does not give it away', () => {
    // After an even number of plies from the opening it is always White again,
    // which makes the question free. It must not appear at all.
    expect(sample(160, 'side-to-move', { plies: 8 })).toHaveLength(0);
  });

  it('balances was-captured questions between survivors and victims', () => {
    const asked = sample(300, 'was-captured', { plies: 10, captureBias: 'capture-focused' });
    expect(asked.length).toBeGreaterThan(10);

    const captured = asked.filter(
      ({ question }) => (question.expected as { correct: string }).correct === 'Captured',
    ).length;
    expect(captured / asked.length).toBeGreaterThan(0.2);
    expect(captured / asked.length).toBeLessThan(0.8);
  });

  it('reports capture status that matches the replayed board', () => {
    for (const { question } of sample(200, 'was-captured', {
      plies: 10,
      captureBias: 'capture-focused',
    })) {
      const square = question.primarySquare as SquareName;
      const board = occupancyFromFen(placementOf(replay(question).fen()));
      const answer = (question.expected as { correct: string }).correct;
      // "Still on the board" must name a square that really holds a piece.
      if (answer === 'Still on the board') expect(board.has(square)).toBe(true);
    }
  });

  it('produces every kind of question in the mix', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 200; seed += 1) {
      kinds.add(
        kindOf(
          generateTrackingQuestion(
            context({ plies: 9, captureBias: 'capture-focused' }),
            createRng(seed),
            'mixed',
          ),
        ),
      );
    }
    for (const kind of [
      'piece-location',
      'square-contents',
      'occupancy',
      'side-to-move',
      'was-captured',
      'what-was-captured',
      'attacks',
    ]) {
      expect(kinds, `the mix should reach ${kind}`).toContain(kind);
    }
  });

  it('covers every tracking variant without throwing', () => {
    for (const variant of TRACKING_VARIANTS) {
      for (const seed of SEEDS.slice(0, 5)) {
        const question = generateTrackingQuestion(
          context({ plies: 10, captureBias: 'capture-focused' }),
          createRng(seed),
          variant.id,
        );
        expect(question.modeId).toBe('blindfold-tracking');
        expect(question.prompt.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('is reproducible from a seed', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const a = generateTrackingQuestion(context(), createRng(seed), 'mixed');
      const b = generateTrackingQuestion(context(), createRng(seed), 'mixed');
      expect(b.blindfold?.san).toEqual(a.blindfold?.san);
      expect(b.prompt.text).toBe(a.prompt.text);
    }
  });

  it('honours the requested sequence length', () => {
    for (const [difficulty, plies] of Object.entries(DIFFICULTY_PLIES)) {
      const question = generateTrackingQuestion(
        context({ difficulty: difficulty as never, plies: undefined }),
        createRng(7),
        'mixed',
      );
      expect(question.blindfold?.san.length, difficulty).toBe(plies);
    }
  });
});

describe('blindfold reconstruction', () => {
  it('requires exactly the pieces the replayed position holds', () => {
    for (const seed of SEEDS) {
      const question = generateReconstructionQuestion(context(), createRng(seed), 'full');
      const expected = question.expected;
      if (expected.kind !== 'placement') throw new Error('expected a placement answer');

      const truth = occupancyFromFen(placementOf(replay(question).fen()));
      expect(expected.required.length).toBe(truth.size);
      for (const placement of expected.required) {
        const actual = truth.get(placement.square);
        expect(actual, `${placement.square} on seed ${seed}`).toEqual({
          type: placement.type,
          color: placement.color,
        });
      }
    }
  });

  it('starts full reconstruction from an empty board', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const question = generateReconstructionQuestion(context(), createRng(seed), 'full');
      expect(question.board.fen).toBe('8/8/8/8/8/8/8/8');
    }
  });

  it('asks for a workable subset in the partial variant', () => {
    for (const seed of SEEDS) {
      const question = generateReconstructionQuestion(context(), createRng(seed), 'partial');
      const expected = question.expected;
      if (expected.kind !== 'placement') throw new Error('expected a placement answer');

      expect(expected.exact).toBe(false);
      expect(expected.required.length).toBeGreaterThanOrEqual(2);
      expect(expected.required.length).toBeLessThanOrEqual(10);

      const truth = occupancyFromFen(placementOf(replay(question).fen()));
      for (const placement of expected.required) {
        expect(truth.get(placement.square)).toEqual({
          type: placement.type,
          color: placement.color,
        });
      }
    }
  });

  it('shows a damaged position in the correction variant, and asks for the truth', () => {
    for (const seed of SEEDS) {
      const question = generateReconstructionQuestion(context(), createRng(seed), 'correction');
      const expected = question.expected;
      if (expected.kind !== 'placement') throw new Error('expected a placement answer');

      const truth = occupancyFromFen(placementOf(replay(question).fen()));
      const shown = occupancyFromFen(question.board.fen);

      // The answer key is the real position, whatever was drawn.
      expect(expected.required.length).toBe(truth.size);
      expect(expected.exact).toBe(true);

      // And what was drawn is wrong in at least one and at most three places.
      let differences = 0;
      for (const square of new Set([...truth.keys(), ...shown.keys()])) {
        const a = truth.get(square);
        const b = shown.get(square);
        if (a?.type !== b?.type || a?.color !== b?.color) differences += 1;
      }
      expect(differences, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(differences, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it('grades its own truth as correct and a damaged board as wrong', () => {
    for (const variant of RECONSTRUCTION_VARIANTS) {
      const question = generateReconstructionQuestion(context(), createRng(11), variant.id);
      const expected = question.expected;
      if (expected.kind !== 'placement') throw new Error('expected a placement answer');

      expect(gradeQuestion(question, { kind: 'placement', placed: [...expected.required] }).correct)
        .toBe(true);
      expect(
        gradeQuestion(question, { kind: 'placement', placed: expected.required.slice(1) }).correct,
      ).toBe(false);
    }
  });
});

describe('progressive blindfold', () => {
  it('keeps stages out of the variant list', () => {
    // Stages differ only by a setting, so they belong in setup, not in a menu.
    expect(PROGRESSIVE_STAGES.length).toBe(6);
    expect(stageIndexFor('each-ply')).toBe(0);
    expect(stageIndexFor('never')).toBe(PROGRESSIVE_STAGES.length - 1);
    expect(stageIndexFor(undefined)).toBe(0);
  });

  it('never climbs a stage on one lucky answer', () => {
    const base = context({ boardVisibility: 'each-ply' });
    for (let streak = 0; streak < LADDER_PROMOTION_STREAK; streak += 1) {
      expect(ladderStage({ ...base, streak })).toBe(0);
    }
    expect(ladderStage({ ...base, streak: LADDER_PROMOTION_STREAK })).toBe(1);
    expect(ladderStage({ ...base, streak: LADDER_PROMOTION_STREAK * 2 })).toBe(2);
  });

  it('steps back down when recent accuracy falls, but not on one miss', () => {
    const base = context({ boardVisibility: 'every-four' });
    // A single miss resets the streak but leaves accuracy healthy.
    expect(ladderStage({ ...base, streak: 0, recentAccuracy: 0.875 })).toBe(2);
    expect(ladderStage({ ...base, streak: 0, recentAccuracy: 0.25 })).toBe(1);
  });

  it('never climbs past the last stage', () => {
    expect(ladderStage(context({ boardVisibility: 'never', streak: 500 }))).toBe(
      PROGRESSIVE_STAGES.length - 1,
    );
  });

  it('holds the chosen stage on the fixed variant however long the streak', () => {
    const question = generateProgressiveQuestion(
      context({ boardVisibility: 'start-only', streak: 100 }),
      createRng(3),
      'fixed',
    );
    expect(question.blindfold?.visibility).toBe('start-only');
  });

  it('applies the ladder stage to the presentation on the guided variant', () => {
    const question = generateProgressiveQuestion(
      context({ boardVisibility: 'each-ply', streak: LADDER_PROMOTION_STREAK }),
      createRng(3),
      'ladder',
    );
    expect(question.blindfold?.visibility).toBe(PROGRESSIVE_STAGES[1]?.visibility);
    expect(question.variantLabel).toContain('Stage 2');
  });

  it('asks a real tracking question underneath', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const question = generateProgressiveQuestion(context(), createRng(seed), 'ladder');
      expect(question.modeId).toBe('blindfold-progressive');
      expect(question.blindfold?.san.length).toBe(6);
      replay(question);
    }
  });
});

describe('difficulty presets', () => {
  it('offers four levels in a real ladder', () => {
    expect(DIFFICULTY_ORDER).toEqual(['beginner', 'intermediate', 'advanced', 'expert']);

    let previousPlies = 0;
    let previousStage = -1;
    for (const level of DIFFICULTY_ORDER) {
      const preset = BLINDFOLD_PRESETS[level];
      // Each level is longer than the last and shows no more of the board.
      expect(preset.plies, level).toBeGreaterThan(previousPlies);
      expect(stageIndexFor(preset.boardVisibility), level).toBeGreaterThanOrEqual(previousStage);
      previousPlies = preset.plies;
      previousStage = stageIndexFor(preset.boardVisibility);
    }
  });

  it('matches the ply table the generator reads', () => {
    for (const level of DIFFICULTY_ORDER) {
      expect(BLINDFOLD_PRESETS[level].plies).toBe(DIFFICULTY_PLIES[level]);
    }
  });

  it('describes each level without claiming a chess rating', () => {
    for (const level of DIFFICULTY_ORDER) {
      const preset = BLINDFOLD_PRESETS[level];
      expect(preset.detail.length).toBeGreaterThan(10);
      expect(preset.detail).not.toMatch(/\b(elo|rating|\d{3,4})\b/i);
    }
  });

  it('ends with no board and full reconstruction at expert', () => {
    expect(BLINDFOLD_PRESETS.expert.boardVisibility).toBe('never');
    expect(BLINDFOLD_PRESETS.expert.moveHistory).toBe('hidden');
    expect(BLINDFOLD_PRESETS.expert.reconstruction).toBe('full');
    expect(BLINDFOLD_PRESETS.beginner.moveHistory).toBe('visible');
  });

  it('generates a real question at every level', () => {
    for (const level of DIFFICULTY_ORDER) {
      const preset = BLINDFOLD_PRESETS[level];
      const question = generateTrackingQuestion(
        context({
          plies: preset.plies,
          boardVisibility: preset.boardVisibility,
          moveHistory: preset.moveHistory,
          captureBias: preset.captureBias,
        }),
        createRng(17),
        'mixed',
      );
      expect(question.blindfold?.san.length, level).toBe(preset.plies);
      expect(question.blindfold?.visibility, level).toBe(preset.boardVisibility);
      replay(question);
    }
  });
});

describe('question kind is recorded', () => {
  it('names the kind on every tracking question', () => {
    for (const seed of SEEDS) {
      const question = generateTrackingQuestion(context(), createRng(seed), 'mixed');
      expect(question.blindfold?.kind).toBe(kindOf(question));
    }
  });

  it('distinguishes the reconstruction variants from each other', () => {
    for (const variant of RECONSTRUCTION_VARIANTS) {
      const question = generateReconstructionQuestion(context(), createRng(5), variant.id);
      expect(question.blindfold?.kind).toBe(`${variant.id}-reconstruction`);
    }
  });

  it('never leaves the kind unset', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      for (const question of [
        generateTrackingQuestion(context(), createRng(seed), 'mixed'),
        generateReconstructionQuestion(context(), createRng(seed), 'partial'),
        generateProgressiveQuestion(context(), createRng(seed), 'ladder'),
      ]) {
        expect(question.blindfold?.kind).not.toBe('unknown');
        expect(question.blindfold?.kind).toBeTruthy();
      }
    }
  });
});
