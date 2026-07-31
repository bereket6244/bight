/**
 * Fork training: put one piece where it attacks two targets at once.
 *
 * ## Why this was rewritten
 *
 * The first implementation picked two random targets and then *hoped* the
 * solution count fell inside a small window. For a queen it almost never did —
 * two random squares are forked from far more than three squares — so every
 * attempt was rejected and a hard-coded emergency position (two black rooks on
 * a1 and h8) became the only thing the mode ever produced. Measured before the
 * fix: 200 out of 200 generated questions were that same fallback, on a board
 * holding exactly two pieces, and the "move" variant fell through into the
 * placement code path so it graded a move question as a square question.
 *
 * Generation is now **constructive**: pick the forking square first, then pick
 * targets from what it attacks. A solution therefore exists by construction and
 * the generator cannot fail its way into a canned position. There is no fixed
 * fallback; if generation genuinely cannot succeed it throws, and the mode's
 * error boundary isolates it rather than showing the user the same question
 * forever.
 */

import { forksFrom, forkSquares, planJourney } from '../../chess/fork';
import { attackedSquares } from '../../chess/geometry';
import { fenFromOccupancy, occupancyFromPieces } from '../../chess/position';
import { ALL_SQUARES, kingDistance } from '../../chess/square';
import type { Occupancy, PieceColor, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, PieceOnBoard, Question } from '../types';
import { buildBoard, focusOf, makeQuestion, placementFrom } from './shared';

/** Enemy pieces worth forking. Kings are excluded: forking a king is check. */
const TARGET_TYPES: readonly PieceType[] = ['rook', 'queen', 'bishop', 'knight'];

/** Filler material, weighted toward pawns so boards read like real games. */
const DECOY_TYPES: readonly PieceType[] = ['pawn', 'pawn', 'pawn', 'knight', 'bishop', 'rook'];

/**
 * How much material sits on a fork board.
 * Standard is the default: minimal boards made the exercise too easy.
 */
export type BoardDensity = 'minimal' | 'standard' | 'crowded';

const DENSITY_RANGE: Record<BoardDensity, { min: number; max: number }> = {
  minimal: { min: 0, max: 2 },
  standard: { min: 6, max: 12 },
  crowded: { min: 12, max: 17 },
};

export const FORK_VARIANTS: ModeVariant[] = [
  {
    id: 'find',
    label: 'Find the square',
    description: 'Tap a square from which the piece attacks both targets.',
    answerKind: 'single-square',
    semantics: 'geometry',
  },
  {
    id: 'play',
    label: 'Play the fork',
    description: 'Move the piece until it attacks both targets. It may take more than one move.',
    answerKind: 'piece-journey',
    semantics: 'geometry',
  },
];

interface ForkSetup {
  targets: SquareName[];
  solutions: SquareName[];
  pieces: PieceOnBoard[];
  occupancy: Occupancy;
}

function isEmpty(occupied: ReadonlySet<SquareName>, square: SquareName): boolean {
  return !occupied.has(square);
}

/** Kings placed well away from the action so nothing is in check. */
function placeKings(used: ReadonlySet<SquareName>, rng: Rng): PieceOnBoard[] | null {
  const free = ALL_SQUARES.filter(
    (square) => !used.has(square) && [...used].every((other) => kingDistance(other, square) > 2),
  );
  if (free.length < 2) return null;

  const whiteKing = rng.pick(free);
  const blackKing = rng.pick(free.filter((square) => kingDistance(square, whiteKing) > 2));
  if (blackKing === undefined) return null;

  return [
    { square: whiteKing, type: 'king', color: 'white' },
    { square: blackKing, type: 'king', color: 'black' },
  ];
}

/**
 * Builds a fork problem by choosing the answer first.
 *
 * 1. Pick a square for the forking piece.
 * 2. Pick two of the squares it attacks and put enemy pieces there.
 * 3. Scatter decoy material that must not sit on a target, on the forking
 *    square, or anywhere that would break the fork.
 * 4. Recompute the full solution set against the *final* occupancy — decoys
 *    can block a queen's line, so the answer is only known once every piece is
 *    placed.
 *
 * Returns null when this attempt did not produce a usable problem; the caller
 * retries with fresh randomness.
 */
function buildSetup(
  piece: PieceType,
  color: PieceColor,
  rng: Rng,
  pool: readonly SquareName[],
  density: BoardDensity,
  maxSolutions: number,
  needKings: boolean,
): ForkSetup | null {
  const enemy: PieceColor = color === 'white' ? 'black' : 'white';
  const forkSquare = rng.pick(pool);

  // What the piece would attack from there on an empty board.
  const reach = attackedSquares({ type: piece, color }, forkSquare);
  if (reach.length < 2) return null;

  // Two targets that are not adjacent to each other, so the problem is not
  // trivially "anything next to both".
  const first = rng.pick(reach);
  const candidates = reach.filter((square) => square !== first && kingDistance(square, first) >= 2);
  if (candidates.length === 0) return null;
  const second = rng.pick(candidates);

  const targets: SquareName[] = [first, second];
  const used = new Set<SquareName>([forkSquare, ...targets]);

  const pieces: PieceOnBoard[] = targets.map((square) => ({
    square,
    type: rng.pick(TARGET_TYPES),
    color: enemy,
  }));

  const kings = needKings ? placeKings(used, rng) : [];
  if (kings === null) return null;
  for (const king of kings) used.add(king.square);
  pieces.push(...kings);

  // Decoys. Anything that lands between the forking square and a target would
  // break the fork, so each candidate is tested against the live occupancy.
  const { min, max } = DENSITY_RANGE[density];
  const wanted = rng.nextIntBetween(min, max);
  let placed = 0;
  let guard = 0;

  while (placed < wanted && guard < 120) {
    guard += 1;
    const square = rng.pick(ALL_SQUARES);
    if (!isEmpty(used, square) || square === forkSquare) continue;

    const decoy: PieceOnBoard = {
      square,
      type: rng.pick(DECOY_TYPES),
      color: rng.chance(0.5) ? color : enemy,
    };

    // A pawn cannot legally stand on the first or last rank.
    if (decoy.type === 'pawn' && (square[1] === '1' || square[1] === '8')) continue;

    const trial = occupancyFromPieces([...pieces, decoy]);
    // The fork must survive this piece.
    if (!forksFrom({ type: piece, color }, forkSquare, targets, trial)) continue;

    pieces.push(decoy);
    used.add(square);
    placed += 1;
  }

  const occupancy = occupancyFromPieces(pieces);

  // The answer is whatever the final board says it is - never what was assumed
  // before the decoys went down.
  const solutions = forkSquares({ type: piece, color }, targets, { occupancy });
  if (!solutions.includes(forkSquare)) return null;
  if (solutions.length === 0 || solutions.length > maxSolutions) return null;

  return { targets, solutions, pieces, occupancy };
}

/** Tries repeatedly with fresh randomness. Throws rather than faking a board. */
function requireSetup(
  piece: PieceType,
  color: PieceColor,
  rng: Rng,
  pool: readonly SquareName[],
  density: BoardDensity,
  maxSolutions: number,
  needKings: boolean,
  attempts = 250,
): ForkSetup {
  for (let i = 0; i < attempts; i += 1) {
    const setup = buildSetup(piece, color, rng, pool, density, maxSolutions, needKings);
    if (setup !== null) return setup;
  }
  // Deliberately loud. A canned position shown to the user for a whole session
  // is a far worse outcome than an isolated mode reporting that it failed.
  throw new Error(
    `Could not generate a ${piece} fork problem after ${attempts} attempts. ` +
      `Density=${density}, pool=${pool.length}.`,
  );
}

function densityFrom(context: GeneratorContext): BoardDensity {
  return context.density ?? 'standard';
}

function generateFork(
  piece: PieceType,
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const color: PieceColor = 'white';
  const pool = buildPool(context);
  const density = densityFrom(context);
  const modeId = piece === 'knight' ? 'knight-fork' : 'queen-fork';

  // A queen forks from more squares than a knight even on a busy board.
  const maxSolutions = piece === 'knight' ? 4 : 6;
  const label = FORK_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Find the square';

  if (variantId === 'play') {
    return generatePlayVariant(piece, color, context, rng, pool, density, maxSolutions, modeId, label, seed);
  }

  const setup = requireSetup(piece, color, rng, pool, density, maxSolutions, false);
  const [primary, ...alternatives] = setup.solutions;

  return makeQuestion({
    modeId,
    variantId: 'find',
    variantLabel: label,
    prompt: {
      text: `Where does a ${piece} attack both ${setup.targets.join(' and ')}?`,
      detail:
        setup.solutions.length > 1
          ? `${setup.solutions.length} squares work — any one counts`
          : undefined,
    },
    board: buildBoard(context, {
      fen: placementFrom(setup.pieces),
      highlights: setup.targets,
    }),
    expected: {
      kind: 'single-square',
      square: primary as SquareName,
      alternatives,
    },
    semantics: 'geometry',
    focusSquares: focusOf(setup.targets, setup.solutions),
    primarySquare: primary as SquareName,
    seed,
  });
}

/**
 * "Play the fork": the piece is already on the board and must be manoeuvred.
 *
 * The piece starts somewhere that does *not* already fork the targets, and the
 * generator proves with BFS that a forking square is reachable, recording the
 * minimum number of moves. Positions with no reachable fork are discarded.
 */
function generatePlayVariant(
  piece: PieceType,
  color: PieceColor,
  context: GeneratorContext,
  rng: Rng,
  pool: readonly SquareName[],
  density: BoardDensity,
  maxSolutions: number,
  modeId: string,
  label: string,
  seed: number,
): Question {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const setup = buildSetup(piece, color, rng, pool, density, maxSolutions, true);
    if (setup === null) continue;

    // Stand the piece on an empty square that is not already a solution, so
    // the question genuinely requires a move.
    const origins = ALL_SQUARES.filter(
      (square) => !setup.occupancy.has(square) && !setup.solutions.includes(square),
    );
    if (origins.length === 0) continue;

    const origin = rng.pick(origins);
    const withPiece = occupancyFromPieces([
      ...setup.pieces,
      { square: origin, type: piece, color },
    ]);

    const plan = planJourney({ type: piece, color }, origin, setup.targets, withPiece);
    // No reachable fork, or it is already solved: discard.
    if (plan === null || plan.minMoves === 0) continue;

    const pieces: PieceOnBoard[] = [...setup.pieces, { square: origin, type: piece, color }];

    return makeQuestion({
      modeId: modeId as Question['modeId'],
      variantId: 'play',
      variantLabel: label,
      prompt: {
        text: `Move the ${piece} to attack both ${setup.targets.join(' and ')}`,
        detail:
          plan.minMoves === 1
            ? 'One move is enough'
            : `${plan.minMoves} moves is the shortest route`,
      },
      board: buildBoard(context, {
        fen: placementFrom(pieces),
        highlights: setup.targets,
      }),
      expected: {
        kind: 'piece-journey',
        piece,
        color,
        from: origin,
        targets: setup.targets,
        minMoves: plan.minMoves,
        exampleRoute: plan.route,
        fen: fenFromOccupancy(withPiece, { turn: color }),
      },
      semantics: 'geometry',
      focusSquares: focusOf(origin, setup.targets, plan.goals),
      primarySquare: origin,
      seed,
      positionFen: fenFromOccupancy(withPiece, { turn: color }),
    });
  }

  throw new Error(`Could not generate a reachable ${piece} fork journey.`);
}

export const knightForkMode: ModeDefinition = {
  id: 'knight-fork',
  title: 'Knight forks',
  summary: 'One square, two targets.',
  description:
    'Two enemy pieces are named. Find a square from which a knight attacks both, or move a knight there. Every valid square is accepted.',
  category: 'forks',
  variants: FORK_VARIANTS,
  rendersBoard: true,
  supportedLayouts: ['custom'],
  supportsHideBoard: false,
  supportsDensity: true,
  generate: (context, rng, variantId) => generateFork('knight', context, rng, variantId),
};

export const queenForkMode: ModeDefinition = {
  id: 'queen-fork',
  title: 'Queen forks',
  summary: 'One square, two targets, along her lines.',
  description:
    'The same idea on the queen’s lines, where blockers matter: she cannot fork through a piece. In "Play the fork" the queen slides to empty squares — she does not capture while manoeuvring.',
  category: 'forks',
  variants: FORK_VARIANTS,
  rendersBoard: true,
  supportedLayouts: ['custom'],
  supportsHideBoard: false,
  supportsDensity: true,
  generate: (context, rng, variantId) => generateFork('queen', context, rng, variantId),
};
