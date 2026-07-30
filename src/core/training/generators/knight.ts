/**
 * Feature group C: knight vision.
 *
 * Every variant derives its answer from `knightTargets` or chess.js, never
 * from a stored table. The geometry and legal variants are separate modes with
 * separate wording because they have genuinely different answers.
 */

import { geometricTargets, knightTargets } from '../../chess/geometry';
import { shortestKnightRoute, knightDistance } from '../../chess/knightRoute';
import { legalDestinations } from '../../chess/legal';
import { fenFromOccupancy, occupancyFromPieces } from '../../chess/position';
import { ALL_SQUARES } from '../../chess/square';
import type { PieceColor, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool, pickSquare, pickSquareAvoiding } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, PieceOnBoard, Question } from '../types';
import {
  buildBoard,
  ensureAnswerable,
  focusOf,
  placementFrom,
  makeQuestion,
  semanticsLabel,
} from './shared';

export const KNIGHT_VARIANTS: ModeVariant[] = [
  {
    id: 'attack-squares',
    label: 'Knight sight',
    description: 'A knight stands on a square. Tap every square it attacks.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'geometry-with-pieces',
    label: 'Sight through pieces',
    description:
      'Other pieces are on the board, but you still tap every square the knight attacks. Occupancy is ignored.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'legal-destinations',
    label: 'Legal destinations',
    description:
      'Tap only the squares the knight may legally move to in this position. Friendly pieces block, enemy pieces can be captured.',
    answerKind: 'square-set',
    semantics: 'legal',
    pieceType: 'knight',
  },
  {
    id: 'from-destination',
    label: 'After the move',
    description: 'A knight move is shown. Tap what the knight sees from where it lands.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'from-memory',
    label: 'No knight shown',
    description: 'Only a coordinate is given. Tap every square a knight there would attack.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'candidates',
    label: 'Which are attacked?',
    description: 'Some squares are marked. Tap only the marked squares the knight attacks.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'move-to-target',
    label: 'Play the move',
    description: 'Move the knight to the named square by dragging it or tapping piece then square.',
    answerKind: 'move',
    semantics: 'legal',
    pieceType: 'knight',
  },
  {
    id: 'shortest-route',
    label: 'Shortest route',
    description: 'Tap squares in order to take the knight to the target in the fewest moves.',
    answerKind: 'square-path',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'any-route',
    label: 'Any route',
    description: 'Tap squares in order to reach the target. Route length does not matter.',
    answerKind: 'square-path',
    semantics: 'geometry',
    pieceType: 'knight',
  },
];

function variantLabel(variantId: string): string {
  return KNIGHT_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Knight sight';
}

/**
 * Scatters blockers on squares the knight can reach, so occupancy actually
 * changes the answer. Without this the legal and geometry variants would look
 * identical and train nothing.
 */
function scatterBlockers(
  origin: SquareName,
  rng: Rng,
  knightColor: PieceColor,
): PieceOnBoard[] {
  const targets = knightTargets(origin);
  const count = rng.nextIntBetween(1, Math.min(3, targets.length));
  const chosen = rng.sample(targets, count);

  return chosen.map((square) => ({
    square,
    // Mixed colours: friendly pieces block, enemy pieces are capturable.
    color: rng.chance(0.5) ? knightColor : knightColor === 'white' ? 'black' : 'white',
    type: rng.pick(['pawn', 'bishop', 'rook'] as const),
  }));
}

/** Kings placed out of the way so chess.js will accept the position. */
function kingsAwayFrom(used: readonly SquareName[]): PieceOnBoard[] {
  const busy = new Set<SquareName>(used);
  const free = ALL_SQUARES.filter((square) => {
    if (busy.has(square)) return false;
    // Keep kings off squares adjacent to anything already placed.
    return [...busy].every((other) => {
      const df = Math.abs(other.charCodeAt(0) - square.charCodeAt(0));
      const dr = Math.abs(Number(other[1]) - Number(square[1]));
      return Math.max(df, dr) > 1;
    });
  });

  const whiteKing = free[0];
  const blackKing = free.reverse().find((square) => {
    const df = Math.abs(square.charCodeAt(0) - (whiteKing as string).charCodeAt(0));
    const dr = Math.abs(Number(square[1]) - Number((whiteKing as string)[1]));
    return Math.max(df, dr) > 1;
  });

  if (whiteKing === undefined || blackKing === undefined) return [];
  return [
    { square: whiteKing, type: 'king', color: 'white' },
    { square: blackKing, type: 'king', color: 'black' },
  ];
}

export function generateKnightQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const pool = buildPool(context);
  const knightColor: PieceColor = 'white';

  switch (variantId) {
    case 'from-memory': {
      const origin = pickSquare(pool, rng, context.weights);
      const answer = knightTargets(origin);
      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: `Tap every square a knight on ${origin} attacks`,
          detail: 'No knight is shown - answer from memory',
          coordinate: origin,
        },
        board: buildBoard(context, { fen: placementFrom([]), highlights: [] }),
        expected: { kind: 'square-set', squares: answer },
        semantics: 'geometry',
        focusSquares: focusOf(origin, answer),
        primarySquare: origin,
        seed,
      });
    }

    case 'from-destination': {
      const origin = pickSquare(pool, rng, context.weights);
      const landing = rng.pick(knightTargets(origin));
      const answer = knightTargets(landing);
      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: `The knight goes ${origin} to ${landing}. What does it see from ${landing}?`,
          detail: semanticsLabel('geometry'),
          coordinate: landing,
        },
        board: buildBoard(context, {
          fen: placementFrom([{ square: landing, type: 'knight', color: knightColor }]),
          highlights: [origin, landing],
        }),
        expected: { kind: 'square-set', squares: answer },
        semantics: 'geometry',
        focusSquares: focusOf(origin, landing, answer),
        primarySquare: landing,
        seed,
      });
    }

    case 'candidates': {
      const origin = pickSquare(pool, rng, context.weights);
      const attacked = knightTargets(origin);
      const notAttacked = ALL_SQUARES.filter(
        (square) => square !== origin && !attacked.includes(square),
      );
      const shown = rng.shuffle([
        ...rng.sample(attacked, rng.nextIntBetween(2, Math.min(4, attacked.length))),
        ...rng.sample(notAttacked, rng.nextIntBetween(2, 4)),
      ]);
      const answer = shown.filter((square) => attacked.includes(square)).sort();

      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: 'Tap only the marked squares the knight attacks',
          detail: semanticsLabel('geometry'),
        },
        board: buildBoard(context, {
          fen: placementFrom([{ square: origin, type: 'knight', color: knightColor }]),
          highlights: shown,
        }),
        expected: { kind: 'square-set', squares: answer },
        semantics: 'geometry',
        focusSquares: focusOf(origin, shown),
        primarySquare: origin,
        seed,
      });
    }

    case 'geometry-with-pieces': {
      const origin = pickSquare(pool, rng, context.weights);
      const blockers = scatterBlockers(origin, rng, knightColor);
      const answer = knightTargets(origin);

      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: 'Tap every square the knight attacks',
          detail: 'Ignore the other pieces - a knight jumps over everything',
        },
        board: buildBoard(context, {
          fen: placementFrom([
            { square: origin, type: 'knight', color: knightColor },
            ...blockers,
          ]),
          highlights: [origin],
        }),
        expected: { kind: 'square-set', squares: answer },
        semantics: 'geometry',
        focusSquares: focusOf(origin, answer),
        primarySquare: origin,
        seed,
      });
    }

    case 'legal-destinations': {
      const origin = pickSquare(pool, rng, context.weights);

      const targetsWith = (candidates: readonly PieceOnBoard[]): SquareName[] =>
        geometricTargets({ type: 'knight', color: knightColor }, origin, {
          occupancy: occupancyFromPieces([
            { square: origin, type: 'knight', color: knightColor },
            ...candidates,
          ]),
        });

      // A knight in a corner has only two targets; friendly pieces on both
      // would leave nothing to tap, so blockers are reduced until it can move.
      const blockers = ensureAnswerable(
        scatterBlockers(origin, rng, knightColor),
        (candidate) => targetsWith(candidate).length > 0,
      );
      const answer = targetsWith(blockers);

      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: 'Tap every square the knight can move to',
          detail: 'Your own pieces block; enemy pieces can be captured',
        },
        board: buildBoard(context, {
          fen: placementFrom([
            { square: origin, type: 'knight', color: knightColor },
            ...blockers,
          ]),
          highlights: [origin],
        }),
        expected: { kind: 'square-set', squares: answer },
        semantics: 'legal',
        focusSquares: focusOf(origin, answer),
        primarySquare: origin,
        seed,
      });
    }

    case 'move-to-target': {
      const origin = pickSquare(pool, rng, context.weights);
      const knight: PieceOnBoard = { square: origin, type: 'knight', color: knightColor };
      const kings = kingsAwayFrom([origin]);
      const pieces = [knight, ...kings];
      const fen = fenFromOccupancy(occupancyFromPieces(pieces), { turn: 'white' });

      // Ask chess.js for the destination so the target is provably legal.
      const destinations = legalDestinations(fen, origin);
      const target = destinations.length > 0 ? rng.pick(destinations) : rng.pick(knightTargets(origin));

      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: `Move the knight to ${target}`,
          detail: 'Drag it, or tap the knight then the square',
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

    case 'shortest-route':
    case 'any-route': {
      const requireShortest = variantId === 'shortest-route';
      const origin = pickSquare(pool, rng, context.weights);
      // Pick a target at a useful distance: too close is trivial.
      const candidates = ALL_SQUARES.filter((square) => {
        const distance = knightDistance(origin, square);
        return distance !== null && distance >= 2 && distance <= 4;
      });
      const target = pickSquareAvoiding(
        candidates.length > 0 ? candidates : ALL_SQUARES,
        [origin],
        rng,
      );
      const route = shortestKnightRoute(origin, target) as SquareName[];

      return makeQuestion({
        modeId: 'knight-vision',
        variantId,
        variantLabel: variantLabel(variantId),
        prompt: {
          text: requireShortest
            ? `Reach ${target} in the fewest moves`
            : `Reach ${target} - any route counts`,
          detail: requireShortest
            ? `${route.length - 1} moves is possible`
            : 'Tap the squares in order',
          coordinate: target,
        },
        board: buildBoard(context, {
          fen: placementFrom([{ square: origin, type: 'knight', color: knightColor }]),
          highlights: [target],
        }),
        expected: {
          kind: 'square-path',
          from: origin,
          to: target,
          requireShortest,
          shortestLength: route.length - 1,
          exampleRoute: route,
        },
        semantics: 'geometry',
        focusSquares: focusOf(origin, target, route),
        primarySquare: origin,
        seed,
      });
    }

    case 'attack-squares':
    default: {
      const origin = pickSquare(pool, rng, context.weights);
      const answer = knightTargets(origin);
      return makeQuestion({
        modeId: 'knight-vision',
        variantId: 'attack-squares',
        variantLabel: variantLabel('attack-squares'),
        prompt: {
          text: 'Tap every square the knight attacks',
          detail: semanticsLabel('geometry'),
        },
        board: buildBoard(context, {
          fen: placementFrom([{ square: origin, type: 'knight', color: knightColor }]),
          highlights: [origin],
        }),
        expected: { kind: 'square-set', squares: answer },
        semantics: 'geometry',
        focusSquares: focusOf(origin, answer),
        primarySquare: origin,
        seed,
      });
    }
  }
}

export const knightVisionMode: ModeDefinition = {
  id: 'knight-vision',
  title: 'Knight vision',
  summary: 'The hardest piece to see. Nine ways to drill it.',
  description:
    'Knight training from every angle: what it attacks, what it can legally reach, what it sees after a move, and how to route it across the board. Geometry variants ignore occupancy; legal variants do not, and each says which it means.',
  variants: KNIGHT_VARIANTS,
  supportedLayouts: ['empty', 'custom'],
  generate: generateKnightQuestion,
};
