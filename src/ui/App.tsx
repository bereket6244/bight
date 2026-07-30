/**
 * The app shell: five tabs, one session runner, and error boundaries around
 * each so a failure in one screen cannot take the others down.
 *
 * Android's back button is handled here: it leaves a session through the same
 * confirmation path as the on-screen End button, so a session is never lost
 * silently.
 */

import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomeScreen } from './screens/HomeScreen';
import { ModesScreen } from './screens/ModesScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SessionScreen } from './screens/SessionScreen';
import type { SessionSettings } from '../core/session/settings';
import { useApp } from './state/AppContext';

type Tab = 'home' | 'modes' | 'progress' | 'history' | 'settings';

/**
 * Every tab carries a text label as well as its glyph. The glyphs are not
 * universally understood on their own, so they are decoration on top of the
 * label rather than a replacement for it.
 */
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: 'Home', icon: '◆' },
  { id: 'modes', label: 'Practice', icon: '▦' },
  { id: 'progress', label: 'Progress', icon: '▲' },
  { id: 'history', label: 'History', icon: '≡' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('home');
  const [session, setSession] = useState<SessionSettings | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const startSession = useCallback((settings: SessionSettings) => {
    setSession(settings);
    setConfirmExit(false);
  }, []);

  const endSession = useCallback(() => {
    setSession(null);
    setConfirmExit(false);
    app.notifyDataChanged();
  }, [app]);

  // Android hardware back. Inside a session it asks first; elsewhere it walks
  // back to Home before letting the app close.
  useEffect(() => {
    let remove: (() => void) | undefined;

    void (async () => {
      try {
        const { App: CapacitorApp } = (await import('@capacitor/app')) as unknown as {
          App: {
            addListener: (
              event: 'backButton',
              handler: (event: { canGoBack: boolean }) => void,
            ) => Promise<{ remove: () => void }>;
            exitApp: () => void;
          };
        };

        const handle = await CapacitorApp.addListener('backButton', () => {
          if (session !== null) {
            setConfirmExit(true);
            return;
          }
          if (tab !== 'home') {
            setTab('home');
            return;
          }
          CapacitorApp.exitApp();
        });
        remove = () => handle.remove();
      } catch {
        // Not running under Capacitor; the browser's own back behaviour applies.
      }
    })();

    return () => remove?.();
  }, [session, tab]);

  if (session !== null) {
    return (
      // A session gets the whole shell: the bottom nav would only compete with
      // the board, and Pause/End already provide a clear way out.
      <div className="app app--session">
        <main className="app__main">
          {confirmExit ? (
            <div className="card" role="dialog" aria-modal="true" data-testid="confirm-exit">
              <h2 className="card__title">Leave this session?</h2>
              <p className="card__subtitle">
                Your answers so far are kept and will appear in your progress.
              </p>
              <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
                <button type="button" className="button button--primary" onClick={() => setConfirmExit(false)}>
                  Keep practicing
                </button>
                <button type="button" className="button button--danger" onClick={endSession}>
                  Leave
                </button>
              </div>
            </div>
          ) : null}
          <ErrorBoundary
            label="Session"
            fallback={(error, reset) => (
              <div className="error-boundary" role="alert">
                <h2 className="card__title">This mode stopped working</h2>
                <p className="card__subtitle">
                  Every other mode is unaffected. Your earlier progress is safe.
                </p>
                <p className="card__subtitle" style={{ fontFamily: 'var(--mono)', marginTop: 8 }}>
                  {error.message}
                </p>
                <div className="button-row" style={{ marginTop: 12 }}>
                  <button type="button" className="button" onClick={reset}>
                    Try again
                  </button>
                  <button type="button" className="button button--primary" onClick={endSession}>
                    Back to modes
                  </button>
                </div>
              </div>
            )}
          >
            <SessionScreen settings={session} onExit={endSession} />
          </ErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <main className="app__main">
        <ErrorBoundary label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'home' ? (
            <HomeScreen onStart={startSession} onBrowseModes={() => setTab('modes')} />
          ) : null}
          {tab === 'modes' ? <ModesScreen onStart={startSession} /> : null}
          {tab === 'progress' ? <ProgressScreen /> : null}
          {tab === 'history' ? <HistoryScreen /> : null}
          {tab === 'settings' ? <SettingsScreen /> : null}
        </ErrorBoundary>
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`tabbar__item${tab === entry.id ? ' tabbar__item--active' : ''}`}
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? 'page' : undefined}
            data-testid={`tab-${entry.id}`}
          >
            <span className="tabbar__icon" aria-hidden="true">
              {entry.icon}
            </span>
            {entry.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
