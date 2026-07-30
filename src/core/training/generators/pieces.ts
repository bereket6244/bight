/**
 * Feature groups D and E: vision and movement for the other pieces.
 *
 * All answers are derived from the geometry module or chess.js. Nothing here
 * re-implements movement rules.
 */

import {
  attackedSquares,
  diagonalsThrough,
  fileSquares,
  firstBlockers,
  geometricTargets,
  pawnCaptureSquares,
  pawnPushTargets,
  rankSquares,
  sortSquares,
  BISHOP_DIRECTIONS,
  QUEEN_DIRECTIONS,
  ROOK_DIRECTIONS,
} from '../../chess/geometry';
import { legalDestinations } from '../../chess/legal';
import { fenFromOccupancy, occupancyFromPieces } from '../../chess/position';
import {
  ALL_SQUARES,
  rankOf,
  sameDiagonal,
  sameFile,
  sameRank,
  toCoordinates,
  toSquareOrNull,
} from '../../chess/square';
import type { PieceColor, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool, pickSquare, pickSquareAvoiding } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, PieceOnBoard, Question } from '../types';
import {
  buildBoard,
  ensureAnswerable,
  focusOf,
  makeQuestion,
  placementFrom,
  semanticsLabel,
  PIECE_NAMES,
} from './shared';

const VISION_PIECES: PieceType[] = ['bishop', 'rook', 'queen', 'king', 'pawn'];

export const PIECE_VISION_VARIANTS: ModeVariant[] = [
  ...VISION_PIECES.map((piece) => ({
    id: `${piece}-geometry`,
    label: `${PIECE_NAMES[piece][0].toUpperCase()}${PIECE_NAMES[piece].slice(1)} sight`,
    description: `Tap every square a ${PIECE_NAMES[piece]} attacks from its square, ignoring occupancy.`,
    answerKind: 'square-set' as const,
    semantics: 'geometry' as const,
    pieceType: piece,
  })),
  ...(['bishop', 'rook', 'queen'] as PieceType[]).map((piece) => ({
    id: `${piece}-blocked`,
    label: `${PIECE_NAMES[piece][0].toUpperCase()}${PIECE_NAMES[piece].slice(1)} through traffic`,
    description: `Tap every square the ${PIECE_NAMES[piece]} can move to with pieces in the way.`,
    answerKind: 'square-set' as const,
    semantics: 'legal' as const,
    pieceType: piece,
  })),
  {
    id: 'diagonal',
    label: 'Name the diagonal',
    description: 'Tap every square on the marked diagonal.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'bishop',
  },
  {
    id: 'file-and-rank',
    label: 'File and rank',
    description: "Tap every square on the rook's file and rank.",
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'rook',
  },
  {
    id: 'pawn-moves-vs-captures',
    label: 'Pushes or captures',
    description: 'Tap only the squares the pawn can capture on - not where it can push.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'pawn',
  },
];

function pieceOfVariant(variantId: string): PieceType {
  const found = PIECE_VISION_VARIANTS.find((v) => v.id === variantId)?.pieceType;
  return found ?? 'bishop';
}

function labelOfVariant(variantId: string): string {
  return PIECE_VISION_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Piece sight';
}

/** Pawns cannot stand on the first or last rank. */
function poolForPiece(context: GeneratorContext, piece: PieceType): SquareName[] {
  const pool = buildPool(context);
  if (piece !== 'pawn') return pool;
  const legal = pool.filter((square) => {
    const rank = rankOf(square);
    return rank > 0 && rank < 7;
  });
  return legal.length > 0 ? legal : ALL_SQUARES.filter((s) => rankOf(s) > 0 && rankOf(s) < 7);
}

function scatterOnRays(
  origin: SquareName,
  piece: PieceType,
  rng: Rng,
  moverColor: PieceColor,
): PieceOnBoard[] {
  const reachable = geometricTargets({ type: piece, color: moverColor }, origin);
  const count = rng.nextIntBetween(2, Math.min(4, Math.max(2, reachable.length)));
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

  if (variantId === 'diagonal') {
    const origin = pickSquare(poolForPiece(context, 'bishop'), rng, context.weights);
    const [rising, falling] = diagonalsThrough(origin);
    const chosen = (rising as SquareName[]).length >= (falling as SquareName[]).length ? rising : falling;
    const answer = sortSquares((chosen as SquareName[]).filter((square) => square !== origin));

    return makeQuestion({
      modeId: 'piece-vision',
      variantId,
      variantLabel: labelOfVariant(variantId),
      prompt: {
        text: `Tap every other square on the diagonal through ${origin}`,
        detail: 'One diagonal only - the longer one',
        coordinate: origin,
      },
      board: buildBoard(context, {
        fen: placementFrom([{ square: origin, type: 'bishop', color }]),
        highlights: [origin],
      }),
      expected: { kind: 'square-set', squares: answer },
      semantics: 'geometry',
      focusSquares: focusOf(origin, answer),
      primarySquare: origin,
      seed,
    });
  }

  if (variantId === 'file-and-rank') {
    const origin = pickSquare(poolForPiece(context, 'rook'), rng, context.weights);
    const answer = sortSquares(
      [...fileSquares(origin), ...rankSquares(origin)].filter((square) => square !== origin),
    );

    return makeQuestion({
      modeId: 'piece-vision',
      variantId,
      variantLabel: labelOfVariant(variantId),
      prompt: {
        text: `Tap every square on the file and rank through ${origin}`,
        coordinate: origin,
      },
      board: buildBoard(context, {
        fen: placementFrom([{ square: origin, type: 'rook', color }]),
        highlights: [origin],
      }),
      expected: { kind: 'square-set', squares: answer },
      semantics: 'geometry',
      focusSquares: focusOf(origin, answer),
      primarySquare: origin,
      seed,
    });
  }

  if (variantId === 'pawn-moves-vs-captures') {
    const origin = pickSquare(poolForPiece(context, 'pawn'), rng, context.weights);
    const captures = pawnCaptureSquares(origin, color);
    const pushes = pawnPushTargets(origin, color);

    return makeQuestion({
      modeId: 'piece-vision',
      variantId,
      variantLabel: labelOfVariant(variantId),
      prompt: {
        text: 'Tap only the squares this pawn could capture on',
        detail: 'Captures are diagonal - pushes are not captures',
      },
      board: buildBoard(context, {
        fen: placementFrom([{ square: origin, type: 'pawn', color }]),
        highlights: [origin],
      }),
      expected: { kind: 'square-set', squares: captures },
      semantics: 'geometry',
      focusSquares: focusOf(origin, captures, pushes),
      primarySquare: origin,
      seed,
    });
  }

  if (variantId.endsWith('-blocked')) {
    const piece = pieceOfVariant(variantId);
    const origin = pickSquare(poolForPiece(context, piece), rng, context.weights);

    const targetsWith = (blockers: readonly PieceOnBoard[]): SquareName[] =>
      geometricTargets({ type: piece, color }, origin, {
        occupancy: occupancyFromPieces([{ square: origin, type: piece, color }, ...blockers]),
      });

    // Friendly blockers can seal a piece in completely; drop them until the
    // question has an answer.
    const blockers = ensureAnswerable(
      scatterOnRays(origin, piece, rng, color),
      (candidate) => targetsWith(candidate).length > 0,
    );
    const answer = targetsWith(blockers);

    return makeQuestion({
      modeId: 'piece-vision',
      variantId,
      variantLabel: labelOfVariant(variantId),
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

  // "<piece>-geometry"
  const piece = pieceOfVariant(variantId);
  const origin = pickSquare(poolForPiece(context, piece), rng, context.weights);
  const answer = attackedSquares({ type: piece, color }, origin);

  return makeQuestion({
    modeId: 'piece-vision',
    variantId,
    variantLabel: labelOfVariant(variantId),
    prompt: {
      text: `Tap every square the ${PIECE_NAMES[piece]} attacks`,
      detail: semanticsLabel('geometry'),
    },
    board: buildBoard(context, {
      fen: placementFrom([{ square: origin, type: piece, color }]),
      highlights: [origin],
    }),
    expected: { kind: 'square-set', squares: answer },
    semantics: 'geometry',
    focusSquares: focusOf(origin, answer),
    primarySquare: origin,
    seed,
  });
}

export const pieceVisionMode: ModeDefinition = {
  id: 'piece-vision',
  title: 'Piece vision',
  summary: 'Bishops, rooks, queens, kings and pawns.',
  description:
    'Board vision for every piece except the knight, which has its own mode. Includes diagonals, files and ranks, blocked rays, and the difference between a pawn push and a pawn capture.',
  variants: PIECE_VISION_VARIANTS,
  supportedLayouts: ['empty', 'custom'],
  generate: generatePieceVisionQuestion,
};

/* ------------------------------------------------------------------ *
 * Alignment: do two squares share a rank, file or diagonal?
 * ------------------------------------------------------------------ */

const ALIGNMENT_CHOICES = ['Same rank', 'Same file', 'Same diagonal', 'None of these'];

export function generateAlignmentQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
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
        : 'None of these';

  return makeQuestion({
    modeId: 'alignment',
    variantId,
    variantLabel: 'Alignment',
    prompt: {
      text: `How are ${first} and ${second} related?`,
      detail: 'Rank, file, diagonal, or none',
    },
    board: buildBoard(context, {
      fen: placementFrom([]),
      highlights: [first, second],
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
    'Two squares are highlighted and you say how they relate. Seeing alignment instantly is what lets you spot pins, skewers and batteries.',
  variants: [
    {
      id: 'standard',
      label: 'Alignment',
      description: 'Rank, file, diagonal or none.',
      answerKind: 'choice',
      semantics: 'geometry',
    },
  ],
  supportedLayouts: ['empty'],
  generate: generateAlignmentQuestion,
};

/* ------------------------------------------------------------------ *
 * Blockers: which square stops each ray?
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
    'A sliding piece is surrounded by traffic. Tap the first piece it meets along each of its directions - the squares that decide what it actually controls.',
  variants: [
    { id: 'rook', label: 'Rook', description: 'Four directions.', answerKind: 'square-set', semantics: 'geometry', pieceType: 'rook' },
    { id: 'bishop', label: 'Bishop', description: 'Four diagonals.', answerKind: 'square-set', semantics: 'geometry', pieceType: 'bishop' },
    { id: 'queen', label: 'Queen', description: 'All eight directions.', answerKind: 'square-set', semantics: 'geometry', pieceType: 'queen' },
  ],
  supportedLayouts: ['custom'],
  generate: generateBlockerQuestion,
};

/* ------------------------------------------------------------------ *
 * Sequence: follow a short walk and name the final square.
 * ------------------------------------------------------------------ */

const STEP_WORDS: Array<{ label: string; df: number; dr: number }> = [
  { label: 'up', df: 0, dr: 1 },
  { label: 'down', df: 0, dr: -1 },
  { label: 'left', df: -1, dr: 0 },
  { label: 'right', df: 1, dr: 0 },
  { label: 'up-right', df: 1, dr: 1 },
  { label: 'up-left', df: -1, dr: 1 },
  { label: 'down-right', df: 1, dr: -1 },
  { label: 'down-left', df: -1, dr: -1 },
];

/**
 * Builds the walk by stepping square by square, discarding any step that
 * would leave the board. The destination is therefore always valid, which is
 * what the "every generator returns a valid answer" test checks.
 */
export function generateSequenceQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const blindfold = variantId === 'blindfold';
  const stepCount = variantId === 'long' ? 4 : 3;

  let current = pickSquare(buildPool(context), rng, context.weights);
  const origin = current;
  const steps: string[] = [];

  for (let i = 0; i < stepCount; i += 1) {
    const options = rng.shuffle(STEP_WORDS);
    const usable = options.find((step) => {
      const { file, rank } = toCoordinates(current);
      return toSquareOrNull(file + step.df, rank + step.dr) !== null;
    });
    if (usable === undefined) break;
    const { file, rank } = toCoordinates(current);
    current = toSquareOrNull(file + usable.df, rank + usable.dr) as SquareName;
    steps.push(usable.label);
  }

  return makeQuestion({
    modeId: 'sequence',
    variantId,
    variantLabel: blindfold ? 'Blindfold walk' : 'Coordinate walk',
    prompt: {
      text: `Start on ${origin}, then go ${steps.join(', ')}. Where do you land?`,
      detail: blindfold ? 'No board - track it in your head' : 'One square per step',
      coordinate: origin,
    },
    board: buildBoard(context, {
      fen: placementFrom([]),
      highlights: blindfold ? [] : [origin],
      hidden: blindfold,
    }),
    expected: { kind: 'coordinate', square: current },
    semantics: 'geometry',
    focusSquares: focusOf(origin, current),
    primarySquare: current,
    seed,
  });
}

export const sequenceMode: ModeDefinition = {
  id: 'sequence',
  title: 'Coordinate walk',
  summary: 'Follow a short path and name where you land.',
  description:
    'You are given a starting square and a few steps. Track the walk and name the final square. The blindfold variant hides the board entirely.',
  variants: [
    { id: 'standard', label: 'Three steps', description: 'Board visible.', answerKind: 'coordinate', semantics: 'geometry' },
    { id: 'long', label: 'Four steps', description: 'A longer walk.', answerKind: 'coordinate', semantics: 'geometry' },
    { id: 'blindfold', label: 'Blindfold', description: 'No board at all.', answerKind: 'coordinate', semantics: 'geometry' },
  ],
  supportedLayouts: ['empty'],
  generate: generateSequenceQuestion,
};

/* ------------------------------------------------------------------ *
 * Feature group E: move a piece to a named legal destination.
 * ------------------------------------------------------------------ */

const MOVEMENT_PIECES: PieceType[] = ['knight', 'bishop', 'rook', 'queen', 'king'];

export function generateMovementQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const piece: PieceType = (MOVEMENT_PIECES.find((p) => p === variantId) ?? rng.pick(MOVEMENT_PIECES));
  const color: PieceColor = 'white';

  const origin = pickSquare(buildPool(context), rng, context.weights);
  const mover: PieceOnBoard = { square: origin, type: piece, color };

  // Kings are placed far away so chess.js accepts the position and the mover
  // is never pinned; the target then comes from chess.js itself.
  const kingSquares = ALL_SQUARES.filter((square) => {
    const df = Math.abs(square.charCodeAt(0) - origin.charCodeAt(0));
    const dr = Math.abs(Number(square[1]) - Number(origin[1]));
    return Math.max(df, dr) > 2;
  });
  const whiteKingSquare = piece === 'king' ? null : (kingSquares[0] as SquareName);
  const blackKingSquare = kingSquares.filter((square) => {
    if (whiteKingSquare === null) return true;
    const df = Math.abs(square.charCodeAt(0) - whiteKingSquare.charCodeAt(0));
    const dr = Math.abs(Number(square[1]) - Number(whiteKingSquare[1]));
    return Math.max(df, dr) > 2;
  })[0] as SquareName;

  const pieces: PieceOnBoard[] = [mover];
  if (whiteKingSquare !== null) pieces.push({ square: whiteKingSquare, type: 'king', color: 'white' });
  pieces.push({ square: blackKingSquare, type: 'king', color: 'black' });

  const fen = fenFromOccupancy(occupancyFromPieces(pieces), { turn: 'white' });
  let destinations: SquareName[] = [];
  try {
    destinations = legalDestinations(fen, origin);
  } catch {
    destinations = [];
  }
  const fallback = geometricTargets({ type: piece, color }, origin);
  const target = destinations.length > 0 ? rng.pick(destinations) : rng.pick(fallback);

  return makeQuestion({
    modeId: 'piece-movement',
    variantId: piece,
    variantLabel: `Move the ${PIECE_NAMES[piece]}`,
    prompt: {
      text: `Move the ${PIECE_NAMES[piece]} to ${target}`,
      detail: 'Drag it, or tap the piece then the square',
      coordinate: target,
    },
    board: buildBoard(context, {
      fen: placementFrom(pieces),
      highlights: [],
      showHints: context.showHints ?? false,
    }),
    expected: { kind: 'move', from: origin, to: target },
    semantics: 'legal',
    focusSquares: focusOf(origin, target),
    primarySquare: target,
    seed,
  });
}

export const pieceMovementMode: ModeDefinition = {
  id: 'piece-movement',
  title: 'Move the piece',
  summary: 'Drag or tap a piece to a named square.',
  description:
    'A piece and a target square are given. Move it there by dragging, or by tapping the piece and then the square. Illegal attempts snap back.',
  variants: MOVEMENT_PIECES.map((piece) => ({
    id: piece,
    label: `${PIECE_NAMES[piece][0].toUpperCase()}${PIECE_NAMES[piece].slice(1)}`,
    description: `Move a ${PIECE_NAMES[piece]} to the named square.`,
    answerKind: 'move' as const,
    semantics: 'legal' as const,
    pieceType: piece,
  })),
  supportedLayouts: ['custom'],
  generate: generateMovementQuestion,
};
