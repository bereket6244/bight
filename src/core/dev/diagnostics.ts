/**
 * Development-only diagnostics and deterministic reproduction.
 *
 * Everything here is gated behind `isDevDiagnosticsEnabled()`, which is false
 * in a production build. That matters because the diagnostics include the
 * expected answer: leaking it into normal practice would quietly turn the app
 * into a cheat sheet.
 *
 * Enable with `?debug=1` on the dev server, or by running a dev build.
 */

import { APP_VERSION } from '../version';
import { SCHEMA_VERSION } from '../storage/types';
import type { SessionState } from '../session/engine';
import { describeExpected } from '../training/grade';

/**
 * True only in a development build, or when `?debug=1` is present on a dev
 * server. Never true in the packaged APK.
 */
export function isDevDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

/**
 * A fixed seed supplied through the URL, for reproducing a reported question.
 *
 * Example: `?mode=queen-fork&variant=play&seed=12345`
 *
 * Honoured only in development, so a production build can never be pinned to
 * a predictable question sequence.
 */
export function devSeedOverride(): number | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (raw === null) return null;
    const seed = Number(raw);
    return Number.isFinite(seed) ? seed : null;
  } catch {
    return null;
  }
}

/** Mode/variant supplied through the URL, for jumping straight to a repro. */
export function devModeOverride(): { modeId: string; variantId: string | null } | null {
  if (!import.meta.env.DEV) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const modeId = params.get('mode');
    if (modeId === null) return null;
    return { modeId, variantId: params.get('variant') };
  } catch {
    return null;
  }
}

export interface SessionDiagnostics {
  appVersion: string;
  schemaVersion: number;
  storageEngine: string;
  modeId: string;
  variantId: string;
  questionId: string;
  seed: number;
  fen: string;
  expected: string;
  retryQueue: number;
  selected: string[];
  journey: string[];
  questionsCompleted: number;
  reproUrl: string;
  /** Present only on blindfold questions. */
  blindfold?: {
    kind: string;
    plies: number;
    visibility: string;
    history: string;
    san: string;
    hintsUsed: number;
    /** How many pieces are standing on a reconstruction board right now. */
    placed: number;
  };
}

/** Snapshot of everything needed to reproduce the current question. */
export function collectDiagnostics(
  state: SessionState,
  storageEngine: string,
): SessionDiagnostics | null {
  const question = state.current;
  if (question === null) return null;

  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    storageEngine,
    modeId: question.modeId,
    variantId: question.variantId,
    questionId: question.id,
    seed: question.seed,
    fen: question.positionFen ?? question.board.fen,
    expected: describeExpected(question.expected),
    retryQueue: state.retryQueue.length,
    selected: state.selected,
    journey: state.journey,
    questionsCompleted: state.questionsCompleted,
    reproUrl: `?mode=${question.modeId}&variant=${question.variantId}&seed=${question.seed}&debug=1`,
    blindfold:
      question.blindfold === undefined
        ? undefined
        : {
            kind: question.blindfold.kind,
            plies: question.blindfold.san.length,
            visibility: question.blindfold.visibility,
            history: question.blindfold.history,
            san: question.blindfold.san.join(' '),
            hintsUsed: state.hintsUsed,
            placed: state.placed.length,
          },
  };
}
