/**
 * Helpers shared by every generator: board construction, ids and the standard
 * "what does this piece see" prompt wording.
 */

import { fenPlacementFromOccupancy, occupancyFromPieces, startingOccupancy } from '../../chess/position';
import { EMPTY_BOARD_FEN } from '../../chess/position';
import type { MoveSemantics, Orientation, PieceType, SquareName } from '../../chess/types';
import type { Rng } from '../../rng';
import type { BoardSpec, GeneratorContext, PieceOnBoard, Question } from '../types';

export const EMPTY_PLACEMENT = EMPTY_BOARD_FEN.split(' ')[0] as string;

/** Placement field for the layout a mode was configured with. */
export function layoutPlacement(
  layout: GeneratorContext['layout'],
  extraPieces: readonly PieceOnBoard[] = [],
): string {
  const occupancy =
    layout === 'starting' ? startingOccupancy() : occupancyFromPieces([]);
  for (const piece of extraPieces) {
    occupancy.set(piece.square, { type: piece.type, color: piece.color });
  }
  return fenPlacementFromOccupancy(occupancy);
}

/** Placement built only from the given pieces, ignoring the layout setting. */
export function placementFrom(pieces: readonly PieceOnBoard[]): string {
  return fenPlacementFromOccupancy(occupancyFromPieces([...pieces]));
}

export function buildBoard(
  context: GeneratorContext,
  overrides: Partial<BoardSpec> & { fen: string },
): BoardSpec {
  return {
    orientation: context.orientation,
    labels: context.labels,
    highlights: [],
    showHints: context.showHints ?? false,
    ...overrides,
  };
}

let questionCounter = 0;

/** Unique per question within a run; the seed carries reproducibility. */
export function makeQuestionId(modeId: string, seed: number): string {
  questionCounter += 1;
  return `${modeId}-${seed.toString(36)}-${questionCounter.toString(36)}`;
}

/** Reset between tests so ids are predictable. */
export function resetQuestionCounter(): void {
  questionCounter = 0;
}

export const PIECE_NAMES: Record<PieceType, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

/**
 * The wording that keeps geometry and legality distinct for the user.
 * Every mode that can mean either must show one of these.
 */
export function semanticsLabel(semantics: MoveSemantics): string {
  return semantics === 'geometry'
    ? 'Geometry - ignore occupancy and check'
    : 'Legal moves - this position, this side to move';
}

export function resolveOrientation(policy: Orientation, rng: Rng): Orientation {
  void rng;
  return policy;
}

/** Every square touched by a question, deduplicated and stable. */
export function focusOf(...groups: Array<readonly SquareName[] | SquareName | null>): SquareName[] {
  const out = new Set<SquareName>();
  for (const group of groups) {
    if (group === null) continue;
    if (typeof group === 'string') out.add(group);
    else for (const square of group) out.add(square);
  }
  return [...out];
}

/**
 * Drops scattered blockers until the question has an answer again.
 *
 * Random blockers can wall a piece in completely - a bishop in a corner with a
 * friendly pawn on the only diagonal square has no legal move, which would
 * produce an unanswerable question. Removing blockers one at a time always
 * terminates, because the empty-board case always has targets.
 */
export function ensureAnswerable(
  blockers: readonly PieceOnBoard[],
  hasAnswer: (blockers: readonly PieceOnBoard[]) => boolean,
): PieceOnBoard[] {
  let current = [...blockers];
  while (current.length > 0 && !hasAnswer(current)) {
    current = current.slice(0, -1);
  }
  return current;
}

/** Shared skeleton so every generator returns a fully-populated Question. */
export function makeQuestion(parts: Omit<Question, 'id'> & { id?: string }): Question {
  return {
    id: parts.id ?? makeQuestionId(parts.modeId, parts.seed),
    ...parts,
  };
}
