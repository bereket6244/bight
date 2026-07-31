/**
 * Blindfold training.
 *
 * Three modes, each built on the same validated `MoveSequence`:
 *
 *   blindfold-tracking        follow a sequence, answer one targeted question
 *   blindfold-reconstruction  rebuild some or all of the resulting position
 *   blindfold-progressive     the same, with visual help removed in stages
 *
 * The sequence is generated and replayed by `core/chess/sequence.ts`, so SAN,
 * captures, piece identity and the final position are recorded facts. Nothing
 * here guesses at chess truth; it only decides what to ask about.
 *
 * Piece *identity* matters throughout. "Where is the knight that started on
 * g1" is a different question from "where is a white knight", and after a
 * promotion the two answers diverge — so questions target a tracked piece,
 * never a bare type.
 */

import {
  capturedPieces,
  describePiece,
  finalOccupancy,
  requireSequence,
  survivingPieces,
  type CaptureBias,
  type MoveSequence,
  type TrackedPiece,
} from '../../chess/sequence';
import { attackedSquares } from '../../chess/geometry';
import { occupancyFromFen } from '../../chess/position';
import { ALL_SQUARES } from '../../chess/square';
import type { PieceColor, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import type {
  BlindfoldPresentation,
  BoardVisibility,
  GeneratorContext,
  ModeDefinition,
  ModeVariant,
  Question,
  RequiredPlacement,
} from '../types';
import { buildBoard, focusOf, makeQuestion } from './shared';

/** Plies per difficulty preset. These are half-moves, never "moves". */
export const DIFFICULTY_PLIES: Record<string, number> = {
  beginner: 4,
  intermediate: 10,
  advanced: 18,
  expert: 24,
};

function placementOf(fen: string): string {
  return fen.split(' ')[0] as string;
}

/** Builds the presentation block from a sequence plus the chosen settings. */
function presentationFor(
  sequence: MoveSequence,
  context: GeneratorContext,
  visibility: BoardVisibility,
): BlindfoldPresentation {
  return {
    startFen: placementOf(sequence.startFen),
    san: sequence.san,
    uci: sequence.uci,
    fenAfterPly: sequence.plies.map((ply) => placementOf(ply.fen)),
    visibility,
    history: context.moveHistory ?? 'visible',
    pacing: context.pacing ?? 'manual',
    speakMoves: context.speakMoves ?? false,
    startTurn: sequence.startTurn,
  };
}

function pliesFor(context: GeneratorContext): number {
  if (context.plies !== undefined && context.plies > 0) return context.plies;
  return DIFFICULTY_PLIES[context.difficulty ?? 'beginner'] ?? 4;
}

function visibilityFor(context: GeneratorContext): BoardVisibility {
  return context.boardVisibility ?? 'start-only';
}

/** Sequence generation shared by all three modes. */
function buildSequence(context: GeneratorContext, rng: Rng): MoveSequence {
  const sequence = requireSequence(rng, {
    plies: pliesFor(context),
    captureBias: (context.captureBias as CaptureBias) ?? 'ordinary',
  });

  if (sequence === null) {
    // Loud rather than silently degrading to a canned position.
    throw new Error(
      `Could not generate a legal ${pliesFor(context)}-ply sequence for blindfold training.`,
    );
  }
  return sequence;
}

/* ------------------------------------------------------------------ *
 * Track a Position
 * ------------------------------------------------------------------ */

export const TRACKING_VARIANTS: ModeVariant[] = [
  {
    id: 'mixed',
    label: 'Mixed',
    description: 'A different kind of question each time.',
    answerKind: 'choice',
    semantics: null,
  },
  {
    id: 'piece-location',
    label: 'Where is it?',
    description: 'Name the square a particular piece ended on.',
    answerKind: 'coordinate',
    semantics: null,
  },
  {
    id: 'square-contents',
    label: 'What is here?',
    description: 'Say what stands on a named square.',
    answerKind: 'choice',
    semantics: null,
  },
  {
    id: 'captures',
    label: 'Captures',
    description: 'Track what was taken and by whom.',
    answerKind: 'choice',
    semantics: null,
  },
];

type TrackingKind =
  | 'piece-location'
  | 'square-contents'
  | 'occupancy'
  | 'side-to-move'
  | 'was-captured'
  | 'what-was-captured'
  | 'attacks';

function kindsForVariant(variantId: string, sequence: MoveSequence): TrackingKind[] {
  const hasCaptures = sequence.captureCount > 0;

  switch (variantId) {
    case 'piece-location':
      return ['piece-location'];
    case 'square-contents':
      return ['square-contents', 'occupancy'];
    case 'captures':
      return hasCaptures ? ['was-captured', 'what-was-captured'] : ['was-captured'];
    default: {
      const kinds: TrackingKind[] = [
        'piece-location',
        'square-contents',
        'occupancy',
        'attacks',
      ];
      // "Which side is to move" is trivial from a known ply count, so it only
      // appears occasionally rather than as an equal share of the mix.
      if (sequence.plies.length % 2 === 1) kinds.push('side-to-move');
      if (hasCaptures) kinds.push('was-captured', 'what-was-captured');
      return kinds;
    }
  }
}

const PIECE_LABEL: Record<PieceType, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

function contentsChoices(): string[] {
  return [
    'Empty',
    'White pawn',
    'White knight',
    'White bishop',
    'White rook',
    'White queen',
    'White king',
    'Black pawn',
    'Black knight',
    'Black bishop',
    'Black rook',
    'Black queen',
    'Black king',
  ];
}

function contentsLabel(piece: { type: PieceType; color: PieceColor } | undefined): string {
  if (piece === undefined) return 'Empty';
  const side = piece.color === 'white' ? 'White' : 'Black';
  return `${side} ${PIECE_LABEL[piece.type]}`;
}

export function generateTrackingQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const sequence = buildSequence(context, rng);
  const presentation = presentationFor(sequence, context, visibilityFor(context));
  const occupancy = finalOccupancy(sequence);
  const survivors = survivingPieces(sequence);
  const taken = capturedPieces(sequence);

  const kind = rng.pick(kindsForVariant(variantId, sequence));
  const label = TRACKING_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Mixed';

  const base = {
    modeId: 'blindfold-tracking' as const,
    variantId,
    variantLabel: label,
    semantics: null,
    seed,
    blindfold: presentation,
    positionFen: sequence.finalFen,
  };

  const board = buildBoard(context, {
    // The board starts from the opening position and is revealed on schedule;
    // the answer is about the *final* position, which is never drawn while the
    // question is live.
    fen: presentation.startFen,
    highlights: [],
  });

  switch (kind) {
    case 'piece-location': {
      // Only ask about a piece that is still on the board — "where is the
      // piece that was captured" has no answer.
      const movers = survivors.filter((piece) => piece.movedOnPlies.length > 0);
      const target = rng.pick(movers.length > 0 ? movers : survivors);
      return makeQuestion({
        ...base,
        prompt: {
          text: `Where is ${describePiece(target)}?`,
          detail: 'Name the square it ended on',
        },
        board,
        expected: { kind: 'coordinate', square: target.square as SquareName },
        focusSquares: focusOf(target.square as SquareName, target.origin),
        primarySquare: target.square as SquareName,
      });
    }

    case 'square-contents': {
      // Mix occupied and empty squares so the answer is not predictable.
      const occupied = [...occupancy.keys()];
      const empty = ALL_SQUARES.filter((square) => !occupancy.has(square));
      const square = rng.chance(0.6) ? rng.pick(occupied) : rng.pick(empty);
      const contents = occupancy.get(square);

      return makeQuestion({
        ...base,
        prompt: { text: `What is on ${square}?` },
        board,
        expected: {
          kind: 'choice',
          choices: contentsChoices(),
          correct: contentsLabel(contents),
        },
        focusSquares: focusOf(square),
        primarySquare: square,
      });
    }

    case 'occupancy': {
      // Deliberately balanced: half occupied, half empty.
      const occupied = [...occupancy.keys()];
      const empty = ALL_SQUARES.filter((square) => !occupancy.has(square));
      const wantOccupied = rng.chance(0.5);
      const square = wantOccupied ? rng.pick(occupied) : rng.pick(empty);

      return makeQuestion({
        ...base,
        prompt: { text: `Is there a piece on ${square}?` },
        board,
        expected: {
          kind: 'choice',
          choices: ['Yes', 'No'],
          correct: occupancy.has(square) ? 'Yes' : 'No',
        },
        focusSquares: focusOf(square),
        primarySquare: square,
      });
    }

    case 'side-to-move':
      return makeQuestion({
        ...base,
        prompt: { text: 'Whose move is it now?' },
        board,
        expected: {
          kind: 'choice',
          choices: ['White', 'Black'],
          correct: sequence.finalTurn === 'white' ? 'White' : 'Black',
        },
        focusSquares: [],
        primarySquare: null,
      });

    case 'was-captured': {
      // Balance captured against surviving so neither answer is a safe guess.
      const askAboutCaptured = taken.length > 0 && rng.chance(0.5);
      const target = askAboutCaptured ? rng.pick(taken) : rng.pick(survivors);

      return makeQuestion({
        ...base,
        prompt: {
          text: `Is ${describePiece(target)} still on the board?`,
        },
        board,
        expected: {
          kind: 'choice',
          choices: ['Still on the board', 'Captured'],
          correct: target.captured ? 'Captured' : 'Still on the board',
        },
        focusSquares: focusOf(target.origin),
        primarySquare: target.square ?? target.origin,
      });
    }

    case 'what-was-captured': {
      const capturingPlies = sequence.plies.filter((ply) => ply.captured !== null);
      const ply = rng.pick(capturingPlies);
      const victim = ply.captured!;

      // Choices drawn from what actually appears in this game, plus the truth.
      const others = new Set<string>([contentsLabel({ type: victim.type, color: victim.color })]);
      for (const other of sequence.pieces) {
        if (others.size >= 4) break;
        others.add(contentsLabel({ type: other.currentType, color: other.color }));
      }

      return makeQuestion({
        ...base,
        prompt: {
          text: `What did ${ply.san} capture?`,
          detail: `Move ${ply.moveNumber}, ${ply.color === 'white' ? 'White' : 'Black'}`,
        },
        board,
        expected: {
          kind: 'choice',
          choices: rng.shuffle([...others]),
          correct: contentsLabel({ type: victim.type, color: victim.color }),
        },
        focusSquares: focusOf(victim.square),
        primarySquare: victim.square,
      });
    }

    case 'attacks': {
      // Does a named surviving piece attack a named square, in the final
      // position? Occupancy comes from the real board, so blockers count.
      const attacker = rng.pick(survivors.filter((piece) => piece.currentType !== 'pawn'));
      const finalBoard = occupancyFromFen(sequence.finalFen);
      const attacked = attackedSquares(
        { type: attacker.currentType, color: attacker.color },
        attacker.square as SquareName,
        { occupancy: finalBoard },
      );

      // Half the time ask about a square it really does attack.
      const wantTrue = rng.chance(0.5) && attacked.length > 0;
      const square = wantTrue
        ? rng.pick(attacked)
        : rng.pick(ALL_SQUARES.filter((s) => !attacked.includes(s) && s !== attacker.square));

      return makeQuestion({
        ...base,
        prompt: {
          text: `Does ${describePiece(attacker)} attack ${square}?`,
          detail: 'In the position after the moves',
        },
        board,
        expected: {
          kind: 'choice',
          choices: ['Yes', 'No'],
          correct: attacked.includes(square) ? 'Yes' : 'No',
        },
        focusSquares: focusOf(attacker.square as SquareName, square),
        primarySquare: square,
      });
    }
  }
}

export const blindfoldTrackingMode: ModeDefinition = {
  id: 'blindfold-tracking',
  title: 'Track a Position',
  summary: 'Follow moves in your head, then answer.',
  description:
    'A legal sequence is played out. The board disappears, and you answer one question about the position it produced — where a piece ended, what stands on a square, what was captured, or whose move it is.',
  category: 'blindfold',
  variants: TRACKING_VARIANTS,
  rendersBoard: true,
  supportedLayouts: ['custom'],
  supportsBlindfold: true,
  supportsVoice: true,
  generate: generateTrackingQuestion,
};

/* ------------------------------------------------------------------ *
 * Reconstruct a Position
 * ------------------------------------------------------------------ */

export const RECONSTRUCTION_VARIANTS: ModeVariant[] = [
  {
    id: 'partial',
    label: 'Some pieces',
    description: 'Rebuild a named subset of the position.',
    answerKind: 'placement',
    semantics: null,
  },
  {
    id: 'full',
    label: 'Everything',
    description: 'Rebuild the entire resulting position. Advanced.',
    answerKind: 'placement',
    semantics: null,
  },
  {
    id: 'correction',
    label: 'Spot the errors',
    description: 'A nearly-right position is shown. Repair it.',
    answerKind: 'placement',
    semantics: null,
  },
];

interface Subset {
  label: string;
  pieces: TrackedPiece[];
}

/** Chooses which pieces a partial reconstruction asks for. */
function chooseSubset(sequence: MoveSequence, rng: Rng): Subset {
  const survivors = survivingPieces(sequence);

  const options: Subset[] = [
    {
      label: 'both knights',
      pieces: survivors.filter((p) => p.currentType === 'knight'),
    },
    {
      label: 'every queen and rook',
      pieces: survivors.filter((p) => p.currentType === 'queen' || p.currentType === 'rook'),
    },
    {
      label: 'every piece that moved',
      pieces: survivors.filter((p) => p.movedOnPlies.length > 0),
    },
    {
      label: 'all the White pieces',
      pieces: survivors.filter((p) => p.color === 'white'),
    },
    {
      label: 'all the Black pieces',
      pieces: survivors.filter((p) => p.color === 'black'),
    },
    {
      label: 'both kings',
      pieces: survivors.filter((p) => p.currentType === 'king'),
    },
  ];

  // Only offer subsets that are worth asking for and not overwhelming.
  const usable = options.filter((option) => option.pieces.length >= 2 && option.pieces.length <= 10);
  return usable.length > 0 ? rng.pick(usable) : { label: 'both kings', pieces: options[5]!.pieces };
}

function toPlacements(pieces: readonly TrackedPiece[]): RequiredPlacement[] {
  return pieces
    .filter((piece) => piece.square !== null)
    .map((piece) => ({
      square: piece.square as SquareName,
      type: piece.currentType,
      color: piece.color,
    }));
}

export function generateReconstructionQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const seed = rng.nextInt(0x7fffffff);
  const sequence = buildSequence(context, rng);
  const presentation = presentationFor(sequence, context, visibilityFor(context));
  const survivors = survivingPieces(sequence);
  const label = RECONSTRUCTION_VARIANTS.find((v) => v.id === variantId)?.label ?? 'Some pieces';

  const base = {
    modeId: 'blindfold-reconstruction' as const,
    variantId,
    variantLabel: label,
    semantics: null,
    seed,
    blindfold: presentation,
    positionFen: sequence.finalFen,
  };

  if (variantId === 'full') {
    const required = toPlacements(survivors);
    return makeQuestion({
      ...base,
      prompt: {
        text: 'Rebuild the whole position',
        detail: `${required.length} pieces remain`,
      },
      board: buildBoard(context, { fen: '8/8/8/8/8/8/8/8', highlights: [] }),
      expected: { kind: 'placement', required, exact: true, subsetLabel: 'every remaining piece' },
      focusSquares: required.map((p) => p.square),
      primarySquare: required[0]?.square ?? null,
    });
  }

  if (variantId === 'correction') {
    // Start from the true position, then introduce a small, known number of
    // errors. The answer key is derived from the truth, never invented.
    const truth = toPlacements(survivors);
    const errors = rng.nextIntBetween(1, 3);
    const shown = [...truth];

    for (let i = 0; i < errors && shown.length > 0; i += 1) {
      const index = rng.nextInt(shown.length);
      const victim = shown[index]!;
      const emptySquares = ALL_SQUARES.filter(
        (square) => !shown.some((placement) => placement.square === square),
      );

      if (rng.chance(0.5) || emptySquares.length === 0) {
        // Remove it entirely.
        shown.splice(index, 1);
      } else {
        // Move it somewhere it does not belong.
        shown[index] = { ...victim, square: rng.pick(emptySquares) };
      }
    }

    const shownFen = placementFromPlacements(shown);
    return makeQuestion({
      ...base,
      prompt: {
        text: 'Repair this position',
        detail: `${errors} thing${errors === 1 ? '' : 's'} ${errors === 1 ? 'is' : 'are'} wrong`,
      },
      board: buildBoard(context, { fen: shownFen, highlights: [] }),
      expected: {
        kind: 'placement',
        required: truth,
        exact: true,
        subsetLabel: 'the corrected position',
      },
      focusSquares: truth.map((p) => p.square),
      primarySquare: truth[0]?.square ?? null,
    });
  }

  // "partial"
  const subset = chooseSubset(sequence, rng);
  const required = toPlacements(subset.pieces);

  return makeQuestion({
    ...base,
    prompt: {
      text: `Place ${subset.label}`,
      detail: `${required.length} piece${required.length === 1 ? '' : 's'}`,
    },
    board: buildBoard(context, { fen: '8/8/8/8/8/8/8/8', highlights: [] }),
    expected: { kind: 'placement', required, exact: false, subsetLabel: subset.label },
    focusSquares: required.map((p) => p.square),
    primarySquare: required[0]?.square ?? null,
  });
}

/** Builds a FEN placement field from a list of placements. */
function placementFromPlacements(placements: readonly RequiredPlacement[]): string {
  const letters: Record<PieceType, string> = {
    pawn: 'p',
    knight: 'n',
    bishop: 'b',
    rook: 'r',
    queen: 'q',
    king: 'k',
  };
  const grid = new Map<SquareName, string>();
  for (const placement of placements) {
    const letter = letters[placement.type];
    grid.set(placement.square, placement.color === 'white' ? letter.toUpperCase() : letter);
  }

  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = '';
    let gap = 0;
    for (const file of 'abcdefgh') {
      const symbol = grid.get(`${file}${rank}` as SquareName);
      if (symbol === undefined) {
        gap += 1;
        continue;
      }
      if (gap > 0) {
        row += String(gap);
        gap = 0;
      }
      row += symbol;
    }
    if (gap > 0) row += String(gap);
    rows.push(row);
  }
  return rows.join('/');
}

export const blindfoldReconstructionMode: ModeDefinition = {
  id: 'blindfold-reconstruction',
  title: 'Reconstruct a Position',
  summary: 'Rebuild the position from memory.',
  description:
    'A sequence is played out, then the board empties. Place the pieces back where they belong. Correct placements stay put; wrong ones are rejected, and the question finishes itself the moment the position is right.',
  category: 'blindfold',
  variants: RECONSTRUCTION_VARIANTS,
  rendersBoard: true,
  supportedLayouts: ['custom'],
  supportsBlindfold: true,
  generate: generateReconstructionQuestion,
};

/* ------------------------------------------------------------------ *
 * Progressive Blindfold
 * ------------------------------------------------------------------ */

/**
 * The ladder, from most visual help to none.
 *
 * These are *not* mode variants. A stage differs from its neighbour only by
 * how often the board is redrawn, which is a setting, and the second pass
 * established that variants must not be a menu of settings. The stage is
 * chosen in setup (or climbed automatically) and rides in on
 * `context.boardVisibility`.
 */
export const PROGRESSIVE_STAGES: ReadonlyArray<{ label: string; visibility: BoardVisibility }> =
  Object.freeze([
    { label: 'Board after every move', visibility: 'each-ply' },
    { label: 'Board after each full move', visibility: 'each-move' },
    { label: 'Board every four plies', visibility: 'every-four' },
    { label: 'Board flashes at each checkpoint', visibility: 'checkpoint-flash' },
    { label: 'Board only at the start', visibility: 'start-only' },
    { label: 'No board at all', visibility: 'never' },
]);

/** Consecutive correct answers needed before the ladder offers the next stage. */
export const LADDER_PROMOTION_STREAK = 5;
/** Recent accuracy below which the ladder steps back down. */
export const LADDER_DEMOTION_ACCURACY = 0.5;

export function stageIndexFor(visibility: BoardVisibility | undefined): number {
  const index = PROGRESSIVE_STAGES.findIndex((stage) => stage.visibility === visibility);
  return index === -1 ? 0 : index;
}

/**
 * Where the ladder stands right now.
 *
 * Promotion needs a *run* of correct answers, never a single one, so one lucky
 * guess can never take the board away. Demotion needs a poor recent accuracy
 * rather than a single miss, so one slip does not undo a stage the user has
 * genuinely earned.
 */
export function ladderStage(context: GeneratorContext): number {
  const base = stageIndexFor(context.boardVisibility);
  const streak = context.streak ?? 0;
  const accuracy = context.recentAccuracy;

  if (accuracy !== undefined && accuracy < LADDER_DEMOTION_ACCURACY) {
    return Math.max(0, base - 1);
  }
  const earned = Math.floor(streak / LADDER_PROMOTION_STREAK);
  return Math.min(PROGRESSIVE_STAGES.length - 1, base + earned);
}

export const PROGRESSIVE_VARIANTS: ModeVariant[] = [
  {
    id: 'ladder',
    label: 'Guided ladder',
    description:
      'Starts at the stage you chose and removes more of the board as you keep answering correctly. Drops back a stage if accuracy falls.',
    answerKind: 'choice',
    semantics: null,
  },
  {
    id: 'fixed',
    label: 'Fixed stage',
    description: 'Stays on the stage you chose in setup, however well you do.',
    answerKind: 'choice',
    semantics: null,
  },
];

export function generateProgressiveQuestion(
  context: GeneratorContext,
  rng: Rng,
  variantId: string,
): Question {
  const index = variantId === 'fixed' ? stageIndexFor(context.boardVisibility) : ladderStage(context);
  const stage = PROGRESSIVE_STAGES[index]!;

  // A progressive question is a tracking question with the stage's reveal
  // schedule imposed on it, so the two never drift apart.
  const question = generateTrackingQuestion(
    { ...context, boardVisibility: stage.visibility },
    rng,
    'mixed',
  );

  return {
    ...question,
    modeId: 'blindfold-progressive',
    variantId,
    variantLabel: `Stage ${index + 1}: ${stage.label}`,
    blindfold:
      question.blindfold === undefined
        ? undefined
        : { ...question.blindfold, visibility: stage.visibility },
  };
}

export const blindfoldProgressiveMode: ModeDefinition = {
  id: 'blindfold-progressive',
  title: 'Progressive Blindfold',
  summary: 'Lose the board a stage at a time.',
  description:
    'The same tracking questions, with visual help removed in stages: from a board redrawn after every move, down to no board at all. Pick a stage yourself, or let it follow your accuracy.',
  category: 'blindfold',
  variants: PROGRESSIVE_VARIANTS,
  rendersBoard: true,
  supportedLayouts: ['custom'],
  supportsBlindfold: true,
  generate: generateProgressiveQuestion,
};
