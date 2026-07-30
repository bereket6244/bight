/**
 * Home: streak, daily goal, and one tap into practice.
 *
 * Recommended modes are shown for quick access, but the full list is always
 * one tap away on the Modes tab - nothing is hidden behind a recommendation.
 */

import { useEffect, useState } from 'react';
import { MODES, RECOMMENDED_MODE_IDS, getMode } from '../../core/training/registry';
import { defaultSettings, type SessionSettings } from '../../core/session/settings';
import {
  buildDailyRecords,
  computeStreak,
  dailyGoalProgress,
  rollingWeek,
  MIN_STREAK_QUESTIONS,
} from '../../core/progress/streak';
import { overallStats } from '../../core/progress/stats';
import type { StoredAttempt, StoredSession } from '../../core/storage/types';
import { useApp } from '../state/AppContext';
import { APP_NAME, APP_TAGLINE } from '../../core/version';

export interface HomeScreenProps {
  onStart: (settings: SessionSettings) => void;
  onBrowseModes: () => void;
}

export function HomeScreen({ onStart, onBrowseModes }: HomeScreenProps) {
  const app = useApp();
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [attempts, setAttempts] = useState<StoredAttempt[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loadedSessions, loadedAttempts] = await Promise.all([
          app.repository.getSessions(),
          app.repository.getAttempts({ limit: 2000 }),
        ]);
        if (cancelled) return;
        setSessions(loadedSessions);
        setAttempts(loadedAttempts);
      } catch {
        // A read failure just means an empty home screen, not a crash.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.repository, app.dataVersion]);

  const daily = buildDailyRecords(sessions);
  const streak = computeStreak(daily);
  const goal = dailyGoalProgress(daily, app.preferences.dailyGoal);
  const week = rollingWeek(daily);
  const stats = overallStats(attempts);

  const lastMode = app.preferences.lastModeId;
  const resumeSettings: SessionSettings | null =
    lastMode === null
      ? null
      : (app.preferences.savedSettings[lastMode] ??
        defaultSettings(lastMode, app.preferences.lastVariantId ?? 'standard'));

  return (
    <div data-testid="home-screen">
      <h1 className="screen-title">
        {APP_NAME} <span className="badge">{APP_TAGLINE}</span>
      </h1>

      {!app.preferences.onboarded ? (
        <div className="card" data-testid="onboarding">
          <h2 className="card__title">Know every square without thinking</h2>
          <p className="card__subtitle">
            Bight drills coordinates and board vision — naming squares, seeing what a piece
            attacks, and holding the board in your head. It works entirely offline and keeps
            everything on this device.
          </p>
          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            <button
              type="button"
              className="button"
              onClick={() => void app.updatePreferences({ onboarded: true })}
              data-testid="dismiss-onboarding"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value" data-testid="streak-current">
              {streak.current}
            </div>
            <div className="stat__label">Day streak</div>
          </div>
          <div className="stat">
            <div className="stat__value">{streak.longest}</div>
            <div className="stat__label">Longest</div>
          </div>
          <div className="stat">
            <div className="stat__value">
              {goal.done}/{goal.goal}
            </div>
            <div className="stat__label">Today's goal</div>
          </div>
          <div className="stat">
            <div className="stat__value">
              {stats.attempts === 0 ? '—' : `${Math.round(stats.accuracy * 100)}%`}
            </div>
            <div className="stat__label">Accuracy</div>
          </div>
        </div>

        <div className="week-strip" style={{ marginTop: 'var(--gap)' }}>
          {week.map((day) => (
            <div
              key={day.date}
              className={`week-strip__day${day.counted ? ' week-strip__day--active' : ''}`}
              title={`${day.date}: ${day.questions} questions`}
            >
              {day.date.slice(8)}
            </div>
          ))}
        </div>
        <p className="card__subtitle" style={{ marginTop: 8 }}>
          A day counts once you finish a session of at least {MIN_STREAK_QUESTIONS} questions.
          {streak.atRisk ? ' Practise today to keep your streak.' : ''}
        </p>
      </div>

      {resumeSettings !== null ? (
        <div className="card">
          <h2 className="card__title">Carry on where you left off</h2>
          <p className="card__subtitle">{getMode(resumeSettings.modeId).title}</p>
          <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => onStart(resumeSettings)}
              data-testid="resume-last"
            >
              Practise
            </button>
          </div>
        </div>
      ) : null}

      <h2 className="screen-title" style={{ fontSize: '1.1rem' }}>
        Recommended
      </h2>
      <div className="mode-list">
        {RECOMMENDED_MODE_IDS.map((modeId) => {
          const mode = MODES.find((m) => m.id === modeId);
          if (mode === undefined) return null;
          return (
            <button
              key={mode.id}
              type="button"
              className="mode-card"
              onClick={() => onStart(defaultSettings(mode.id, mode.variants[0]?.id ?? 'standard'))}
              data-testid={`quick-start-${mode.id}`}
            >
              <p className="mode-card__title">{mode.title}</p>
              <p className="mode-card__summary">{mode.summary}</p>
            </button>
          );
        })}
      </div>

      <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
        <button type="button" className="button" onClick={onBrowseModes}>
          All {MODES.length} modes
        </button>
      </div>
    </div>
  );
}
