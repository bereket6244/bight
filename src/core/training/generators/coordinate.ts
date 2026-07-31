/**
 * Coordinate recognition, both directions.
 *
 * The first version shipped "flash coordinate" and "flash square" as separate
 * mode cards, which meant navigating to a different card to practice the same
 * task with a shorter prompt. Prompt visibility is now a setting on these two
 * modes (`context.revealMs`), and the flash modes are gone.
 */

import type { SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool, pickSquare } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, Question } from '../types';
import { buildBoard, focusOf, layoutPlacement, makeQuestion } from './shared';

const SHARED_VARIANTS: ModeVariant[] = [
  {
    id: 'standard',
    label: 'Whole board',
    description: 'Any square on the board.',
    answerKind: 'single-square',
    semantics: null,
  },
];

/** "e4" spoken as "E four" so synthesis does not read it as a word. */
export function spokenCoordinate(square: SquareName): string {
  return `${(square[0] as string).toUpperCase()} ${square[1]}`;
}

/**
 * Show a coordinate, tap the square.
 *
 * Pieces are marked decorative so a tap on an occupied square still registers
 * as a tap on that square.
 */
export function generateCoordinateToSquare(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  void variantId;
  const seed = rng.nextInt(0x7fffffff);
  const square = pickSquare(buildPool(context), rng, context.weights);

  return makeQuestion({
    modeId: 'coordinate-to-square',
    variantId: 'standard',
    variantLabel: 'Find the square',
    prompt: {
      text: 'Tap the square',
      speech: spokenCoordinate(square),
      coordinate: square,
      // Undefined keeps it up; a value flashes then hides it.
      coordinateRevealMs: context.revealMs,
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
 * Highlight a square, name it on the keypad.
 *
 * The answer is a coordinate, never a tap, so tapping the highlighted square
 * can never be accepted as the answer.
 */
export function generateSquareToCoordinate(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  void variantId;
  const seed = rng.nextInt(0x7fffffff);
  const square = pickSquare(buildPool(context), rng, context.weights);
  const hidden = context.hideBoard === true;

  return makeQuestion({
    modeId: 'square-to-coordinate',
    variantId: 'standard',
    variantLabel: 'Name the square',
    prompt: {
      text: hidden ? 'Name the square that was highlighted' : 'Name the highlighted square',
    },
    board: buildBoard(context, {
      fen: layoutPlacement(context.layout),
      highlights: [square],
      decorativePieces: true,
      revealMs: context.revealMs,
      hidden,
    }),
    expected: { kind: 'coordinate', square },
    semantics: null,
    focusSquares: focusOf(square),
    primarySquare: square,
    seed,
  });
}

export const coordinateToSquareMode: ModeDefinition = {
  id: 'coordinate-to-square',
  title: 'Find the square',
  summary: 'See a coordinate, tap the square.',
  description:
    'A coordinate is shown and you tap the matching square. Pieces are decorative - tapping a square that holds one still counts.',
  category: 'coordinates',
  variants: SHARED_VARIANTS,
  rendersBoard: true,
  supportedLayouts: ['empty', 'starting'],
  supportsPromptVisibility: true,
  supportsHideBoard: false,
  generate: generateCoordinateToSquare,
};

export const squareToCoordinateMode: ModeDefinition = {
  id: 'square-to-coordinate',
  title: 'Name the square',
  summary: 'See a highlighted square, name it.',
  description:
    'A square lights up and you name it with the two-tap keypad. Turn the board off for visualization practice.',
  category: 'coordinates',
  variants: [
    {
      id: 'standard',
      label: 'Whole board',
      description: 'Any square on the board.',
      answerKind: 'coordinate',
      semantics: null,
    },
  ],
  rendersBoard: true,
  supportedLayouts: ['empty', 'starting'],
  supportsPromptVisibility: true,
  supportsHideBoard: true,
  supportsVoice: true,
  generate: generateSquareToCoordinate,
};
