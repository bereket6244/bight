/**
 * Feature group A: coordinate recognition, both directions, plus the memory
 * variants that flash the prompt and then hide it.
 */

import { ALL_SQUARES } from '../../chess/square';
import type { SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool, pickSquare } from '../pool';
import type { GeneratorContext, ModeDefinition, Question } from '../types';
import { buildBoard, focusOf, layoutPlacement, makeQuestion } from './shared';

/** Squares beginners most often misread: the middle files away from corners. */
const WEAK_SQUARE_HINTS: readonly SquareName[] = ALL_SQUARES.filter((square) => {
  const file = square[0];
  const rank = Number(square[1]);
  return 'cdef'.includes(file) && rank >= 3 && rank <= 6;
});

export const COORDINATE_TO_SQUARE_VARIANTS = [
  {
    id: 'standard',
    label: 'Find the square',
    description: 'A coordinate is shown. Tap the matching square.',
    answerKind: 'single-square' as const,
    semantics: null,
  },
  {
    id: 'weak-squares',
    label: 'Weak squares',
    description: 'Draws from the squares you most often get wrong.',
    answerKind: 'single-square' as const,
    semantics: null,
  },
];

function pickPromptSquare(context: GeneratorContext, rng: Rng, variantId: string): SquareName {
  const restrictTo =
    variantId === 'weak-squares' && context.weights === undefined ? WEAK_SQUARE_HINTS : undefined;
  const pool = buildPool(context, restrictTo);
  return pickSquare(pool, rng, context.weights);
}

/**
 * A.A - show a coordinate, user taps the square.
 *
 * Pieces are marked decorative so a tap on an occupied square still registers
 * as a tap on that square, which the spec calls out explicitly.
 */
export function generateCoordinateToSquare(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const square = pickPromptSquare(context, rng, variantId);

  return makeQuestion({
    modeId: 'coordinate-to-square',
    variantId,
    variantLabel:
      COORDINATE_TO_SQUARE_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Find the square',
    prompt: {
      text: `Tap ${square}`,
      speech: spokenCoordinate(square),
      coordinate: square,
    },
    board: buildBoard(context, {
      fen: layoutPlacement(context.layout),
      highlights: [],
      decorativePieces: true,
    }),
    expected: { kind: 'single-square', square },
    semantics: null,
    focusSquares: focusOf(square),
    primarySquare: square,
    seed,
  });
}

/**
 * A.C - the coordinate is shown briefly and then hidden; the user must still
 * tap the square.
 */
export function generateMemoryCoordinateToSquare(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const base = generateCoordinateToSquare(context, rng, variantId);
  const revealMs = context.revealMs ?? 1200;

  return {
    ...base,
    modeId: 'memory-coordinate-to-square',
    variantLabel: 'Flashed coordinate',
    prompt: {
      ...base.prompt,
      text: 'Remember the coordinate, then tap the square',
      detail: `Shown for ${(revealMs / 1000).toFixed(1)}s`,
      coordinateRevealMs: revealMs,
    },
  };
}

export const SQUARE_TO_COORDINATE_VARIANTS = [
  {
    id: 'standard',
    label: 'Name the square',
    description: 'A square is highlighted. Enter its coordinate.',
    answerKind: 'coordinate' as const,
    semantics: null,
  },
  {
    id: 'weak-squares',
    label: 'Weak squares',
    description: 'Draws from the squares you most often get wrong.',
    answerKind: 'coordinate' as const,
    semantics: null,
  },
];

/**
 * A.B - highlight a square, user names it on the keypad.
 *
 * The answer is a coordinate, never a tap: tapping the already-highlighted
 * square must not be accepted as an answer, which the answer kind enforces.
 */
export function generateSquareToCoordinate(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const square = pickPromptSquare(context, rng, variantId);

  return makeQuestion({
    modeId: 'square-to-coordinate',
    variantId,
    variantLabel:
      SQUARE_TO_COORDINATE_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Name the square',
    prompt: { text: 'Name the highlighted square' },
    board: buildBoard(context, {
      fen: layoutPlacement(context.layout),
      highlights: [square],
      decorativePieces: true,
    }),
    expected: { kind: 'coordinate', square },
    semantics: null,
    focusSquares: focusOf(square),
    primarySquare: square,
    seed,
  });
}

/**
 * A.C - flash the highlight, hide it, then ask for the coordinate.
 * With `hidden` the board itself disappears too, for visualisation practice.
 */
export function generateMemorySquareToCoordinate(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const base = generateSquareToCoordinate(context, rng, variantId);
  const revealMs = context.revealMs ?? 1200;
  const hideBoard = variantId === 'blindfold';

  return {
    ...base,
    modeId: 'memory-square-to-coordinate',
    variantId,
    variantLabel: hideBoard ? 'Blindfold' : 'Flashed square',
    prompt: {
      text: hideBoard
        ? 'The board disappears - name the square that was highlighted'
        : 'Name the square that was highlighted',
      detail: `Shown for ${(revealMs / 1000).toFixed(1)}s`,
    },
    board: {
      ...base.board,
      revealMs,
      hidden: hideBoard,
    },
  };
}

/** "e4" spoken as "e four" so synthesis does not read it as a word. */
export function spokenCoordinate(square: SquareName): string {
  const file = square[0] as string;
  const rank = square[1] as string;
  const spokenFile: Record<string, string> = {
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
    e: 'E',
    f: 'F',
    g: 'G',
    h: 'H',
  };
  return `${spokenFile[file] ?? file} ${rank}`;
}

export const coordinateToSquareMode: ModeDefinition = {
  id: 'coordinate-to-square',
  title: 'Coordinate to square',
  summary: 'See a coordinate, tap the square.',
  description:
    'A coordinate such as f6 is shown and you tap the matching square. Pieces on the board are decorative - tapping a square that holds a piece still counts as tapping that square.',
  variants: COORDINATE_TO_SQUARE_VARIANTS,
  supportedLayouts: ['empty', 'starting'],
  generate: generateCoordinateToSquare,
};

export const squareToCoordinateMode: ModeDefinition = {
  id: 'square-to-coordinate',
  title: 'Square to coordinate',
  summary: 'See a highlighted square, name it.',
  description:
    'A square lights up and you name it with the two-tap keypad: file first, then rank. Tapping the highlighted square is never accepted as the answer.',
  variants: SQUARE_TO_COORDINATE_VARIANTS,
  supportedLayouts: ['empty', 'starting'],
  generate: generateSquareToCoordinate,
};

export const memoryCoordinateToSquareMode: ModeDefinition = {
  id: 'memory-coordinate-to-square',
  title: 'Flashed coordinate',
  summary: 'A coordinate appears briefly, then you tap the square.',
  description:
    'The coordinate is shown for a configurable moment and then hidden. You answer from memory by tapping the square.',
  variants: [
    {
      id: 'standard',
      label: 'Flashed coordinate',
      description: 'The coordinate is hidden after a moment.',
      answerKind: 'single-square',
      semantics: null,
    },
  ],
  supportedLayouts: ['empty', 'starting'],
  generate: generateMemoryCoordinateToSquare,
};

export const memorySquareToCoordinateMode: ModeDefinition = {
  id: 'memory-square-to-coordinate',
  title: 'Flashed square',
  summary: 'A square flashes, then you name it from memory.',
  description:
    'A square is highlighted briefly and then the highlight disappears. In the blindfold variant the whole board disappears with it.',
  variants: [
    {
      id: 'standard',
      label: 'Flashed square',
      description: 'The highlight is hidden after a moment.',
      answerKind: 'coordinate',
      semantics: null,
    },
    {
      id: 'blindfold',
      label: 'Blindfold',
      description: 'The board is hidden as well as the highlight.',
      answerKind: 'coordinate',
      semantics: null,
    },
  ],
  supportedLayouts: ['empty', 'starting'],
  generate: generateMemorySquareToCoordinate,
};
