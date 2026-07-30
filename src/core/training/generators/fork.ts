/**
 * Fork training: put one piece where it attacks two targets at once.
 *
 * This is the highest-value addition of the second pass. Seeing that a single
 * square hits two things is a real, repeatable board-vision skill, unlike
 * collecting every square a rook sees on an empty board.
 *
 * Every problem is verified before it is presented: the solution set is
 * computed first, and a problem with no solution — or with so many solutions
 * that it is trivial — is discarded and regenerated. All valid squares are
 * accepted, never just one arbitrarily chosen answer.
 */

import { forkSquares, isUsefulForkProblem, legalForkMoves } from '../../chess/fork';
import { attackedSquares } from '../../chess/geometry';
import { fenFromOccupancy, occupancyFromPieces } from '../../chess/position';
import { ALL_SQUARES, kingDistance } from '../../chess/square';
import type { PieceColor, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, PieceOnBoard, Question } from '../types';
import { buildBoard, focusOf, makeQuestion, placementFrom } from './shared';

/** Enemy pieces used as fork targets, in rough order of how tempting they are. */
const TARGET_TYPES: PieceType[] = ['rook', 'queen', 'bishop', 'knight'];

export const FORK_VARIANTS: ModeVariant[] = [
  {
    id: 'place',
    label: 'Place the forker',
    description: 'Tap the square that attacks both targets.',
    answerKind: 'single-square',
    semantics: 'geometry',
  },
  {
    id: 'move',
    label: 'Play the fork',
    description: 'Move the piece to a square that forks both targets.',
    answerKind: 'move',
    semantics: 'legal',
  },
  {
    id: 'notation-only',
    label: 'Coordinates only',
    description: 'The targets are named, not shown. Find the forking square.',
    answerKind: 'single-square',
    semantics: 'geometry',
  },
];

interface ForkProblem {
  targets: SquareName[];
  solutions: SquareName[];
  pieces: PieceOnBoard[];
}

/**
 * Picks two enemy targets that admit a small, non-trivial solution set.
 *
 * Returns null when this attempt produced nothing useful; the caller retries.
 * Rejection sampling is used rather than a curated table so the exercise stays
 * generated and verified rather than hand-written.
 */
function buildProblem(
  piece: PieceType,
  color: PieceColor,
  rng: Rng,
  pool: readonly SquareName[],
  maxSolutions: number,
): ForkProblem | null {
  const enemy: PieceColor = color === 'white' ? 'black' : 'white';

  const first = rng.pick(pool);
  const second = rng.pick(ALL_SQUARES);
  if (first === second) return null;
  // Adjacent targets make a queen fork trivial and a knight fork impossible.
  if (kingDistance(first, second) < 2) return null;

  const targets: SquareName[] = [first, second];
  const solutions = forkSquares({ type: piece, color }, targets);
  if (!isUsefulForkProblem(solutions, maxSolutions)) return null;

  const pieces: PieceOnBoard[] = targets.map((square) => ({
    square,
    type: rng.pick(TARGET_TYPES),
    color: enemy,
  }));

  return { targets, solutions, pieces };
}

/**
 * The "move" variant needs a legal position: the forking piece must actually
 * be able to reach a forking square, with kings present so chess.js accepts it.
 */
function buildMoveProblem(
  piece: PieceType,
  color: PieceColor,
  rng: Rng,
  pool: readonly SquareName[],
  maxSolutions: number,
): (ForkProblem & { origin: SquareName; fen: string }) | null {
  const problem = buildProblem(piece, color, rng, pool, maxSolutions);
  if (problem === null) return null;

  // Stand the piece somewhere that is not itself already a solution, so the
  // question requires a move rather than being already solved.
  const candidateOrigins = ALL_SQUARES.filter(
    (square) =>
      !problem.solutions.includes(square) &&
      !problem.targets.includes(square) &&
      attackedSquares({ type: piece, color }, square).some((sq) => problem.solutions.includes(sq)),
  );
  if (candidateOrigins.length === 0) return null;

  const origin = rng.pick(candidateOrigins);

  // Kings far from the action so nothing is in check and no piece is pinned.
  const busy = new Set<SquareName>([origin, ...problem.targets]);
  const kingSquares = ALL_SQUARES.filter(
    (square) => !busy.has(square) && [...busy].every((other) => kingDistance(other, square) > 2),
  );
  if (kingSquares.length < 2) return null;

  const whiteKing = kingSquares[0] as SquareName;
  const blackKing = kingSquares.find((square) => kingDistance(square, whiteKing) > 2);
  if (blackKing === undefined) return null;

  const pieces: PieceOnBoard[] = [
    { square: origin, type: piece, color },
    ...problem.pieces,
    { square: whiteKing, type: 'king', color: 'white' },
    { square: blackKing, type: 'king', color: 'black' },
  ];

  const fen = fenFromOccupancy(occupancyFromPieces(pieces), { turn: color });
  const legal = legalForkMoves({ fen, from: origin, piece: { type: piece, color }, targets: problem.targets });
  if (legal.length === 0) return null;

  return { ...problem, solutions: legal, pieces, origin, fen };
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
  // A queen forks from far more squares than a knight, so its ceiling is
  // tighter or every problem would have a dozen answers.
  const maxSolutions = piece === 'knight' ? 4 : 3;
  const modeId = piece === 'knight' ? 'knight-fork' : 'queen-fork';
  const label = FORK_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Fork';

  if (variantId === 'move') {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const problem = buildMoveProblem(piece, color, rng, pool, maxSolutions);
      if (problem === null) continue;

      const [primary, ...alternatives] = problem.solutions;
      return makeQuestion({
        modeId,
        variantId,
        variantLabel: label,
        prompt: {
          text: `Move the ${piece} to fork ${problem.targets.join(' and ')}`,
          detail: 'Any square that attacks both counts',
        },
        board: buildBoard(context, {
          fen: placementFrom(problem.pieces),
          highlights: problem.targets,
        }),
        expected: {
          kind: 'move',
          from: problem.origin,
          to: primary as SquareName,
          alternativeTargets: alternatives,
        },
        semantics: 'legal',
        focusSquares: focusOf(problem.origin, problem.targets, problem.solutions),
        primarySquare: primary as SquareName,
        seed,
      });
    }
  }

  // "place" and "notation-only" both ask for a square; they differ only in
  // whether the targets are drawn on the board.
  const notationOnly = variantId === 'notation-only';

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const problem = buildProblem(piece, color, rng, pool, maxSolutions);
    if (problem === null) continue;

    const [primary, ...alternatives] = problem.solutions;
    return makeQuestion({
      modeId,
      variantId,
      variantLabel: label,
      prompt: {
        text: notationOnly
          ? `Where does a ${piece} attack both ${problem.targets.join(' and ')}?`
          : `Tap the square where a ${piece} forks ${problem.targets.join(' and ')}`,
        detail:
          problem.solutions.length > 1
            ? `${problem.solutions.length} squares work - any one counts`
            : undefined,
      },
      board: buildBoard(context, {
        // Notation-only hides the targets, so the user must locate them.
        fen: notationOnly ? placementFrom([]) : placementFrom(problem.pieces),
        highlights: notationOnly ? [] : problem.targets,
      }),
      expected: {
        kind: 'single-square',
        square: primary as SquareName,
        alternatives,
      },
      semantics: 'geometry',
      focusSquares: focusOf(problem.targets, problem.solutions),
      primarySquare: primary as SquareName,
      seed,
    });
  }

  // Fallback: a knight fork always exists for these targets, so a session can
  // never stall even if rejection sampling has an unlucky run.
  const targets: SquareName[] = piece === 'knight' ? ['c3', 'c7'] : ['a1', 'h8'];
  const solutions = forkSquares({ type: piece, color }, targets);
  const [primary, ...alternatives] = solutions;

  return makeQuestion({
    modeId,
    variantId,
    variantLabel: label,
    prompt: { text: `Tap the square where a ${piece} forks ${targets.join(' and ')}` },
    board: buildBoard(context, {
      fen: placementFrom(targets.map((square) => ({ square, type: 'rook' as PieceType, color: 'black' as PieceColor }))),
      highlights: targets,
    }),
    expected: { kind: 'single-square', square: primary as SquareName, alternatives },
    semantics: 'geometry',
    focusSquares: focusOf(targets, solutions),
    primarySquare: primary as SquareName,
    seed,
  });
}

export const knightForkMode: ModeDefinition = {
  id: 'knight-fork',
  title: 'Knight forks',
  summary: 'Find the square that attacks both targets.',
  description:
    'Two enemy pieces are named. Find a square from which a knight attacks both. Every valid square is accepted.',
  category: 'forks',
  variants: FORK_VARIANTS,
  supportedLayouts: ['custom'],
  supportsHideBoard: false,
  generate: (context, rng, variantId) => generateFork('knight', context, rng, variantId),
};

export const queenForkMode: ModeDefinition = {
  id: 'queen-fork',
  title: 'Queen forks',
  summary: 'One square, two targets, along her lines.',
  description:
    'The same idea as knight forks, on the queen’s lines. Blockers count: she cannot fork through a piece.',
  category: 'forks',
  variants: FORK_VARIANTS,
  supportedLayouts: ['custom'],
  supportsHideBoard: false,
  generate: (context, rng, variantId) => generateFork('queen', context, rng, variantId),
};
