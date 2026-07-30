/**
 * Notation and piece selection.
 *
 * Replaces the old "move the piece" drill, which put one knight on an empty
 * board and asked which piece could reach a square — a question with only one
 * possible answer.
 *
 * Here the position is a real one: legal, both kings present, and dense enough
 * to look like a game. The SAN shown is whatever chess.js generates for the
 * chosen move, including any file/rank disambiguation, so the notation is
 * never hand-assembled.
 */

import {
  contestedMoves,
  describeMoves,
  generatePosition,
  movesByType,
  type MoveOption,
} from '../../chess/positionGenerator';
import { STARTING_FEN } from '../../chess/position';
import type { PieceColor, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import type { GeneratorContext, ModeDefinition, ModeVariant, Question } from '../types';
import { buildBoard, focusOf, makeQuestion } from './shared';

export const NOTATION_VARIANTS: ModeVariant[] = [
  {
    id: 'play-the-move',
    label: 'Play the move',
    description: 'A move is given in notation. Play it on the board.',
    answerKind: 'move',
    semantics: 'legal',
  },
  {
    id: 'two-knights',
    label: 'Which knight?',
    description: 'Both knights can move. Only one can reach the square named.',
    answerKind: 'move',
    semantics: 'legal',
    pieceType: 'knight',
  },
  {
    id: 'disambiguation',
    label: 'Disambiguation',
    description: 'Two identical pieces can reach the square. The notation says which.',
    answerKind: 'move',
    semantics: 'legal',
  },
];

function placementOf(fen: string): string {
  return fen.split(' ')[0] as string;
}

/**
 * Builds a question from a position and a chosen move.
 * The prompt is the SAN; the answer is the origin/destination pair.
 */
function questionFromMove(
  context: GeneratorContext,
  fen: string,
  move: MoveOption,
  variantId: string,
  label: string,
  seed: number,
  detail?: string,
): Question {
  return makeQuestion({
    modeId: 'notation',
    variantId,
    variantLabel: label,
    prompt: {
      text: `Play ${move.san}`,
      detail,
      speech: move.san,
    },
    board: buildBoard(context, {
      fen: placementOf(fen),
      highlights: [],
      // The whole point is picking the right piece, so nothing is marked.
      showHints: false,
    }),
    expected: { kind: 'move', from: move.from, to: move.to },
    semantics: 'legal',
    focusSquares: focusOf(move.from, move.to),
    primarySquare: move.to,
    seed,
    // Carried so the session can validate the move against the real position.
    positionFen: fen,
  });
}

/**
 * Prefers moves that actually require thought: a piece with a rival competing
 * for the same square, or at least a piece type with more than one instance.
 */
function pickInteresting(rng: Rng, options: MoveOption[], fallback: MoveOption[]): MoveOption | null {
  if (options.length > 0) return rng.pick(options);
  if (fallback.length > 0) return rng.pick(fallback);
  return null;
}

export function generateNotationQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const label = NOTATION_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Play the move';
  const turn: PieceColor = context.orientation === 'black' ? 'black' : 'white';

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const requireKnights =
      variantId === 'two-knights'
        ? { type: 'knight' as PieceType, color: turn, count: 2 }
        : undefined;

    /*
     * The inner attempt budget is deliberately small. `generatePosition`
     * already retries internally, and this loop retries around it; leaving
     * both at their maximum multiplies into thousands of random games per
     * question, which made question generation take seconds.
     */
    const position = generatePosition(rng, { turn, require: requireKnights }, 30);
    if (position === null) continue;

    const { fen } = position;

    if (variantId === 'disambiguation') {
      // Only moves where SAN genuinely needed a file or rank to disambiguate.
      const ambiguous = contestedMoves(fen).filter((move) => move.isDisambiguated);
      const chosen = pickInteresting(rng, ambiguous, []);
      if (chosen === null) continue;
      return questionFromMove(
        context,
        fen,
        chosen,
        variantId,
        label,
        seed,
        'Two pieces can reach it - the notation says which',
      );
    }

    if (variantId === 'two-knights') {
      const knightMoves = movesByType(fen, 'knight');
      if (knightMoves.length === 0) continue;

      // Prefer a destination only one knight can reach, which is exactly the
      // "identify the right knight quickly" skill.
      const uncontested = knightMoves.filter((move) => move.rivals.length === 0);
      const chosen = pickInteresting(rng, uncontested, knightMoves);
      if (chosen === null) continue;

      return questionFromMove(
        context,
        fen,
        chosen,
        variantId,
        label,
        seed,
        'Both knights are on the board',
      );
    }

    // "play-the-move": any legal move, biased toward contested destinations.
    const all = describeMoves(fen);
    if (all.length === 0) continue;
    const chosen = pickInteresting(
      rng,
      all.filter((move) => move.rivals.length > 0),
      all,
    );
    if (chosen === null) continue;

    return questionFromMove(context, fen, chosen, variantId, label, seed);
  }

  // Fallback: the starting position always has legal moves, so a session can
  // never stall even if generation has an unlucky run.
  const opening = describeMoves(STARTING_FEN);
  const move = rng.pick(opening);
  return questionFromMove(context, STARTING_FEN, move, variantId, label, seed);
}

export const notationMode: ModeDefinition = {
  id: 'notation',
  title: 'Notation',
  summary: 'Read a move, play it on a real board.',
  description:
    'A move such as Nbd2 is given and you play it in a realistic position. The "Which knight?" variant guarantees both knights are on the board, so you have to work out which one the notation means.',
  category: 'notation',
  variants: NOTATION_VARIANTS,
  supportedLayouts: ['custom'],
  supportsHideBoard: false,
  supportsVoice: false,
  generate: generateNotationQuestion,
};

/** Squares occupied by pieces of the moving side; used by the session UI. */
export function movableSquaresFor(fen: string): SquareName[] {
  return [...new Set(describeMoves(fen).map((move) => move.from))];
}
