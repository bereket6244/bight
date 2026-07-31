/**
 * The session runner: the screen every mode is played on.
 *
 * It owns no chess knowledge and no answer logic. The question says what to
 * draw and which answer control to show; the engine decides whether an answer
 * completes the question. That is what lets eleven modes share one screen.
 *
 * Practice is continuous — there is no Next button, no Submit button and no
 * result screen between questions. A correct answer replaces the question
 * immediately; a wrong one flashes red and leaves the question alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type SquareMark } from '../components/Board';
import { ChoiceButtons, ColorChoice, CoordinateKeypad } from '../components/CoordinateKeypad';
import {
  clearRejection,
  exitSession,
  moveJourneyPiece,
  pause,
  questionSecondsLeft,
  resume,
  restartSession,
  selectSquare,
  sessionProgress,
  sessionSecondsLeft,
  startSession,
  submitAnswer,
  summarise,
  tick,
  type SessionState,
} from '../../core/session/engine';
import type { SessionSettings } from '../../core/session/settings';
import { describeLimit, describeTimer } from '../../core/session/settings';
import type { AnswerSource, Question, SubmittedAnswer } from '../../core/training/types';
import { journeyMoves } from '../../core/chess/fork';
import { fenPlacementFromOccupancy, occupancyFromFen } from '../../core/chess/position';
import type { SquareName } from '../../core/chess/types';
import { practiceWeights } from '../../core/progress/mastery';
import { findMode } from '../../core/training/registry';
import { APP_VERSION } from '../../core/version';
import { normalizeSquare } from '../../core/chess/square';
import { useVoiceSession } from '../../services/voice/useVoiceSession';
import { collectDiagnostics, devSeedOverride, isDevDiagnosticsEnabled } from '../../core/dev/diagnostics';
import { useApp } from '../state/AppContext';
import { SessionSummaryView } from './SessionSummary';
import { speak } from '../../services/speech';
import { vibrate } from '../../services/haptics';
import { playTone } from '../../services/sound';

/** How long a wrong input stays red. Long enough to notice, short enough to retry. */
const FLASH_MS = 420;

export interface SessionScreenProps {
  settings: SessionSettings;
  onExit: () => void;
}

export function SessionScreen({ settings, onExit }: SessionScreenProps) {
  const app = useApp();
  const [weights, setWeights] = useState<ReadonlyMap<SquareName, number> | undefined>(undefined);
  const [state, setState] = useState<SessionState | null>(null);
  const [flashToken, setFlashToken] = useState(0);
  const savedRef = useRef(false);

  // Adaptive weights load before the first question so the very first prompt
  // already favours weak squares.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!settings.adaptive) {
        if (!cancelled) setWeights(undefined);
        return;
      }
      try {
        const attempts = await app.repository.getAttempts({ limit: 3000 });
        if (!cancelled) setWeights(practiceWeights(attempts));
      } catch {
        if (!cancelled) setWeights(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.repository, settings.adaptive]);

  const deps = useMemo(() => ({ weights }), [weights]);

  useEffect(() => {
    if (settings.adaptive && weights === undefined) return;
    // A `?seed=` override makes a reported question reproducible exactly.
    const seed = devSeedOverride();
    setState((current) => current ?? startSession(settings, seed === null ? { weights } : { weights, seed }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, weights]);

  const question = state?.current ?? null;
  const rejected = state?.rejected ?? null;

  // Speak the prompt when the user has asked for it.
  useEffect(() => {
    if (question === null || !settings.speakPrompts) return;
    if (question.prompt.speech !== undefined) void speak(question.prompt.speech);
  }, [question, settings.speakPrompts]);

  // Timer pump. The engine decides whether anything actually changed.
  useEffect(() => {
    if (state === null || state.phase !== 'question') return;
    const timer = window.setInterval(() => {
      setState((current) => (current === null ? current : tick(current, deps)));
    }, 200);
    return () => window.clearInterval(timer);
  }, [state?.phase, deps, state]);

  // A rejection flashes red, then clears itself. Nothing blocks on it.
  useEffect(() => {
    if (rejected === null) return;
    setFlashToken(rejected.token);
    if (settings.haptics) vibrate('error');
    if (settings.sound) playTone('wrong');
    const timer = window.setTimeout(() => {
      setState((current) => (current === null ? current : clearRejection(current)));
    }, FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [rejected, settings.haptics, settings.sound]);

  const advanceToken = state?.advanceToken ?? 0;

  // A correct answer is acknowledged with a tick of sound/haptics only; the
  // question has already been replaced by the time this runs.
  useEffect(() => {
    if (advanceToken === 0) return;
    if (settings.haptics) vibrate('light');
    if (settings.sound) playTone('correct');
  }, [advanceToken, settings.haptics, settings.sound]);

  const answer = useCallback(
    (submitted: SubmittedAnswer, source: AnswerSource) => {
      setState((current) => (current === null ? current : submitAnswer(current, submitted, source, deps)));
    },
    [deps],
  );

  const tapSquare = useCallback(
    (square: SquareName) => {
      setState((current) => {
        if (current === null) return current;
        // Journey questions move a piece rather than selecting squares.
        if (current.current?.expected.kind === 'piece-journey') {
          return moveJourneyPiece(current, square, 'touch', deps);
        }
        return selectSquare(current, square, 'touch', deps);
      });
    },
    [deps],
  );

  /*
   * Voice input. The microphone opens only while a question is actually on
   * screen and the user asked for voice on a mode that supports it — never on
   * the summary, never while paused, and never at launch.
   */
  const modeSupportsVoice = findMode(settings.modeId)?.supportsVoice === true;
  const voiceWanted = settings.voiceInput && modeSupportsVoice;
  const voiceStatus = useVoiceSession({
    active: voiceWanted && state?.phase === 'question',
    question,
    onCoordinate: (square) => {
      const normalized = normalizeSquare(square);
      if (normalized !== null) answer({ kind: 'coordinate', square: normalized }, 'voice');
    },
    onColor: (color) => answer({ kind: 'square-color', color }, 'voice'),
  });

  // Persist once, when the session finishes.
  useEffect(() => {
    if (state === null || state.phase !== 'finished' || savedRef.current) return;
    savedRef.current = true;
    void persistSession(state).catch(() => undefined);

    async function persistSession(finished: SessionState): Promise<void> {
      const summary = summarise(finished);
      const sessionId = `s-${finished.startedAt}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await app.repository.addAttempts(sessionId, finished.attempts);
        await app.repository.addSession({
          id: sessionId,
          modeId: finished.settings.modeId,
          variantId: finished.settings.variantId,
          startedAt: finished.startedAt,
          endedAt: Date.now(),
          total: summary.total,
          correct: summary.correct,
          accuracy: summary.accuracy,
          averageMs: summary.averageMs,
          medianMs: summary.medianMs,
          fastestCorrectMs: summary.fastestCorrectMs,
          bestStreak: summary.bestStreak,
          durationMs: summary.durationMs,
          endedEarly: summary.endedEarly,
          settings: finished.settings,
          schemaVersion: 1,
          appVersion: APP_VERSION,
        });
        await app.updatePreferences({
          lastModeId: finished.settings.modeId,
          lastVariantId: finished.settings.variantId,
          savedSettings: {
            ...app.preferences.savedSettings,
            [finished.settings.modeId]: finished.settings,
          },
        });
        app.notifyDataChanged();
      } catch {
        // Storage failure must not lose the on-screen summary.
      }
    }
  }, [state, app]);

  if (state === null) {
    return <p className="empty-note">Preparing your session…</p>;
  }

  if (state.phase === 'finished') {
    return (
      <SessionSummaryView
        summary={summarise(state)}
        settings={state.settings}
        onRestart={() => {
          savedRef.current = false;
          setState(restartSession(state, deps));
        }}
        onExit={onExit}
      />
    );
  }

  const now = Date.now();
  const progress = sessionProgress(state, now);
  const perQuestion = questionSecondsLeft(state, now);
  const totalLeft = sessionSecondsLeft(state, now);
  const paused = state.phase === 'paused';

  const flashing = rejected !== null && rejected.token === flashToken;
  const flashSquares = flashing ? rejected.squares : [];

  // Correct selections stay green; a rejected square flashes red over the top.
  const marks = new Map<SquareName, SquareMark>();
  for (const square of question?.board.highlights ?? []) marks.set(square, 'prompt');
  if (question?.board.showHints === true && question.expected.kind === 'move') {
    marks.set(question.expected.to, 'hint');
  }
  for (const square of state.selected) marks.set(square, 'correct');
  for (const square of flashSquares) marks.set(square, 'wrong');

  const badges =
    question?.expected.kind === 'square-path'
      ? new Map(state.selected.map((square, index) => [square, index + 1] as const))
      : undefined;

  /*
   * Journey questions redraw the board with the piece where the user has moved
   * it to. The question's own FEN is the starting position and never changes,
   * so the live placement is derived from it plus the moves made so far.
   */
  const journeyPosition = (() => {
    if (question?.expected.kind !== 'piece-journey') return null;
    const expected = question.expected;
    const at = state.journey[state.journey.length - 1] ?? expected.from;
    const occupancy = occupancyFromFen(question.board.fen);
    occupancy.delete(expected.from);
    occupancy.set(at, { type: expected.piece, color: expected.color });
    return { fen: fenPlacementFromOccupancy(occupancy), at };
  })();

  if (journeyPosition !== null && question !== null && question.expected.kind === 'piece-journey') {
    // Show where it can go, so a legal-but-not-yet-forking move is obviously
    // available rather than looking like a mistake waiting to happen.
    const expected = question.expected;
    const occupancy = occupancyFromFen(journeyPosition.fen);
    for (const square of journeyMoves(
      { type: expected.piece, color: expected.color },
      journeyPosition.at,
      occupancy,
    )) {
      if (!marks.has(square)) marks.set(square, 'hint');
    }
    marks.set(journeyPosition.at, 'origin');
    for (const square of flashSquares) marks.set(square, 'wrong');
  }

  const remaining =
    question?.expected.kind === 'square-set'
      ? question.expected.squares.length - state.selected.length
      : null;

  return (
    <div data-testid="session-screen">
      <div className="session-bar">
        <div>
          <strong>{question?.variantLabel ?? 'Session'}</strong>
          <div className="session-bar__meta">
            {describeLimit(state.settings.limit)} · {describeTimer(state.settings.questionTimer)}
            {question?.semantics != null
              ? ` · ${question.semantics === 'geometry' ? 'Geometry' : 'Legal moves'}`
              : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {perQuestion !== null ? (
            <div
              className={`timer${perQuestion <= 3 ? ' timer--urgent' : ''}`}
              data-testid="question-timer"
            >
              {perQuestion.toFixed(1)}s
            </div>
          ) : totalLeft !== null ? (
            <div className="timer" data-testid="session-timer">
              {Math.ceil(totalLeft)}s
            </div>
          ) : null}
          <div className="session-bar__meta">
            {progress.total === null ? `${progress.done}` : `${progress.done} / ${progress.total}`}
            {state.streak >= 3 ? ` · ${state.streak} in a row` : ''}
          </div>
        </div>
      </div>

      <div className="progress" aria-hidden="true">
        <div
          className="progress__fill"
          style={{
            width:
              progress.total === null
                ? '100%'
                : `${Math.min(100, (progress.done / progress.total) * 100)}%`,
          }}
        />
      </div>

      {paused ? (
        <div className="card" style={{ marginTop: 'var(--gap)' }} data-testid="paused-card">
          <h2 className="card__title">Paused</h2>
          <p className="card__subtitle">The timer is stopped. Nothing is lost.</p>
          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setState(resume(state))}
            >
              Resume
            </button>
            <button type="button" className="button" onClick={() => setState(exitSession(state))}>
              End session
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="prompt">
            <p className="prompt__text">{question?.prompt.text}</p>
            {question?.prompt.coordinate !== undefined ? (
              <PromptCoordinate
                coordinate={question.prompt.coordinate}
                revealMs={question.prompt.coordinateRevealMs}
                questionId={question.id}
              />
            ) : null}
            {question?.prompt.detail !== undefined ? (
              <p className="prompt__detail">{question.prompt.detail}</p>
            ) : null}
            {remaining !== null ? (
              <p className="prompt__detail" data-testid="remaining-count">
                {remaining} left
              </p>
            ) : null}
            {voiceWanted ? (
              <p className="prompt__detail voice-line" data-testid="voice-line">
                {voiceStatus.listening ? (
                  <>
                    <span className="voice-dot" aria-hidden="true" /> Listening
                    {voiceStatus.heard !== null
                      ? ` — heard “${voiceStatus.heard}”${voiceStatus.unclear ? ', not clear enough' : ''}`
                      : ''}
                  </>
                ) : voiceStatus.error !== null ? (
                  `Voice unavailable: ${voiceStatus.error}. Use the keypad.`
                ) : (
                  'Starting the microphone…'
                )}
              </p>
            ) : null}
          </div>

          {question !== null ? (
            <Board
              key={question.id}
              fen={journeyPosition?.fen ?? question.board.fen}
              orientation={question.board.orientation}
              labels={question.board.labels}
              marks={marks}
              badges={badges}
              hidden={question.board.hidden ?? false}
              revealMs={question.board.revealMs}
              decorativePieces={question.board.decorativePieces ?? false}
              movableSquares={question.expected.kind === 'move' ? [question.expected.from] : []}
              onMove={
                question.expected.kind === 'move'
                  ? (from, to) => answer({ kind: 'move', from, to }, 'drag')
                  : undefined
              }
              onSquareTap={tapSquare}
            />
          ) : null}

          <AnswerControls
            question={question}
            flashing={flashing}
            onCoordinate={(square) => answer({ kind: 'coordinate', square }, 'keypad')}
            onColor={(color) => answer({ kind: 'square-color', color }, 'touch')}
            onChoice={(choice) => answer({ kind: 'choice', choice }, 'touch')}
          />

          {/* Development only: never present in the packaged APK, because it
              prints the expected answer. */}
          {isDevDiagnosticsEnabled() ? (
            <details className="card" data-testid="dev-diagnostics" style={{ marginTop: 'var(--gap)' }}>
              <summary className="card__title">Diagnostics</summary>
              <pre style={{ fontSize: '0.7rem', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(collectDiagnostics(state, app.engine), null, 2)}
              </pre>
            </details>
          ) : null}

          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            <button
              type="button"
              className="button"
              onClick={() => setState(pause(state))}
              data-testid="pause"
            >
              Pause
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => setState(exitSession(state))}
              data-testid="end-session"
            >
              End
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Shows a coordinate, optionally hiding it after a moment. */
function PromptCoordinate({
  coordinate,
  revealMs,
  questionId,
}: {
  coordinate: string;
  revealMs?: number;
  questionId: string;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (revealMs === undefined) {
      setVisible(true);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), revealMs);
    return () => window.clearTimeout(timer);
  }, [revealMs, questionId]);

  return (
    <p className="prompt__coordinate" data-testid="prompt-coordinate">
      {visible ? coordinate : '· ·'}
    </p>
  );
}

/**
 * The answer surface for the current question.
 *
 * Board-answered modes render nothing here: their answer is the board itself,
 * and there is no confirmation step to provide a button for.
 */
function AnswerControls({
  question,
  flashing,
  onCoordinate,
  onColor,
  onChoice,
}: {
  question: Question | null;
  flashing: boolean;
  onCoordinate: (square: SquareName) => void;
  onColor: (color: 'light' | 'dark') => void;
  onChoice: (choice: string) => void;
}) {
  if (question === null) return null;

  switch (question.expected.kind) {
    case 'coordinate':
      return <CoordinateKeypad onSubmit={onCoordinate} resetKey={question.id} flashWrong={flashing} />;
    case 'square-color':
      return <ColorChoice onChoose={onColor} flashWrong={flashing} />;
    case 'choice':
      return (
        <ChoiceButtons choices={question.expected.choices} onChoose={onChoice} flashWrong={flashing} />
      );
    case 'single-square':
    case 'square-set':
    case 'square-path':
    case 'move':
      return null;
  }
}
