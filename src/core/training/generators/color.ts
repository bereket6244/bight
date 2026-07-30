/**
 * Feature group B: square-colour training.
 *
 * The answer always comes from `squareColor`, which the test suite verifies
 * against file/rank parity for all 64 squares.
 */

import { squareColor } from '../../chess/square';
import type { Rng } from '../../rng';
import { buildPool, pickSquare } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, Question } from '../types';
import { buildBoard, focusOf, layoutPlacement, makeQuestion, placementFrom } from './shared';
import { spokenCoordinate } from './coordinate';

export const SQUARE_COLOR_VARIANTS: ModeVariant[] = [
  {
    id: 'coordinate',
    label: 'From the coordinate',
    description: 'A coordinate is shown with no board. Is it light or dark?',
    answerKind: 'square-color',
    semantics: null,
  },
  {
    id: 'highlighted',
    label: 'From the board',
    description: 'A square is highlighted on the board. Is it light or dark?',
    answerKind: 'square-color',
    semantics: null,
  },
  {
    id: 'flashed',
    label: 'Flashed square',
    description: 'The square is highlighted briefly, then hidden.',
    answerKind: 'square-color',
    semantics: null,
  },
];

/**
 * The coordinate variant deliberately shows no board: seeing the board makes
 * the question trivial, and the skill being trained is naming the colour from
 * the coordinate alone.
 */
export function generateSquareColorQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const pool = buildPool(context);
  const square = pickSquare(pool, rng, context.weights);
  const color = squareColor(square);
  const label = SQUARE_COLOR_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Square colour';

  if (variantId === 'highlighted' || variantId === 'flashed') {
    const flashed = variantId === 'flashed';
    const revealMs = context.revealMs ?? 900;
    return makeQuestion({
      modeId: 'square-color',
      variantId,
      variantLabel: label,
      prompt: {
        text: flashed
          ? 'Was the flashed square light or dark?'
          : 'Is the highlighted square light or dark?',
        detail: flashed ? `Shown for ${(revealMs / 1000).toFixed(1)}s` : undefined,
      },
      board: buildBoard(context, {
        fen: layoutPlacement(context.layout),
        highlights: [square],
        decorativePieces: true,
        revealMs: flashed ? revealMs : undefined,
      }),
      expected: { kind: 'square-color', color },
      semantics: null,
      focusSquares: focusOf(square),
      primarySquare: square,
      seed,
    });
  }

  return makeQuestion({
    modeId: 'square-color',
    variantId: 'coordinate',
    variantLabel: label,
    prompt: {
      text: `Is ${square} light or dark?`,
      coordinate: square,
      speech: spokenCoordinate(square),
    },
    board: buildBoard(context, {
      fen: placementFrom([]),
      highlights: [],
      hidden: true,
    }),
    expected: { kind: 'square-color', color },
    semantics: null,
    focusSquares: focusOf(square),
    primarySquare: square,
    seed,
  });
}

export const squareColorMode: ModeDefinition = {
  id: 'square-color',
  title: 'Square colour',
  summary: 'Light or dark, as fast as you can say it.',
  description:
    'Knowing every square\'s colour instantly underpins endgame and bishop technique. The coordinate variant hides the board so you answer from the coordinate alone.',
  variants: SQUARE_COLOR_VARIANTS,
  supportedLayouts: ['empty', 'starting'],
  generate: generateSquareColorQuestion,
};
