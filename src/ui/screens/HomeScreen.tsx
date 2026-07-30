/**
 * Home: streak, then what you actually practice.
 *
 * The first version showed a fixed "Recommended" list identical for every
 * user, plus several paragraphs repeating what the app is. Both are gone.
 * Recent and Frequent are derived from local session history; on a fresh
 * install a plainly-labelled "Start here" list appears instead of pretending
 * defaults are personalized.
 */

import { useEffect, useMemo, useState } from 'react';
import { getMode, findMode, modeLabel, variantLabel, STARTER_MODE_IDS } from '../../core/training/registry';
import { defaultSettings, type SessionSettings } from '../../core/session/settings';
import {
  buildDailyRecords,
  computeStreak,
  dailyGoalProgress,
  rollingWeek,
} from '../../core/progress/streak';
import { frequentModes, hasEnoughHistory, recentModes } from '../../core/progress/usage';
import type { StoredSession } from '../../core/storage/types';
import type { ModeId } from '../../core/training/types';
import { useApp } from '../state/AppContext';
import { APP_NAME } from '../../core/version';

export interface HomeScreenProps {
  onStart: (settings: SessionSettings) => void;
  onBrowseModes: () => void;
}

export function HomeScreen({ onStart, onBrowseModes }: HomeScreenProps) {
  const app = useApp();
  const [sessions, setSessions] = useState<StoredSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await app.repository.getSessions();
        if (!cancelled) setSessions(loaded);
      } catch {
        // An empty home screen is a fine outcome for a read failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.repository, app.dataVersion]);

  const daily = useMemo(() => buildDailyRecords(sessions), [sessions]);
  const streak = computeStreak(daily);
  const goal = dailyGoalProgress(daily, app.preferences.dailyGoal);
  const week = rollingWeek(daily);

  const recent = useMemo(() => recentModes(sessions), [sessions]);
  const frequent = useMemo(() => frequentModes(sessions), [sessions]);
  const personalized = hasEnoughHistory(sessions);

  /**
   * Opens a mode with the settings last used for it, falling back to defaults.
   * A mode that no longer exists is never launched.
   */
  const launch = (modeId: ModeId, variantId: string): void => {
    const mode = findMode(modeId);
    if (mode === undefined) return;
    const saved = app.preferences.savedSettings[modeId];
    const base = saved ?? defaultSettings(modeId, variantId);
    onStart({ ...base, modeId, variantId });
  };

  return (
    <div data-testid="home-screen">
      <h1 className="screen-title">{APP_NAME}</h1>

      <div className="card">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value" data-testid="streak-current">
              {streak.current}
            </div>
            <div className="stat__label">Day streak</div>
          </div>
          <div className="stat">
            <div className="stat__value">
              {goal.done}/{goal.goal}
            </div>
            <div className="stat__label">Today</div>
          </div>
          <div className="stat">
            <div className="stat__value">{streak.longest}</div>
            <div className="stat__label">Best</div>
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
      </div>

      {personalized && recent.length > 0 ? (
        <section data-testid="recent-section">
          <h2 className="section-title">Recent</h2>
          <div className="mode-list">
            {recent.map((entry) => (
              <button
                key={`${entry.modeId}:${entry.variantId}`}
                type="button"
                className="mode-card mode-card--compact"
                onClick={() => launch(entry.modeId, entry.variantId)}
                data-testid={`recent-${entry.modeId}`}
              >
                <span className="mode-card__title">{modeLabel(entry.modeId)}</span>
                <span className="mode-card__meta">{variantLabel(entry.modeId, entry.variantId)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {personalized && frequent.length > 0 ? (
        <section data-testid="frequent-section">
          <h2 className="section-title">You practice these most</h2>
          <div className="mode-list">
            {frequent.map((entry) => (
              <button
                key={`${entry.modeId}:${entry.variantId}`}
                type="button"
                className="mode-card mode-card--compact"
                onClick={() => launch(entry.modeId, entry.variantId)}
                data-testid={`frequent-${entry.modeId}`}
              >
                <span className="mode-card__title">{modeLabel(entry.modeId)}</span>
                <span className="mode-card__meta">
                  {entry.sessions} session{entry.sessions === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!personalized ? (
        <section data-testid="starter-section">
          <h2 className="section-title">Start here</h2>
          <div className="mode-list">
            {STARTER_MODE_IDS.map((modeId) => {
              const mode = getMode(modeId);
              return (
                <button
                  key={mode.id}
                  type="button"
                  className="mode-card"
                  onClick={() => launch(mode.id, mode.variants[0]!.id)}
                  data-testid={`starter-${mode.id}`}
                >
                  <span className="mode-card__title">{mode.title}</span>
                  <span className="mode-card__summary">{mode.summary}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
        <button type="button" className="button" onClick={onBrowseModes} data-testid="browse-modes">
          All modes
        </button>
      </div>
    </div>
  );
}
