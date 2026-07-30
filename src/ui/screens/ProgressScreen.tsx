/**
 * Progress: mastery, breakdowns and trends.
 *
 * The board heat map is the centrepiece - it turns "you are weak on the
 * kingside" into something you can see at a glance.
 */

import { useEffect, useState } from 'react';
import {
  fullBoardMastery,
  masteryOverview,
  weakestSquares,
  MASTERY_EXPLANATION,
} from '../../core/progress/mastery';
import {
  accuracyTrend,
  bestStreak,
  improvement,
  mostMissedTargets,
  mostWronglySelected,
  overallStats,
  statsByFile,
  statsByMode,
  statsByOrientation,
  statsByRank,
  timingStats,
} from '../../core/progress/stats';
import {
  buildDailyRecords,
  computeStreak,
  evaluateAchievements,
} from '../../core/progress/streak';
import { squaresInDisplayOrder } from '../../core/chess/square';
import { getMode } from '../../core/training/registry';
import { MODES } from '../../core/training/registry';
import type { StoredAttempt, StoredSession } from '../../core/storage/types';
import { useApp } from '../state/AppContext';

function formatMs(ms: number | null): string {
  if (ms === null || ms === 0) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

/** Green through amber to grey as mastery falls. */
function masteryColor(score: number, attempts: number): string {
  if (attempts === 0) return 'var(--surface-sunken)';
  const hue = 8 + score * 100;
  return `hsl(${hue} 55% ${28 + score * 22}%)`;
}

export function ProgressScreen() {
  const app = useApp();
  const [attempts, setAttempts] = useState<StoredAttempt[]>([]);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [a, s] = await Promise.all([
          app.repository.getAttempts({ limit: 5000 }),
          app.repository.getSessions(),
        ]);
        if (cancelled) return;
        setAttempts(a);
        setSessions(s);
      } catch {
        // Leave the empty state in place.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.repository, app.dataVersion]);

  if (!loaded) return <p className="empty-note">Loading progress…</p>;

  if (attempts.length === 0) {
    return (
      <div data-testid="progress-screen">
        <h1 className="screen-title">Progress</h1>
        <p className="empty-note">
          Finish a session and your accuracy, timing and board mastery will appear here.
        </p>
      </div>
    );
  }

  const stats = overallStats(attempts);
  const timing = timingStats(attempts);
  const mastery = fullBoardMastery(attempts);
  const overview = masteryOverview(attempts);
  const byMode = statsByMode(attempts);
  const byFile = statsByFile(attempts);
  const byRank = statsByRank(attempts);
  const byOrientation = statsByOrientation(attempts);
  const weak = weakestSquares(attempts, 8).filter((entry) => entry.attempts > 0);
  const missed = mostMissedTargets(attempts, 6);
  const wrong = mostWronglySelected(attempts, 6);
  const trend = accuracyTrend(attempts, 14);
  const trendChange = improvement(attempts);
  const streak = computeStreak(buildDailyRecords(sessions));

  const achievements = evaluateAchievements({
    totalQuestions: stats.attempts,
    totalCorrect: stats.correct,
    sessions,
    streak,
    masteredSquares: overview.mastered,
    bestSessionAccuracy: Math.max(0, ...sessions.map((s) => s.accuracy)),
    bestStreakInSession: Math.max(0, ...sessions.map((s) => s.bestStreak)),
    fastestCorrectMs: timing.fastestCorrectMs,
    modesPractised: new Set(attempts.map((a) => a.modeId)),
    totalModes: MODES.length,
  });

  return (
    <div data-testid="progress-screen">
      <h1 className="screen-title">Progress</h1>

      <div className="card">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{Math.round(stats.accuracy * 100)}%</div>
            <div className="stat__label">Accuracy</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.attempts}</div>
            <div className="stat__label">Questions</div>
          </div>
          <div className="stat">
            <div className="stat__value">{formatMs(timing.medianMs)}</div>
            <div className="stat__label">Median</div>
          </div>
          <div className="stat">
            <div className="stat__value">{formatMs(timing.fastestCorrectMs)}</div>
            <div className="stat__label">Fastest</div>
          </div>
          <div className="stat">
            <div className="stat__value">{bestStreak(attempts)}</div>
            <div className="stat__label">Best run</div>
          </div>
          <div className="stat">
            <div className="stat__value">{sessions.length}</div>
            <div className="stat__label">Sessions</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Board mastery</h2>
        <p className="card__subtitle" style={{ marginBottom: 'var(--gap)' }}>
          {overview.mastered} mastered · {overview.strong} strong · {overview.familiar} familiar ·{' '}
          {overview.learning} learning · {overview.unseen} not yet seen
        </p>
        <div className="heat-grid">
          {squaresInDisplayOrder('white').map((square) => {
            const entry = mastery.get(square);
            return (
              <div
                key={square}
                className="heat-cell"
                style={{ background: masteryColor(entry?.score ?? 0, entry?.attempts ?? 0) }}
                title={`${square}: ${entry?.attempts ?? 0} attempts, score ${((entry?.score ?? 0) * 100).toFixed(0)}%`}
              >
                {square}
              </div>
            );
          })}
        </div>
        <p className="card__subtitle" style={{ marginTop: 'var(--gap)' }}>
          {MASTERY_EXPLANATION}
        </p>
      </div>

      {weak.length > 0 ? (
        <div className="card">
          <h2 className="card__title">Weakest squares</h2>
          {weak.map((entry) => (
            <div className="list-row" key={entry.square}>
              <div>
                <strong style={{ fontFamily: 'var(--mono)' }}>{entry.square}</strong>
                <div className="list-row__meta">
                  {entry.correct}/{entry.attempts} correct · {formatMs(entry.averageMs)} average
                </div>
              </div>
              <span className="badge">{entry.level}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2 className="card__title">By mode</h2>
        {[...byMode.entries()].map(([modeId, entry]) => (
          <BarRow
            key={modeId}
            label={safeModeTitle(modeId)}
            value={entry.accuracy}
            detail={`${Math.round(entry.accuracy * 100)}%`}
          />
        ))}
      </div>

      <div className="card">
        <h2 className="card__title">By file</h2>
        {[...byFile.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, entry]) => (
            <BarRow key={file} label={file} value={entry.accuracy} detail={`${Math.round(entry.accuracy * 100)}%`} />
          ))}
        <h2 className="card__title" style={{ marginTop: 'var(--gap)' }}>
          By rank
        </h2>
        {[...byRank.entries()]
          .sort(([a], [b]) => a - b)
          .map(([rank, entry]) => (
            <BarRow
              key={rank}
              label={String(rank)}
              value={entry.accuracy}
              detail={`${Math.round(entry.accuracy * 100)}%`}
            />
          ))}
      </div>

      <div className="card">
        <h2 className="card__title">By orientation</h2>
        {[...byOrientation.entries()].map(([orientation, entry]) => (
          <BarRow
            key={orientation}
            label={orientation}
            value={entry.accuracy}
            detail={`${Math.round(entry.accuracy * 100)}% of ${entry.attempts}`}
          />
        ))}
      </div>

      {missed.length > 0 ? (
        <div className="card">
          <h2 className="card__title">Most often missed</h2>
          <p className="card__subtitle" style={{ marginBottom: 8 }}>
            Squares you should have selected but did not.
          </p>
          {missed.map((entry) => (
            <div className="list-row" key={entry.square}>
              <span style={{ fontFamily: 'var(--mono)' }}>{entry.square}</span>
              <span className="list-row__meta">{entry.misses} times</span>
            </div>
          ))}
          {wrong.length > 0 ? (
            <>
              <h2 className="card__title" style={{ marginTop: 'var(--gap)' }}>
                Most often selected wrongly
              </h2>
              {wrong.map((entry) => (
                <div className="list-row" key={entry.square}>
                  <span style={{ fontFamily: 'var(--mono)' }}>{entry.square}</span>
                  <span className="list-row__meta">{entry.times} times</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2 className="card__title">Recent activity</h2>
        {trendChange !== null ? (
          <p className="card__subtitle" style={{ marginBottom: 'var(--gap)' }}>
            Accuracy {trendChange.accuracyDelta >= 0 ? 'up' : 'down'}{' '}
            {Math.abs(Math.round(trendChange.accuracyDelta * 100))} points and{' '}
            {trendChange.speedDeltaMs <= 0 ? 'faster' : 'slower'} by{' '}
            {Math.abs(trendChange.speedDeltaMs)}ms across your last {trendChange.sampleSize} answers.
          </p>
        ) : null}
        {trend.map((point) => (
          <BarRow
            key={point.date}
            label={point.date.slice(5)}
            value={point.accuracy}
            detail={point.attempts === 0 ? '—' : `${point.attempts}`}
          />
        ))}
      </div>

      <div className="card">
        <h2 className="card__title">Achievements</h2>
        {achievements.map((status) => (
          <div className="list-row" key={status.definition.id}>
            <div>
              <strong>{status.definition.title}</strong>
              <div className="list-row__meta">{status.definition.description}</div>
            </div>
            <span className={`badge${status.unlocked ? ' badge--on' : ''}`}>
              {status.unlocked ? 'Earned' : `${Math.round(status.progress * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function safeModeTitle(modeId: string): string {
  try {
    return getMode(modeId as never).title;
  } catch {
    return modeId;
  }
}

function BarRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="bar-row">
      <span className="bar-row__label">{label}</span>
      <span className="bar-row__track">
        <span className="bar-row__fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="bar-row__value">{detail}</span>
    </div>
  );
}
