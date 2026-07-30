/**
 * Square colour.
 *
 * One exercise only: a coordinate is shown with no board, and you say whether
 * that square is light or dark.
 *
 * The first version also offered "from the board" and "flashed square"
 * variants, which highlighted the square on a green-and-cream board and then
 * asked its colour. The board answered the question for you, so they trained
 * nothing and are gone. That is why this mode never draws a board.
 */

import { squareColor } from '../../chess/square';
import type { Rng } from '../../rng';
import { buildPool, pickSquare } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, Question } from '../types';
import { buildBoard, focusOf, makeQuestion, placementFrom } from './shared';
import { spokenCoordinate } from './coordinate';

export const SQUARE_COLOR_VARIANTS: ModeVariant[] = [
  {
    id: 'coordinate',
    label: 'Light or dark',
    description: 'A coordinate is shown. Say whether the square is light or dark.',
    answerKind: 'square-color',
    semantics: null,
  },
];

export function generateSquareColorQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  void variantId; // This mode has exactly one variant.
  const seed = rng.nextInt(0x7fffffff);
  const square = pickSquare(buildPool(context), rng, context.weights);

  return makeQuestion({
    modeId: 'square-color',
    variantId: 'coordinate',
    variantLabel: 'Light or dark',
    prompt: {
      text: `Is ${square} light or dark?`,
      coordinate: square,
      coordinateRevealMs: context.revealMs,
      speech: spokenCoordinate(square),
    },
    board: buildBoard(context, {
      fen: placementFrom([]),
      highlights: [],
      // No board: seeing the square would give the answer away.
      hidden: true,
    }),
    expected: { kind: 'square-color', color: squareColor(square) },
    semantics: null,
    focusSquares: focusOf(square),
    primarySquare: square,
    seed,
  });
}

export const squareColorMode: ModeDefinition = {
  id: 'square-color',
  title: 'Square color',
  summary: 'Light or dark, from the coordinate alone.',
  description:
    'Knowing every square\'s color instantly underpins endgame and bishop technique. No board is shown - that is the point.',
  category: 'square-color',
  variants: SQUARE_COLOR_VARIANTS,
  supportedLayouts: ['empty'],
  supportsHideBoard: false,
  supportsPromptVisibility: true,
  supportsVoice: true,
  generate: generateSquareColorQuestion,
};
