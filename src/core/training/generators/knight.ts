/**
 * Knight vision and knight routing.
 *
 * The first version exposed nine knight cards. Several were the same question
 * in different clothes ("which of these marked squares are attacked" is just
 * "tap what it attacks" with distractors), and the two routing variants were
 * a different skill sharing a card. This is now four vision variants plus a
 * separate routing mode with a "fewest moves" setting.
 *
 * The knight is the one piece whose attack set is genuinely not obvious from
 * looking at the board, which is why empty-board collection still earns its
 * place here when it did not for rooks and bishops.
 */

import { geometricTargets, knightTargets } from '../../chess/geometry';
import { knightDistance, shortestKnightRoute } from '../../chess/knightRoute';
import { occupancyFromPieces } from '../../chess/position';
import { ALL_SQUARES } from '../../chess/square';
import type { PieceColor, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import { buildPool, pickSquare, pickSquareAvoiding } from '../pool';
import type { GeneratorContext, ModeDefinition, ModeVariant, PieceOnBoard, Question } from '../types';
import { buildBoard, ensureAnswerable, focusOf, makeQuestion, placementFrom } from './shared';

export const KNIGHT_VARIANTS: ModeVariant[] = [
  {
    id: 'attack-squares',
    label: 'What it attacks',
    description: 'A knight stands on a square. Tap every square it attacks.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'legal-destinations',
    label: 'Where it can go',
    description: 'With pieces around it, tap only the squares it can move to.',
    answerKind: 'square-set',
    semantics: 'legal',
    pieceType: 'knight',
  },
  {
    id: 'from-destination',
    label: 'After the move',
    description: 'A move is shown. Tap what the knight sees from where it lands.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'from-memory',
    label: 'No knight shown',
    description: 'Only a coordinate is given. Tap what a knight there would attack.',
    answerKind: 'square-set',
    semantics: 'geometry',
    pieceType: 'knight',
  },
];

export const KNIGHT_ROUTE_VARIANTS: ModeVariant[] = [
  {
    id: 'shortest-route',
    label: 'Fewest moves',
    description: 'Reach the target square in as few knight moves as possible.',
    answerKind: 'square-path',
    semantics: 'geometry',
    pieceType: 'knight',
  },
  {
    id: 'any-route',
    label: 'Any route',
    description: 'Reach the target square. Length does not matter.',
    answerKind: 'square-path',
    semantics: 'geometry',
    pieceType: 'knight',
  },
];

function scatterBlockers(origin: SquareName, rng: Rng, knightColor: PieceColor): PieceOnBoard[] {
  const targets = knightTargets(origin);
  const count = rng.nextIntBetween(1, Math.min(3, targets.length));
  return rng.sample(targets, count).map((square) => ({
    square,
    color: rng.chance(0.5) ? knightColor : knightColor === 'white' ? 'black' : 'white',
    type: rng.pick(['pawn', 'bishop', 'rook'] as const),
  }));
}

export function generateKnightQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const pool = buildPool(context);
  const knightColor: PieceColor = 'white';
  const label = KNIGHT_VARIANTS.find((v) => v.id === variantId)?.label ?? 'What it attacks';

  if (variantId === 'from-memory') {
    const origin = pickSquare(pool, rng, context.weights);
    const answer = knightTargets(origin);
    return makeQuestion({
      modeId: 'knight-vision',
      variantId,
      variantLabel: label,
      prompt: {
        text: `A knight on ${origin}`,
        detail: 'Tap every square it attacks',
        coordinate: origin,
        coordinateRevealMs: context.revealMs,
      },
      board: buildBoard(context, { fen: placementFrom([]), highlights: [] }),
      expected: { kind: 'square-set', squares: answer },
      semantics: 'geometry',
      focusSquares: focusOf(origin, answer),
      primarySquare: origin,
      seed,
    });
  }

  if (variantId === 'from-destination') {
    const origin = pickSquare(pool, rng, context.weights);
    const landing = rng.pick(knightTargets(origin));
    const answer = knightTargets(landing);
    return makeQuestion({
      modeId: 'knight-vision',
      variantId,
      variantLabel: label,
      prompt: {
        text: `${origin} to ${landing}`,
        detail: `Tap what it sees from ${landing}`,
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

  if (variantId === 'legal-destinations') {
    const origin = pickSquare(pool, rng, context.weights);

    const targetsWith = (candidates: readonly PieceOnBoard[]): SquareName[] =>
      geometricTargets({ type: 'knight', color: knightColor }, origin, {
        occupancy: occupancyFromPieces([
          { square: origin, type: 'knight', color: knightColor },
          ...candidates,
        ]),
      });

    const blockers = ensureAnswerable(
      scatterBlockers(origin, rng, knightColor),
      (candidate) => targetsWith(candidate).length > 0,
    );
    const answer = targetsWith(blockers);

    return makeQuestion({
      modeId: 'knight-vision',
      variantId,
      variantLabel: label,
      prompt: {
        text: 'Where can the knight go?',
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

  // "attack-squares"
  const origin = pickSquare(pool, rng, context.weights);
  const answer = knightTargets(origin);
  return makeQuestion({
    modeId: 'knight-vision',
    variantId: 'attack-squares',
    variantLabel: 'What it attacks',
    prompt: { text: 'Tap every square the knight attacks' },
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

export function generateKnightRouteQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const requireShortest = variantId !== 'any-route';
  const origin = pickSquare(buildPool(context), rng, context.weights);

  const candidates = ALL_SQUARES.filter((square) => {
    const distance = knightDistance(origin, square);
    return distance !== null && distance >= 2 && distance <= 4;
  });
  const target = pickSquareAvoiding(candidates.length > 0 ? candidates : ALL_SQUARES, [origin], rng);
  const route = shortestKnightRoute(origin, target) as SquareName[];

  return makeQuestion({
    modeId: 'knight-route',
    variantId: requireShortest ? 'shortest-route' : 'any-route',
    variantLabel: requireShortest ? 'Fewest moves' : 'Any route',
    prompt: {
      text: `Take the knight to ${target}`,
      detail: requireShortest ? `${route.length - 1} moves is possible` : 'Tap the squares in order',
      coordinate: target,
    },
    board: buildBoard(context, {
      fen: placementFrom([{ square: origin, type: 'knight', color: 'white' }]),
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

export const knightVisionMode: ModeDefinition = {
  id: 'knight-vision',
  title: 'Knight vision',
  summary: 'The hardest piece to see, four ways.',
  description:
    'What the knight attacks, where it can legally go, what it sees after landing, and the same question with no knight on the board.',
  category: 'knight',
  variants: KNIGHT_VARIANTS,
  supportedLayouts: ['empty', 'custom'],
  supportsPromptVisibility: true,
  generate: generateKnightQuestion,
};

export const knightRouteMode: ModeDefinition = {
  id: 'knight-route',
  title: 'Knight routes',
  summary: 'Walk a knight across the board.',
  description:
    'Tap squares in order to take the knight to the target. "Fewest moves" requires an optimal route; any valid route is accepted otherwise.',
  category: 'knight',
  variants: KNIGHT_ROUTE_VARIANTS,
  supportedLayouts: ['empty'],
  generate: generateKnightRouteQuestion,
};
