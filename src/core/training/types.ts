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

/**
 * Modes currently offered.
 *
 * Removed modes (`memory-*`, `piece-movement`, `sequence`) are deliberately
 * absent. Their ids live on in `legacy.ts` so stored history stays readable.
 */
export type ModeId =
  | 'coordinate-to-square'
  | 'square-to-coordinate'
  | 'square-color'
  | 'knight-vision'
  | 'knight-route'
  | 'knight-fork'
  | 'queen-fork'
  | 'notation'
  | 'piece-vision'
  | 'blockers'
  | 'alignment'
  | 'blindfold-tracking'
  | 'blindfold-reconstruction'
  | 'blindfold-progressive'
  | 'blindfold-engine-game';

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
  | 'square-path'
  /** Move one piece repeatedly until it reaches a goal square. */
  | 'piece-journey'
  /** Place pieces from a palette to rebuild a position. */
  | 'placement';

export interface SingleSquareAnswer {
  kind: 'single-square';
  square: SquareName;
  /**
   * Other squares that are equally correct.
   *
   * Fork problems routinely have more than one solution, and accepting only
   * the one the generator happened to list first would mark correct answers
   * wrong. `square` is simply the one shown in a review.
   */
  alternatives?: SquareName[];
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

/**
 * Move a piece, possibly several times, until it attacks every target.
 *
 * Unlike `MoveAnswer` this has no single correct destination: any reachable
 * square that forks the targets ends the question, and getting there may take
 * more than one move. Intermediate moves are not mistakes.
 */
export interface PieceJourneyAnswer {
  kind: 'piece-journey';
  piece: PieceType;
  color: PieceColor;
  /** Where the piece starts. */
  from: SquareName;
  /** The pieces that must all be attacked at once. */
  targets: SquareName[];
  /** Fewest moves that reach a forking square, proven by breadth-first search. */
  minMoves: number;
  /** One shortest route, shown in a review. */
  exampleRoute: SquareName[];
  /** Full FEN, so grading can re-derive occupancy. */
  fen: string;
}

/** One piece on one square, as required by a reconstruction. */
export interface RequiredPlacement {
  square: SquareName;
  type: PieceType;
  color: PieceColor;
}

/**
 * Rebuild part or all of a position from memory.
 *
 * The answer is a *set* of placements. Each correct placement stays on the
 * board; a wrong one is rejected. The question completes itself the moment
 * every required placement is present, so there is no Submit step.
 */
export interface PlacementAnswer {
  kind: 'placement';
  /** Exactly what must end up on the board. */
  required: RequiredPlacement[];
  /**
   * Whether pieces outside `required` are tolerated. Partial reconstruction
   * asks only for a subset and ignores the rest; full reconstruction does not.
   */
  exact: boolean;
  /** Short statement of the subset being asked for, shown in the prompt. */
  subsetLabel: string;
}

export type ExpectedAnswer =
  | SingleSquareAnswer
  | PieceJourneyAnswer
  | PlacementAnswer
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
  | { kind: 'square-path'; squares: SquareName[] }
  /** The squares the piece was moved through, in order, excluding its origin. */
  | { kind: 'piece-journey'; path: SquareName[] }
  /** Pieces the user has placed so far. */
  | { kind: 'placement'; placed: RequiredPlacement[] };

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
  /**
   * Full FEN of the position, when the question is about a real position
   * rather than a bare board. Notation and legal-move questions need the side
   * to move and castling rights, which a placement string alone cannot carry.
   */
  positionFen?: string;
  /**
   * How a blindfold question presents its move sequence before asking.
   * Absent for every non-blindfold mode.
   */
  blindfold?: BlindfoldPresentation;
}

/** How much of the board a blindfold question shows, and when. */
export type BoardVisibility =
  /** The board is drawn throughout. */
  | 'always'
  /** Shown at the start, hidden once the moves begin. */
  | 'start-only'
  /** Redrawn after every ply. */
  | 'each-ply'
  /** Redrawn after each full move (two plies). */
  | 'each-move'
  /** Redrawn every fourth ply. */
  | 'every-four'
  /** Flashed briefly at each checkpoint, then hidden again. */
  | 'checkpoint-flash'
  /** Never drawn. */
  | 'never';

/** Whether the move list stays on screen while the user answers. */
export type MoveHistoryVisibility = 'visible' | 'latest-only' | 'hidden';

/** How quickly moves are revealed. */
export type MovePacing = 'manual' | 'slow' | 'medium' | 'fast';

/**
 * Everything the session screen needs to play a sequence out to the user.
 *
 * The answer truth lives in `expected`; this is purely presentation, which is
 * why it can be stored alongside without risking the two disagreeing.
 */
export interface BlindfoldPresentation {
  /** Placement string of the position the sequence starts from. */
  startFen: string;
  /** SAN of each ply, in order. */
  san: string[];
  /** UCI of each ply, for reproduction and diagnostics. */
  uci: string[];
  /** Placement string after each ply, for the reveal schedule. */
  fenAfterPly: string[];
  visibility: BoardVisibility;
  history: MoveHistoryVisibility;
  pacing: MovePacing;
  /**
   * Which kind of blindfold question this is — `piece-location`, `occupancy`,
   * `full-reconstruction` and so on.
   *
   * The mixed variant asks seven different things, so the variant id alone
   * cannot tell progress which skill an attempt exercised. Kept as a plain
   * string because progress only ever groups by it.
   */
  kind: string;
  /** True once the sequence has been shown and the question is live. */
  speakMoves: boolean;
  /** Which side moved first, so move numbering reads correctly. */
  startTurn: PieceColor;
}

/** Result of grading one submitted answer. */
export interface Grade {
  correct: boolean;
  /**
   * For journey answers: whether the goal was reached in the fewest moves.
   * Undefined when the notion does not apply. Solving inefficiently is
   * recorded as suboptimal, never as a wrong chess answer.
   */
  optimal?: boolean;
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
   * Per-square weights from the mastery model. Higher means "practice this
   * more". Absent squares default to 1.
   */
  weights?: ReadonlyMap<SquareName, number>;
  /**
   * Milliseconds a flashed prompt stays visible. Undefined means the prompt
   * stays up for the whole question.
   */
  revealMs?: number;
  /** Hide the board for visualization practice. */
  hideBoard?: boolean;
  /** How much extra material sits on the board, where a mode supports it. */
  density?: 'minimal' | 'standard' | 'crowded';
  /** Show destination hints. */
  showHints?: boolean;

  /* Blindfold settings. Ignored by every other mode. */
  /** Named difficulty preset, used when `plies` is not set explicitly. */
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  /** Sequence length in **plies** (half-moves), never full moves. */
  plies?: number;
  captureBias?: 'ordinary' | 'capture-focused' | 'heavy-exchanges';
  boardVisibility?: BoardVisibility;
  moveHistory?: MoveHistoryVisibility;
  pacing?: MovePacing;
  speakMoves?: boolean;
  /**
   * Consecutive correct answers so far this session, and accuracy over the
   * recent attempts.
   *
   * Only the progressive blindfold ladder reads these, to decide whether the
   * user has earned the next stage. They are deliberately coarse: the ladder
   * must never climb on one lucky answer, so it needs a run, not a result.
   */
  streak?: number;
  recentAccuracy?: number;
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

/**
 * Groups the mode browser is organised around.
 *
 * Cards are grouped by what the user wants to practice, not by which generator
 * happens to produce them.
 */
export type ModeCategory =
  | 'coordinates'
  | 'square-color'
  | 'knight'
  | 'forks'
  | 'notation'
  | 'position'
  | 'blindfold';

export const MODE_CATEGORY_LABELS: Record<ModeCategory, string> = {
  coordinates: 'Coordinates',
  'square-color': 'Square color',
  knight: 'Knight vision',
  forks: 'Forks',
  notation: 'Notation and piece selection',
  position: 'Position vision',
  blindfold: 'Blindfold',
};

export interface ModeDefinition {
  id: ModeId;
  title: string;
  /** One-line description shown on the mode list. Keep it to one line. */
  summary: string;
  /** Longer explanation, shown only in the optional info sheet. */
  description: string;
  category: ModeCategory;
  variants: ModeVariant[];
  /** Which board layouts make sense for this mode. */
  supportedLayouts: PieceLayout[];
  /** Whether a hidden-board (visualization) option is meaningful here. */
  supportsHideBoard?: boolean;
  /** Whether the prompt-visibility (persistent/flash) setting applies. */
  supportsPromptVisibility?: boolean;
  /** Whether spoken answers make sense for this mode's answer kind. */
  supportsVoice?: boolean;
  /** Whether the board-density control applies to this mode. */
  supportsDensity?: boolean;
  /** Whether the blindfold controls (plies, pacing, visibility) apply. */
  supportsBlindfold?: boolean;
  /**
   * This mode is a game against the engine, not a stream of questions.
   *
   * It has its own screen and its own settings, so the session machinery every
   * other mode depends on never sees engine failures at all. The flag is what
   * the app routes on.
   */
  isEngineGame?: boolean;
  /**
   * Whether this mode ever draws a board.
   *
   * Square colour and alignment answer from coordinates alone, so orientation
   * and coordinate-label controls are meaningless for them — showing those
   * settings implies they do something.
   */
  rendersBoard?: boolean;
  /** Generates one question. Must always return a well-formed question. */
  generate: (context: GeneratorContext, rng: Rng, variantId: string) => Question;
}

export interface PieceOnBoard {
  square: SquareName;
  type: PieceType;
  color: PieceColor;
}
