/**
 * Session history and personal bests.
 */

import { useEffect, useState } from 'react';
import { getMode } from '../../core/training/registry';
import { personalBestsFromSessions } from '../../core/progress/stats';
import type { StoredSession } from '../../core/storage/types';
import { useApp } from '../state/AppContext';

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatBestValue(key: string, value: number): string {
  if (key.endsWith('best-accuracy')) return `${Math.round(value * 100)}%`;
  if (key.endsWith('fastest-correct')) return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
  return String(value);
}

function describeBestKey(key: string): string {
  const [modeId, metric] = key.split(':');
  let title = modeId ?? key;
  try {
    title = getMode(modeId as never).title;
  } catch {
    // Unknown mode from an imported backup; show the raw id.
  }
  const label =
    metric === 'best-accuracy' ? 'Best accuracy' : metric === 'best-streak' ? 'Longest run' : 'Fastest answer';
  return `${title} · ${label}`;
}

export function HistoryScreen() {
  const app = useApp();
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await app.repository.getSessions(200);
        if (!cancelled) setSessions(rows);
      } catch {
        // Empty state.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.repository, app.dataVersion]);

  if (!loaded) return <p className="empty-note">Loading history…</p>;

  const bests = personalBestsFromSessions(sessions);

  return (
    <div data-testid="history-screen">
      <h1 className="screen-title">History</h1>

      {bests.length > 0 ? (
        <div className="card">
          <h2 className="card__title">Personal bests</h2>
          {bests.map((best) => (
            <div className="list-row" key={best.key}>
              <span>{describeBestKey(best.key)}</span>
              <strong>{formatBestValue(best.key, best.value)}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {sessions.length === 0 ? (
        <p className="empty-note">No sessions yet.</p>
      ) : (
        <div className="card">
          <h2 className="card__title">Sessions</h2>
          {sessions.map((session) => (
            <div className="list-row" key={session.id}>
              <div>
                <strong>{safeTitle(session.modeId)}</strong>
                <div className="list-row__meta">
                  {formatWhen(session.startedAt)} · {session.correct}/{session.total}
                  {session.endedEarly ? ' · ended early' : ''}
                </div>
              </div>
              <span className="badge">{Math.round(session.accuracy * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function safeTitle(modeId: string): string {
  try {
    return getMode(modeId as never).title;
  } catch {
    return modeId;
  }
}
