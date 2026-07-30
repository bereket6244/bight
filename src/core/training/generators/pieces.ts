/**
 * Position vision and alignment.
 *
 * What was removed here, and why:
 *  - "Tap every square a queen/rook/bishop sees on an empty board" — the whole
 *    board is visible, so the answer is drawn for you. Tedious, not training.
 *  - "Name the diagonal" and "File and rank" — the same task in other words.
 *  - Pawn pushes vs captures — a repetitive board-vision card for something
 *    that appears naturally in notation exercises.
 *  - The directional coordinate walk ("go up, go left, where are you?") —
 *    screen-relative language that becomes actively misleading under Black
 *    orientation, and is not how chess coordinates are used.
 *
 * What is kept is sliding-piece vision *in traffic*, where occupancy decides
 * the answer and the board does not give it away. The geometry functions those
 * removed drills used are untouched in `core/chess` and still tested.
 */

import { firstBlockers, geometricTargets, BISHOP_DIRECTIONS, QUEEN_DIRECTIONS, ROOK_DIRECTIONS } from '../../chess/geometry';
import { occupancyFromPieces } from '../../chess/position';
import { sameDiagonal, sameFile, sameRank } from '../../chess/square';
import type { PieceColor, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool, pickSquare, pickSquareAvoiding } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, PieceOnBoard, Question } from '../types';
import { buildBoard, ensureAnswerable, focusOf, makeQuestion, placementFrom, PIECE_NAMES } from './shared';

const SLIDERS: PieceType[] = ['bishop', 'rook', 'queen'];

export const PIECE_VISION_VARIANTS: ModeVariant[] = SLIDERS.map((piece) => ({
  id: `${piece}-blocked`,
  label: `${PIECE_NAMES[piece][0].toUpperCase()}${PIECE_NAMES[piece].slice(1)}`,
  description: `Where can the ${PIECE_NAMES[piece]} actually go with pieces in the way?`,
  answerKind: 'square-set' as const,
  semantics: 'legal' as const,
  pieceType: piece,
}));

function scatterOnRays(
  origin: SquareName,
  piece: PieceType,
  rng: Rng,
  moverColor: PieceColor,
): PieceOnBoard[] {
  const reachable = geometricTargets({ type: piece, color: moverColor }, origin);
  const count = rng.nextIntBetween(3, Math.min(6, Math.max(3, reachable.length)));
  return rng.sample(reachable, count).map((square) => ({
    square,
    color: rng.chance(0.5) ? moverColor : moverColor === 'white' ? 'black' : 'white',
    type: rng.pick(['pawn', 'knight', 'bishop'] as const),
  }));
}

export function generatePieceVisionQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const color: PieceColor = 'white';
  const piece = (SLIDERS.find((p) => variantId.startsWith(p)) ?? 'bishop') as PieceType;
  const origin = pickSquare(buildPool(context), rng, context.weights);

  const targetsWith = (blockers: readonly PieceOnBoard[]): SquareName[] =>
    geometricTargets({ type: piece, color }, origin, {
      occupancy: occupancyFromPieces([{ square: origin, type: piece, color }, ...blockers]),
    });

  const blockers = ensureAnswerable(
    scatterOnRays(origin, piece, rng, color),
    (candidate) => targetsWith(candidate).length > 0,
  );
  const answer = targetsWith(blockers);

  return makeQuestion({
    modeId: 'piece-vision',
    variantId: `${piece}-blocked`,
    variantLabel: PIECE_VISION_VARIANTS.find((v) => v.pieceType === piece)?.label ?? 'Piece vision',
    prompt: {
      text: `Tap every square the ${PIECE_NAMES[piece]} can move to`,
      detail: 'Your own pieces block; enemy pieces can be captured',
    },
    board: buildBoard(context, {
      fen: placementFrom([{ square: origin, type: piece, color }, ...blockers]),
      highlights: [origin],
    }),
    expected: { kind: 'square-set', squares: answer },
    semantics: 'legal',
    focusSquares: focusOf(origin, answer),
    primarySquare: origin,
    seed,
  });
}

export const pieceVisionMode: ModeDefinition = {
  id: 'piece-vision',
  title: 'Sliding pieces in traffic',
  summary: 'Where a bishop, rook or queen can actually go.',
  description:
    'A sliding piece is surrounded by other pieces. Tap only the squares it can really reach - your own pieces block, enemy pieces can be captured.',
  category: 'position',
  variants: PIECE_VISION_VARIANTS,
  supportedLayouts: ['custom'],
  generate: generatePieceVisionQuestion,
};

/* ------------------------------------------------------------------ *
 * First blocker
 * ------------------------------------------------------------------ */

export function generateBlockerQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const piece: PieceType = variantId === 'rook' ? 'rook' : variantId === 'bishop' ? 'bishop' : 'queen';
  const directions =
    piece === 'rook' ? ROOK_DIRECTIONS : piece === 'bishop' ? BISHOP_DIRECTIONS : QUEEN_DIRECTIONS;

  const color: PieceColor = 'white';
  const origin = pickSquare(buildPool(context), rng, context.weights);
  const blockers = scatterOnRays(origin, piece, rng, color);
  const occupancy = occupancyFromPieces([{ square: origin, type: piece, color }, ...blockers]);
  const answer = firstBlockers(origin, directions, occupancy);

  return makeQuestion({
    modeId: 'blockers',
    variantId,
    variantLabel: `First blocker (${PIECE_NAMES[piece]})`,
    prompt: {
      text: `Tap the first piece the ${PIECE_NAMES[piece]} meets in each direction`,
      detail: 'One square per direction, friendly or enemy',
    },
    board: buildBoard(context, {
      fen: placementFrom([{ square: origin, type: piece, color }, ...blockers]),
      highlights: [origin],
    }),
    expected: { kind: 'square-set', squares: answer },
    semantics: 'geometry',
    focusSquares: focusOf(origin, answer),
    primarySquare: origin,
    seed,
  });
}

export const blockerMode: ModeDefinition = {
  id: 'blockers',
  title: 'First blocker',
  summary: 'Which piece stops each ray?',
  description:
    'Tap the first piece a slider meets along each direction - the squares that decide what it actually controls.',
  category: 'position',
  variants: [
    { id: 'rook', label: 'Rook', description: 'Four directions.', answerKind: 'square-set', semantics: 'geometry', pieceType: 'rook' },
    { id: 'bishop', label: 'Bishop', description: 'Four diagonals.', answerKind: 'square-set', semantics: 'geometry', pieceType: 'bishop' },
    { id: 'queen', label: 'Queen', description: 'All eight directions.', answerKind: 'square-set', semantics: 'geometry', pieceType: 'queen' },
  ],
  supportedLayouts: ['custom'],
  generate: generateBlockerQuestion,
};

/* ------------------------------------------------------------------ *
 * Alignment - answered from coordinates, with no board to read it off.
 * ------------------------------------------------------------------ */

const ALIGNMENT_CHOICES = ['Same rank', 'Same file', 'Same diagonal', 'None'];

export function generateAlignmentQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  void variantId;
  const seed = rng.nextInt(0x7fffffff);
  const pool = buildPool(context);
  const first = pickSquare(pool, rng, context.weights);
  const second = pickSquareAvoiding(pool, [first], rng, context.weights);

  const correct = sameRank(first, second)
    ? 'Same rank'
    : sameFile(first, second)
      ? 'Same file'
      : sameDiagonal(first, second)
        ? 'Same diagonal'
        : 'None';

  return makeQuestion({
    modeId: 'alignment',
    variantId: 'standard',
    variantLabel: 'Alignment',
    prompt: { text: `${first} and ${second}` },
    board: buildBoard(context, {
      fen: placementFrom([]),
      highlights: [],
      // Drawing both squares would answer the question visually.
      hidden: true,
    }),
    expected: { kind: 'choice', choices: ALIGNMENT_CHOICES, correct },
    semantics: 'geometry',
    focusSquares: focusOf(first, second),
    primarySquare: first,
    seed,
  });
}

export const alignmentMode: ModeDefinition = {
  id: 'alignment',
  title: 'Alignment',
  summary: 'Do two squares share a rank, file or diagonal?',
  description:
    'Two coordinates are named with no board shown. Seeing alignment instantly is what lets you spot pins, skewers and batteries.',
  category: 'coordinates',
  variants: [
    {
      id: 'standard',
      label: 'Rank, file or diagonal',
      description: 'Answer from the coordinates alone.',
      answerKind: 'choice',
      semantics: 'geometry',
    },
  ],
  supportedLayouts: ['empty'],
  supportsHideBoard: false,
  generate: generateAlignmentQuestion,
};
