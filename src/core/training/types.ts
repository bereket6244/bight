/**
 * The shared vocabulary of every training mode.
 *
 * A mode contributes a generator that turns settings + randomness into a
 * `Question`. The session engine, scoring, persistence and UI all work against
 * `Question` alone, so adding a mode never requires touching them.
 */

import type { Rng } from '../rng';
import type {
  MoveSemantics,
  Orientation,
  PieceColor,
  PieceType,
  SquareColor,
  SquareName,
} from '../chess/types';

export type ModeId =
  | 'coordinate-to-square'
  | 'square-to-coordinate'
  | 'memory-square-to-coordinate'
  | 'memory-coordinate-to-square'
  | 'square-color'
  | 'knight-vision'
  | 'piece-vision'
  | 'piece-movement'
  | 'alignment'
  | 'blockers'
  | 'sequence';

/** How the user supplies an answer, which decides the answer control shown. */
export type AnswerKind =
  /** Tap exactly one square on the board. */
  | 'single-square'
  /** Tap every matching square, then submit. */
  | 'square-set'
  /** Name a square with the two-tap file/rank keypad (or voice). */
  | 'coordinate'
  /** Light or dark. */
  | 'square-color'
  /** Pick one of a small set of labelled choices. */
  | 'choice'
  /** Move a piece: select origin then destination (or drag). */
  | 'move'
  /** Tap squares in order to trace a route. */
  | 'square-path';

export interface SingleSquareAnswer {
  kind: 'single-square';
  square: SquareName;
}

export interface SquareSetAnswer {
  kind: 'square-set';
  squares: SquareName[];
}

export interface CoordinateAnswer {
  kind: 'coordinate';
  square: SquareName;
}

export interface SquareColorAnswer {
  kind: 'square-color';
  color: SquareColor;
}

export interface ChoiceAnswer {
  kind: 'choice';
  choices: string[];
  correct: string;
}

export interface MoveAnswer {
  kind: 'move';
  from: SquareName;
  to: SquareName;
  /** Alternative destinations that are equally acceptable, if any. */
  alternativeTargets?: SquareName[];
}

/**
 * An ordered route. Any path of knight moves from `from` to `to` counts, so
 * the answer is validated rather than compared: with `requireShortest` the
 * path must also match the BFS distance.
 */
export interface SquarePathAnswer {
  kind: 'square-path';
  from: SquareName;
  to: SquareName;
  requireShortest: boolean;
  /** BFS distance, stored so feedback can state the target length. */
  shortestLength: number;
  /** One valid example, shown in feedback. */
  exampleRoute: SquareName[];
}

export type ExpectedAnswer =
  | SingleSquareAnswer
  | SquareSetAnswer
  | CoordinateAnswer
  | SquareColorAnswer
  | ChoiceAnswer
  | MoveAnswer
  | SquarePathAnswer;

/** A user's submitted answer, in the same shape family as the expected one. */
export type SubmittedAnswer =
  | { kind: 'single-square'; square: SquareName | null }
  | { kind: 'square-set'; squares: SquareName[] }
  | { kind: 'coordinate'; square: SquareName | null }
  | { kind: 'square-color'; color: SquareColor | null }
  | { kind: 'choice'; choice: string | null }
  | { kind: 'move'; from: SquareName | null; to: SquareName | null }
  | { kind: 'square-path'; squares: SquareName[] };

/** Where the answer came from, so voice errors never count as chess errors. */
export type AnswerSource = 'touch' | 'keypad' | 'voice' | 'drag' | 'timeout';

export type PieceLayout = 'empty' | 'starting' | 'custom';

/** Whether coordinate labels are drawn around the board. */
export type LabelMode = 'always' | 'never' | 'briefly';

/** How the board is displayed while the question is answered. */
export interface BoardSpec {
  /** FEN placement field; the single serialisable source of piece positions. */
  fen: string;
  orientation: Orientation;
  labels: LabelMode;
  /** Squares highlighted as part of the prompt. */
  highlights: SquareName[];
  /**
   * Hide the board entirely for blindfold practice. The answer controls stay
   * available so the mode is still answerable.
   */
  hidden?: boolean;
  /**
   * Milliseconds the prompt highlight stays visible before being hidden.
   * Undefined means it stays visible for the whole question.
   */
  revealMs?: number;
  /** Pieces are decorative and must not swallow square taps. */
  decorativePieces?: boolean;
  /** Show legal/geometric destination markers as a hint. */
  showHints?: boolean;
}

export interface Prompt {
  /** Primary instruction, e.g. "Tap f6" or "What does the knight see?" */
  text: string;
  /** Optional short clarifier, e.g. "Geometry - ignore occupancy". */
  detail?: string;
  /** A coordinate shown as the prompt, when the mode shows one. */
  coordinate?: SquareName;
  /** Milliseconds the coordinate text stays visible; undefined = always. */
  coordinateRevealMs?: number;
  /** Text handed to speech synthesis when pronunciation is enabled. */
  speech?: string;
}

export interface Question {
  /** Stable within a session; used as a React key and in stored attempts. */
  id: string;
  modeId: ModeId;
  /** Machine-readable variant, recorded with every attempt. */
  variantId: string;
  /** Human-readable variant name for the UI and progress views. */
  variantLabel: string;
  prompt: Prompt;
  board: BoardSpec;
  expected: ExpectedAnswer;
  /** Which semantics the expected answer follows, shown to the user. */
  semantics: MoveSemantics | null;
  /**
   * Squares this question is "about", used for per-square mastery. For a
   * coordinate drill that is the prompted square; for knight vision it is the
   * origin plus every target.
   */
  focusSquares: SquareName[];
  /** The single square mastery is primarily attributed to. */
  primarySquare: SquareName | null;
  /** Seed that produced this question, for reproduction. */
  seed: number;
}

/** Result of grading one submitted answer. */
export interface Grade {
  correct: boolean;
  /** Squares the user should have selected but did not. */
  missed: SquareName[];
  /** Squares the user selected that were not part of the answer. */
  extra: SquareName[];
  /** Short explanation shown in feedback. */
  explanation: string;
}

export type OrientationPolicy = 'white' | 'black' | 'random' | 'alternating';

/** Filters restricting which squares questions are drawn from. */
export interface SquareFilters {
  /** Zero-based file indices; empty means all files. */
  files: number[];
  /** Zero-based rank indices; empty means all ranks. */
  ranks: number[];
  /** Quadrant keys; empty means all quadrants. */
  quadrants: string[];
  /** Restrict to the user's weakest squares. */
  weakSquaresOnly: boolean;
}

export function emptyFilters(): SquareFilters {
  return { files: [], ranks: [], quadrants: [], weakSquaresOnly: false };
}

/** Everything a generator needs beyond randomness. */
export interface GeneratorContext {
  filters: SquareFilters;
  orientation: Orientation;
  labels: LabelMode;
  layout: PieceLayout;
  /**
   * Per-square weights from the mastery model. Higher means "practise this
   * more". Absent squares default to 1.
   */
  weights?: ReadonlyMap<SquareName, number>;
  /** Milliseconds a flashed prompt stays visible, for memory variants. */
  revealMs?: number;
  /** Show destination hints. */
  showHints?: boolean;
}

export interface ModeVariant {
  id: string;
  label: string;
  description: string;
  answerKind: AnswerKind;
  semantics: MoveSemantics | null;
  /** Piece the variant trains, when it is piece-specific. */
  pieceType?: PieceType;
}

export interface ModeDefinition {
  id: ModeId;
  title: string;
  /** One-line description shown on the mode list. */
  summary: string;
  /** Longer explanation shown before the first session. */
  description: string;
  variants: ModeVariant[];
  /** Which board layouts make sense for this mode. */
  supportedLayouts: PieceLayout[];
  /** Generates one question. Must always return a well-formed question. */
  generate: (context: GeneratorContext, rng: Rng, variantId: string) => Question;
}

export interface PieceOnBoard {
  square: SquareName;
  type: PieceType;
  color: PieceColor;
}
