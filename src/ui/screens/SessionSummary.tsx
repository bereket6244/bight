/**
 * End-of-session review.
 *
 * Shown for a completed session and for one the user ended early - a partial
 * summary is still a summary, and the spec requires that nothing is lost when
 * someone leaves mid-session.
 */

import type { SessionSummary } from '../../core/session/engine';
import type { SessionSettings } from '../../core/session/settings';
import { getMode } from '../../core/training/registry';

export interface SessionSummaryViewProps {
  summary: SessionSummary;
  settings: SessionSettings;
  onRestart: () => void;
  onExit: () => void;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

export function SessionSummaryView({
  summary,
  settings,
  onRestart,
  onExit,
}: SessionSummaryViewProps) {
  const mode = getMode(settings.modeId);
  const accuracy = Math.round(summary.accuracy * 100);

  return (
    <div data-testid="session-summary">
      <h1 className="screen-title">
        {summary.endedEarly ? 'Session ended early' : 'Session complete'}
      </h1>
      <p className="card__subtitle" style={{ marginBottom: 'var(--gap)' }}>
        {mode.title}
        {summary.endedEarly ? ' · partial results are still recorded' : ''}
      </p>

      {summary.total === 0 ? (
        <p className="empty-note">No questions were answered.</p>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 'var(--gap)' }}>
            <div className="stat">
              <div className="stat__value" data-testid="summary-accuracy">
                {accuracy}%
              </div>
              <div className="stat__label">Accuracy</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {summary.correct}/{summary.total}
              </div>
              <div className="stat__label">Correct</div>
            </div>
            <div className="stat">
              <div className="stat__value">{formatMs(summary.medianMs)}</div>
              <div className="stat__label">Median</div>
            </div>
            <div className="stat">
              <div className="stat__value">{formatMs(summary.fastestCorrectMs)}</div>
              <div className="stat__label">Fastest</div>
            </div>
            <div className="stat">
              <div className="stat__value">{summary.bestStreak}</div>
              <div className="stat__label">Best streak</div>
            </div>
            <div className="stat">
              <div className="stat__value">{Math.round(summary.durationMs / 1000)}s</div>
              <div className="stat__label">Duration</div>
            </div>
          </div>

          {summary.mistakes.length > 0 ? (
            <div className="card">
              <h2 className="card__title">Review ({summary.mistakes.length})</h2>
              {summary.mistakes.map((attempt, index) => (
                <div className="list-row" key={`${attempt.questionId}-${index}`}>
                  <div>
                    <div>{attempt.prompt}</div>
                    <div className="list-row__meta">
                      You answered {attempt.answer} · correct answer {attempt.expected}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card">
              <h2 className="card__title">No mistakes</h2>
              <p className="card__subtitle">Every answer in this session was correct.</p>
            </div>
          )}
        </>
      )}

      <div className="button-row">
        <button type="button" className="button button--primary" onClick={onRestart} data-testid="restart-session">
          Practice again
        </button>
        <button type="button" className="button" onClick={onExit} data-testid="summary-exit">
          Done
        </button>
      </div>
    </div>
  );
}
