/**
 * The session runner: the screen every mode is played on.
 *
 * It owns no chess knowledge. The question says what to draw and what answer
 * control to show; the engine says what happens next. That is what lets eleven
 * modes share one screen without a switch on mode id anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, buildMarks, type SquareMark } from '../components/Board';
import { ChoiceButtons, ColorChoice, CoordinateKeypad } from '../components/CoordinateKeypad';
import {
  advance,
  exitSession,
  pause,
  questionSecondsLeft,
  resume,
  restartSession,
  retryCurrent,
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
import type { SquareName } from '../../core/chess/types';
import { practiceWeights } from '../../core/progress/mastery';
import { useApp } from '../state/AppContext';
import { SessionSummaryView } from './SessionSummary';
import { speak } from '../../services/speech';
import { vibrate } from '../../services/haptics';
import { playTone } from '../../services/sound';

export interface SessionScreenProps {
  settings: SessionSettings;
  onExit: () => void;
}

export function SessionScreen({ settings, onExit }: SessionScreenProps) {
  const app = useApp();
  const [weights, setWeights] = useState<ReadonlyMap<SquareName, number> | undefined>(undefined);
  const [state, setState] = useState<SessionState | null>(null);
  const [selected, setSelected] = useState<SquareName[]>([]);
  const [path, setPath] = useState<SquareName[]>([]);
  const savedRef = useRef(false);

  // Adaptive weights are loaded before the first question so the very first
  // prompt already favours weak squares.
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

  // Start once the weights question is settled either way.
  useEffect(() => {
    if (settings.adaptive && weights === undefined) return;
    setState((current) => current ?? startSession(settings, { weights }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, weights]);

  const question = state?.current ?? null;

  // Clear per-question answer state whenever the question changes.
  useEffect(() => {
    setSelected([]);
    setPath([]);
  }, [question?.id]);

  // Speak the prompt when the user has asked for it.
  useEffect(() => {
    if (question === null || !settings.speakPrompts) return;
    if (question.prompt.speech !== undefined) void speak(question.prompt.speech);
  }, [question, settings.speakPrompts]);

  // Timer pump. One interval for the whole session; the engine decides whether
  // anything actually changed.
  useEffect(() => {
    if (state === null || state.phase === 'finished' || state.phase === 'paused') return;
    const timer = window.setInterval(() => {
      setState((current) => (current === null ? current : tick(current, deps)));
    }, 200);
    return () => window.clearInterval(timer);
  }, [state?.phase, deps, state]);

  const feedbackFor = useCallback(
    (correct: boolean) => {
      if (settings.haptics) vibrate(correct ? 'light' : 'error');
      if (settings.sound) playTone(correct ? 'correct' : 'wrong');
    },
    [settings.haptics, settings.sound],
  );

  const submit = useCallback(
    (answer: SubmittedAnswer, source: AnswerSource) => {
      setState((current) => {
        if (current === null) return current;
        const next = submitAnswer(current, answer, source, deps);
        const grade = next.lastGrade;
        if (grade !== null && next !== current) feedbackFor(grade.correct);
        return next;
      });
    },
    [deps, feedbackFor],
  );

  const goNext = useCallback(() => {
    setState((current) => (current === null ? current : advance(current, deps)));
  }, [deps]);

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
          appVersion: '1.0.0',
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
  const showingFeedback = state.phase === 'feedback';
  const paused = state.phase === 'paused';
  const grade = state.lastGrade;

  const marks = new Map<SquareName, SquareMark>(
    buildMarks({
      prompt: question?.board.highlights ?? [],
      hints: question?.board.showHints === true ? hintSquares(question) : [],
      selected,
      correct: showingFeedback ? correctlySelected(question, selected) : [],
      wrong: showingFeedback ? (grade?.extra ?? []) : [],
      missed: showingFeedback ? (grade?.missed ?? []) : [],
    }),
  );

  const badges = new Map(path.map((square, index) => [square, index + 1] as const));

  return (
    <div data-testid="session-screen">
      <div className="session-bar">
        <div>
          <strong>{question?.variantLabel ?? 'Session'}</strong>
          <div className="session-bar__meta">
            {describeLimit(state.settings.limit)} · {describeTimer(state.settings.questionTimer)}
            {question?.semantics !== null && question?.semantics !== undefined
              ? ` · ${question.semantics === 'geometry' ? 'Geometry' : 'Legal moves'}`
              : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {perQuestion !== null ? (
            <div className={`timer${perQuestion <= 3 ? ' timer--urgent' : ''}`} data-testid="question-timer">
              {perQuestion.toFixed(1)}s
            </div>
          ) : totalLeft !== null ? (
            <div className="timer" data-testid="session-timer">
              {Math.ceil(totalLeft)}s
            </div>
          ) : null}
          <div className="session-bar__meta">
            {progress.total === null ? `${progress.done}` : `${progress.done} / ${progress.total}`}
          </div>
        </div>
      </div>

      <div className="progress" aria-hidden="true">
        <div
          className="progress__fill"
          style={{
            width: progress.total === null ? '100%' : `${Math.min(100, (progress.done / progress.total) * 100)}%`,
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
          </div>

          {question !== null ? (
            <Board
              fen={question.board.fen}
              orientation={question.board.orientation}
              labels={question.board.labels}
              marks={marks}
              badges={badges.size > 0 ? badges : undefined}
              hidden={question.board.hidden ?? false}
              revealMs={question.board.revealMs}
              decorativePieces={question.board.decorativePieces ?? false}
              disabled={showingFeedback}
              movableSquares={
                question.expected.kind === 'move' ? [question.expected.from] : []
              }
              onMove={
                question.expected.kind === 'move'
                  ? (from, to) => submit({ kind: 'move', from, to }, 'drag')
                  : undefined
              }
              onSquareTap={(square) => {
                if (showingFeedback || question === null) return;
                const kind = question.expected.kind;
                if (kind === 'single-square') {
                  submit({ kind: 'single-square', square }, 'touch');
                } else if (kind === 'square-set') {
                  setSelected((current) =>
                    current.includes(square)
                      ? current.filter((s) => s !== square)
                      : [...current, square],
                  );
                } else if (kind === 'square-path') {
                  setPath((current) =>
                    current[current.length - 1] === square ? current.slice(0, -1) : [...current, square],
                  );
                }
              }}
            />
          ) : null}

          <AnswerControls
            question={question}
            disabled={showingFeedback}
            selectedCount={selected.length}
            pathLength={path.length}
            onCoordinate={(square) => submit({ kind: 'coordinate', square }, 'keypad')}
            onColor={(color) => submit({ kind: 'square-color', color }, 'touch')}
            onChoice={(choice) => submit({ kind: 'choice', choice }, 'touch')}
            onSubmitSet={() => submit({ kind: 'square-set', squares: selected }, 'touch')}
            onSubmitPath={() => submit({ kind: 'square-path', squares: path }, 'touch')}
            onClearPath={() => setPath([])}
          />

          {showingFeedback && grade !== null ? (
            <div
              className={`feedback feedback--${grade.correct ? 'correct' : 'wrong'}`}
              role="status"
              data-testid="feedback"
            >
              {grade.explanation}
            </div>
          ) : null}

          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            {showingFeedback ? (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={goNext}
                  data-testid="next-question"
                >
                  Next
                </button>
                {grade?.correct === false &&
                (state.settings.retry === 'immediate' || state.settings.retry === 'both') ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setState(retryCurrent(state))}
                    data-testid="retry-question"
                  >
                    Try again
                  </button>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="button"
                onClick={() => setState(pause(state))}
                data-testid="pause"
              >
                Pause
              </button>
            )}
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

function AnswerControls({
  question,
  disabled,
  selectedCount,
  pathLength,
  onCoordinate,
  onColor,
  onChoice,
  onSubmitSet,
  onSubmitPath,
  onClearPath,
}: {
  question: Question | null;
  disabled: boolean;
  selectedCount: number;
  pathLength: number;
  onCoordinate: (square: SquareName) => void;
  onColor: (color: 'light' | 'dark') => void;
  onChoice: (choice: string) => void;
  onSubmitSet: () => void;
  onSubmitPath: () => void;
  onClearPath: () => void;
}) {
  if (question === null) return null;

  switch (question.expected.kind) {
    case 'coordinate':
      return (
        <CoordinateKeypad onSubmit={onCoordinate} disabled={disabled} resetKey={question.id} />
      );
    case 'square-color':
      return <ColorChoice onChoose={onColor} disabled={disabled} />;
    case 'choice':
      return (
        <ChoiceButtons choices={question.expected.choices} onChoose={onChoice} disabled={disabled} />
      );
    case 'square-set':
      return (
        <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
          <button
            type="button"
            className="button button--primary"
            onClick={onSubmitSet}
            disabled={disabled}
            data-testid="submit-set"
          >
            Submit {selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
        </div>
      );
    case 'square-path':
      return (
        <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
          <button
            type="button"
            className="button button--primary"
            onClick={onSubmitPath}
            disabled={disabled || pathLength === 0}
            data-testid="submit-path"
          >
            Submit route ({pathLength})
          </button>
          <button
            type="button"
            className="button"
            onClick={onClearPath}
            disabled={disabled || pathLength === 0}
          >
            Clear
          </button>
        </div>
      );
    case 'single-square':
    case 'move':
      return null;
  }
}

/** Squares the user picked that were actually part of the answer. */
function correctlySelected(question: Question | null, selected: readonly SquareName[]): SquareName[] {
  if (question === null || question.expected.kind !== 'square-set') return [];
  return selected.filter((square) => question.expected.kind === 'square-set' && question.expected.squares.includes(square));
}

/** Destination markers, only when the mode enabled hints. */
function hintSquares(question: Question): SquareName[] {
  if (question.expected.kind === 'move') return [question.expected.to];
  return [];
}
