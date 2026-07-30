/**
 * Application context: the repository, preferences and theme.
 *
 * The repository is opened once at startup through the fallback chain. If it
 * fails entirely the app still renders - `ephemeral` just becomes true and
 * Settings says progress will not be saved. Nothing in the training path is
 * allowed to depend on storage succeeding.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createRepository } from '../../core/storage';
import {
  defaultPreferences,
  type BightRepository,
  type PreferencesRecord,
} from '../../core/storage/types';
import { MemoryRepository } from '../../core/storage/memory';

export interface AppState {
  repository: BightRepository;
  engine: string;
  ephemeral: boolean;
  fallbacks: Array<{ engine: string; reason: string }>;
  preferences: PreferencesRecord;
  updatePreferences: (patch: Partial<PreferencesRecord>) => Promise<void>;
  /** Bumped whenever stored data changes, so screens can refetch. */
  dataVersion: number;
  notifyDataChanged: () => void;
  ready: boolean;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (context === null) throw new Error('useApp must be used inside <AppProvider>');
  return context;
}

function applyTheme(theme: PreferencesRecord['theme']): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: light)')?.matches
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [repository, setRepository] = useState<BightRepository | null>(null);
  const [engine, setEngine] = useState('memory');
  const [ephemeral, setEphemeral] = useState(false);
  const [fallbacks, setFallbacks] = useState<Array<{ engine: string; reason: string }>>([]);
  const [preferences, setPreferences] = useState<PreferencesRecord>(defaultPreferences());
  const [dataVersion, setDataVersion] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let selection;
      try {
        selection = await createRepository();
      } catch {
        // createRepository is written not to throw, but a hard failure here
        // must still leave a usable app.
        const fallback = new MemoryRepository();
        await fallback.init();
        selection = {
          repository: fallback as BightRepository,
          fallbacks: [{ engine: 'all', reason: 'Storage could not be opened' }],
          ephemeral: true,
        };
      }
      if (cancelled) return;

      setRepository(selection.repository);
      setEngine(selection.repository.engine);
      setEphemeral(selection.ephemeral);
      setFallbacks(selection.fallbacks);

      try {
        const loaded = await selection.repository.getPreferences();
        if (!cancelled) setPreferences(loaded);
      } catch {
        if (!cancelled) setPreferences(defaultPreferences());
      }

      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyTheme(preferences.theme);
  }, [preferences.theme]);

  const updatePreferences = useCallback(
    async (patch: Partial<PreferencesRecord>) => {
      setPreferences((current) => {
        const next = { ...current, ...patch };
        // Persist without blocking the UI; a storage failure must not stop the
        // preference from taking effect for this session.
        void repository?.savePreferences(next).catch(() => undefined);
        return next;
      });
    },
    [repository],
  );

  const notifyDataChanged = useCallback(() => setDataVersion((v) => v + 1), []);

  const value = useMemo<AppState | null>(() => {
    if (repository === null) return null;
    return {
      repository,
      engine,
      ephemeral,
      fallbacks,
      preferences,
      updatePreferences,
      dataVersion,
      notifyDataChanged,
      ready,
    };
  }, [
    repository,
    engine,
    ephemeral,
    fallbacks,
    preferences,
    updatePreferences,
    dataVersion,
    notifyDataChanged,
    ready,
  ]);

  if (value === null) {
    return (
      <div className="app">
        <main className="app__main">
          <p className="empty-note">Starting Bight…</p>
        </main>
      </div>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
