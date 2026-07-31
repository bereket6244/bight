/**
 * Session settings and their validation.
 *
 * Defaults are chosen so a new user can tap a mode and start immediately:
 * whole board, white orientation, labels on, no timer, twenty questions.
 */

import type { BoardVisibility, ModeId, MoveHistoryVisibility, MovePacing } from '../training/types';
import { emptyFilters, type LabelMode, type OrientationPolicy, type PieceLayout, type SquareFilters } from '../training/types';

/** How a session ends. */
export type SessionLimit =
  /** A fixed number of questions. */
  | { kind: 'questions'; count: number }
  /** A total wall-clock budget for the whole session. */
  | { kind: 'total-time'; seconds: number }
  /** Runs until the user stops. */
  | { kind: 'endless' };

/** Per-question time pressure, independent of the session limit. */
export type QuestionTimer =
  | { kind: 'none' }
  | { kind: 'per-question'; seconds: number };

/** When the user finds out whether they were right. */
export type FeedbackMode = 'immediate' | 'end-of-session';

/**
 * How long the prompt stays on screen.
 *
 * This replaces the old "flash coordinate" and "flash square" modes, which
 * were separate cards for what is really one setting on the ordinary
 * coordinate exercises.
 */
export type PromptVisibility =
  /** Stays visible for the whole question. */
  | 'persistent'
  /** Shown briefly, then hidden. Duration comes from `revealMs`. */
  | 'flash';

/** What happens to a question the user gets wrong. */
export type RetryPolicy = 'none' | 'immediate' | 'later' | 'both';

export interface SessionSettings {
  modeId: ModeId;
  variantId: string;
  limit: SessionLimit;
  questionTimer: QuestionTimer;
  feedback: FeedbackMode;
  retry: RetryPolicy;
  orientation: OrientationPolicy;
  labels: LabelMode;
  layout: PieceLayout;
  filters: SquareFilters;
  /** Whether the prompt stays up or flashes briefly. */
  promptVisibility: PromptVisibility;
  /** Milliseconds a flashed prompt stays visible. Only used when flashing. */
  revealMs: number;
  /**
   * Hide the board entirely for visualization practice. Only offered by modes
   * where answering without a board is meaningful.
   */
  hideBoard: boolean;
  /**
   * How much extra material sits on the board in modes that support it.
   * Defaults to `standard`: minimal boards made fork exercises too easy.
   */
  density: 'minimal' | 'standard' | 'crowded';

  /* Blindfold. Ignored by every non-blindfold mode. */
  /** Named preset; `plies` overrides it when set. */
  blindfoldDifficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  /** Sequence length in **plies** (half-moves). The wording is deliberate. */
  blindfoldPlies: number;
  captureBias: 'ordinary' | 'capture-focused' | 'heavy-exchanges';
  boardVisibility: BoardVisibility;
  moveHistory: MoveHistoryVisibility;
  pacing: MovePacing;
  /** Read each move aloud through the system voice, where one exists. */
  speakMoves: boolean;
  /** Offer hints (replay, reveal). Their use is recorded and scored. */
  allowHints: boolean;
  /** Show legal/geometric destination markers. */
  showHints: boolean;
  /**
   * Accuracy first: per-question timers are suppressed until accuracy is
   * consistently high, so speed is never trained before correctness.
   */
  accuracyFirst: boolean;
  sound: boolean;
  haptics: boolean;
  /** Speak the prompted coordinate aloud where the mode supports it. */
  speakPrompts: boolean;
  /** Allow voice answers when the voice service is available. */
  voiceInput: boolean;
  /** Draw questions from the user's weakest squares. */
  adaptive: boolean;
}

export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 200;
export const MIN_SESSION_SECONDS = 30;
export const MAX_SESSION_SECONDS = 3600;
export const MIN_QUESTION_SECONDS = 2;
export const MAX_QUESTION_SECONDS = 120;
export const MIN_REVEAL_MS = 200;
export const MAX_REVEAL_MS = 5000;

/** Accuracy needed before "accuracy first" lets the per-question timer run. */
export const ACCURACY_FIRST_THRESHOLD = 0.9;
/** Minimum attempts before the accuracy-first gate can open. */
export const ACCURACY_FIRST_SAMPLE = 20;

export function defaultSettings(modeId: ModeId, variantId: string): SessionSettings {
  return {
    modeId,
    variantId,
    limit: { kind: 'questions', count: 20 },
    questionTimer: { kind: 'none' },
    feedback: 'immediate',
    retry: 'later',
    orientation: 'white',
    labels: 'always',
    layout: 'empty',
    filters: emptyFilters(),
    promptVisibility: 'persistent',
    revealMs: 1200,
    hideBoard: false,
    density: 'standard',
    blindfoldDifficulty: 'beginner',
    blindfoldPlies: 4,
    captureBias: 'ordinary',
    boardVisibility: 'start-only',
    moveHistory: 'visible',
    pacing: 'manual',
    speakMoves: false,
    allowHints: true,
    showHints: false,
    accuracyFirst: true,
    sound: true,
    haptics: true,
    speakPrompts: false,
    voiceInput: false,
    adaptive: true,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Repairs settings rather than rejecting them.
 *
 * Settings arrive from storage and from imported backups, where a stale or
 * corrupt value must never prevent a session from starting.
 */
export function validateSettings(settings: SessionSettings): SessionSettings {
  const limit: SessionLimit =
    settings.limit.kind === 'questions'
      ? { kind: 'questions', count: clamp(settings.limit.count, MIN_QUESTIONS, MAX_QUESTIONS) }
      : settings.limit.kind === 'total-time'
        ? {
            kind: 'total-time',
            seconds: clamp(settings.limit.seconds, MIN_SESSION_SECONDS, MAX_SESSION_SECONDS),
          }
        : { kind: 'endless' };

  const questionTimer: QuestionTimer =
    settings.questionTimer.kind === 'per-question'
      ? {
          kind: 'per-question',
          seconds: clamp(settings.questionTimer.seconds, MIN_QUESTION_SECONDS, MAX_QUESTION_SECONDS),
        }
      : { kind: 'none' };

  return {
    ...settings,
    limit,
    questionTimer,
    promptVisibility: settings.promptVisibility === 'flash' ? 'flash' : 'persistent',
    revealMs: clamp(settings.revealMs, MIN_REVEAL_MS, MAX_REVEAL_MS),
    hideBoard: Boolean(settings.hideBoard),
    density: (['minimal', 'standard', 'crowded'] as const).includes(settings.density)
      ? settings.density
      : 'standard',
    blindfoldDifficulty: (['beginner', 'intermediate', 'advanced', 'expert'] as const).includes(
      settings.blindfoldDifficulty,
    )
      ? settings.blindfoldDifficulty
      : 'beginner',
    // 2 to 40 half-moves. Below 2 there is nothing to track; above 40 the
    // sequence takes longer to present than anyone will sit through.
    blindfoldPlies: clamp(settings.blindfoldPlies ?? 4, 2, 40),
    captureBias: (['ordinary', 'capture-focused', 'heavy-exchanges'] as const).includes(
      settings.captureBias,
    )
      ? settings.captureBias
      : 'ordinary',
    boardVisibility: (
      [
        'always',
        'start-only',
        'each-ply',
        'each-move',
        'every-four',
        'checkpoint-flash',
        'never',
      ] as BoardVisibility[]
    ).includes(settings.boardVisibility)
      ? settings.boardVisibility
      : 'start-only',
    moveHistory: (['visible', 'latest-only', 'hidden'] as const).includes(settings.moveHistory)
      ? settings.moveHistory
      : 'visible',
    pacing: (['manual', 'slow', 'medium', 'fast'] as const).includes(settings.pacing)
      ? settings.pacing
      : 'manual',
    speakMoves: Boolean(settings.speakMoves),
    allowHints: settings.allowHints !== false,
    feedback: settings.feedback === 'end-of-session' ? 'end-of-session' : 'immediate',
    retry: (['none', 'immediate', 'later', 'both'] as RetryPolicy[]).includes(settings.retry)
      ? settings.retry
      : 'later',
    orientation: (['white', 'black', 'random', 'alternating'] as OrientationPolicy[]).includes(
      settings.orientation,
    )
      ? settings.orientation
      : 'white',
    labels: (['always', 'never', 'briefly'] as LabelMode[]).includes(settings.labels)
      ? settings.labels
      : 'always',
    layout: (['empty', 'starting', 'custom'] as PieceLayout[]).includes(settings.layout)
      ? settings.layout
      : 'empty',
    filters: validateFilters(settings.filters),
  };
}

export function validateFilters(filters: SquareFilters | undefined): SquareFilters {
  if (filters === undefined) return emptyFilters();
  const inRange = (value: number): boolean => Number.isInteger(value) && value >= 0 && value < 8;
  return {
    files: [...new Set((filters.files ?? []).filter(inRange))].sort((a, b) => a - b),
    ranks: [...new Set((filters.ranks ?? []).filter(inRange))].sort((a, b) => a - b),
    quadrants: [...new Set(filters.quadrants ?? [])],
    weakSquaresOnly: Boolean(filters.weakSquaresOnly),
  };
}

/**
 * Whether the per-question timer should run right now.
 * With accuracy-first enabled it stays off until accuracy is proven.
 */
export function questionTimerActive(
  settings: SessionSettings,
  stats: { attempts: number; accuracy: number },
): boolean {
  if (settings.questionTimer.kind === 'none') return false;
  if (!settings.accuracyFirst) return true;
  return stats.attempts >= ACCURACY_FIRST_SAMPLE && stats.accuracy >= ACCURACY_FIRST_THRESHOLD;
}

/** Short human summary of the limits, shown on the session screen. */
export function describeLimit(limit: SessionLimit): string {
  switch (limit.kind) {
    case 'questions':
      return `${limit.count} questions`;
    case 'total-time':
      return limit.seconds >= 60
        ? `${Math.round(limit.seconds / 60)} min session`
        : `${limit.seconds}s session`;
    case 'endless':
      return 'Endless';
  }
}

export function describeTimer(timer: QuestionTimer): string {
  return timer.kind === 'none' ? 'Untimed' : `${timer.seconds}s per question`;
}
