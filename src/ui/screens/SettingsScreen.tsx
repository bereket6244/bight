/**
 * Settings: appearance, feedback, voice, backup and storage.
 *
 * Backup export and import go through the Storage Access Framework via the
 * browser's own download and file-picker flows, which Capacitor maps to the
 * Android document picker. No broad storage permission is requested.
 */

import { useRef, useState } from 'react';
import { exportBackup, importBackup, inspectBackup } from '../../core/backup/service';
import { backupFilename } from '../../core/backup/format';
import { MASTERY_EXPLANATION } from '../../core/progress/mastery';
import { MIN_STREAK_QUESTIONS } from '../../core/progress/streak';
import { useApp } from '../state/AppContext';
import { APP_NAME, APP_VERSION, PACKAGE_ID } from '../../core/version';
import { voiceStatusLabel, useVoiceAvailability } from '../../services/voice/useVoice';

/**
 * Reads a picked file as text.
 *
 * `Blob.text()` is the modern path, but it is absent from older Android
 * WebViews, so FileReader is kept as a fallback rather than assuming the
 * newer API is present on whatever WebView the device ships.
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsText(file);
  });
}

export function SettingsScreen() {
  const app = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ json: string; summary: string } | null>(null);
  const voice = useVoiceAvailability();

  const handleExport = async (): Promise<void> => {
    try {
      const json = await exportBackup(app.repository);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backupFilename();
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage({ kind: 'ok', text: 'Backup saved.' });
    } catch (error) {
      setMessage({ kind: 'error', text: `Export failed: ${(error as Error).message}` });
    }
  };

  const handleFile = async (file: File): Promise<void> => {
    const json = await readFileText(file);
    const inspection = inspectBackup(json);
    if (!inspection.ok || inspection.preview === null) {
      setMessage({ kind: 'error', text: inspection.errors.join(' ') });
      setPendingImport(null);
      return;
    }
    const preview = inspection.preview;
    setPendingImport({
      json,
      summary: `${preview.attempts} answers, ${preview.sessions} sessions, ${preview.days} days${
        preview.needsMigration ? ` · will upgrade from schema ${preview.schemaVersion}` : ''
      }`,
    });
    setMessage(null);
  };

  const runImport = async (mode: 'merge' | 'replace'): Promise<void> => {
    if (pendingImport === null) return;
    const result = await importBackup(app.repository, pendingImport.json, mode);
    if (result.ok) {
      const migrated = result.migrationsApplied.length > 0 ? ` Migrations applied: ${result.migrationsApplied.length}.` : '';
      setMessage({ kind: 'ok', text: `Backup imported.${migrated}` });
      app.notifyDataChanged();
    } else {
      setMessage({
        kind: 'error',
        text: `${result.errors.join(' ')}${result.rolledBack ? ' Your data was restored.' : ' Nothing was changed.'}`,
      });
    }
    setPendingImport(null);
  };

  return (
    <div data-testid="settings-screen">
      <h1 className="screen-title">Settings</h1>

      {message !== null ? (
        <div className={`feedback feedback--${message.kind === 'ok' ? 'correct' : 'wrong'}`} role="status">
          {message.text}
        </div>
      ) : null}

      <div className="card">
        <h2 className="card__title">Appearance</h2>
        <label className="field">
          <span className="field__label">Theme</span>
          <select
            className="field__control"
            data-testid="setting-theme"
            value={app.preferences.theme}
            onChange={(event) =>
              void app.updatePreferences({ theme: event.target.value as 'dark' | 'light' | 'system' })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">Match system</option>
          </select>
        </label>
        <p className="card__subtitle">
          The green board stays the same in both themes so the image you are training does not
          change.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">Feedback</h2>
        <div className="toggle-row">
          <span>Sound</span>
          <input
            type="checkbox"
            checked={app.preferences.sound}
            onChange={(event) => void app.updatePreferences({ sound: event.target.checked })}
            data-testid="setting-sound"
          />
        </div>
        <div className="toggle-row">
          <span>Haptics</span>
          <input
            type="checkbox"
            checked={app.preferences.haptics}
            onChange={(event) => void app.updatePreferences({ haptics: event.target.checked })}
            data-testid="setting-haptics"
          />
        </div>
        <div className="toggle-row">
          <span>Speak coordinates</span>
          <input
            type="checkbox"
            checked={app.preferences.speakPrompts}
            onChange={(event) => void app.updatePreferences({ speakPrompts: event.target.checked })}
          />
        </div>
        <label className="field" style={{ marginTop: 'var(--gap)' }}>
          <span className="field__label">Daily goal: {app.preferences.dailyGoal} questions</span>
          <input
            className="field__control"
            type="range"
            min={10}
            max={200}
            step={10}
            value={app.preferences.dailyGoal}
            onChange={(event) => void app.updatePreferences({ dailyGoal: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="card">
        <h2 className="card__title">Voice answers</h2>
        <div className="toggle-row">
          <span>Enable voice input</span>
          <input
            type="checkbox"
            checked={app.preferences.voiceInput}
            onChange={(event) => void app.updatePreferences({ voiceInput: event.target.checked })}
            data-testid="setting-voice"
          />
        </div>
        <p className="card__subtitle">
          {voiceStatusLabel(voice)} The microphone is only requested when you start a session with
          voice switched on, and recognition never leaves the device. Touch input always stays
          available.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">Backup</h2>
        <p className="card__subtitle" style={{ marginBottom: 'var(--gap)' }}>
          Everything is stored on this device only. Export a backup to keep a copy or move to a new
          phone.
        </p>
        <div className="button-row">
          <button type="button" className="button" onClick={() => void handleExport()} data-testid="export-backup">
            Export backup
          </button>
          <button
            type="button"
            className="button"
            onClick={() => fileInput.current?.click()}
            data-testid="import-backup"
          >
            Import backup
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          data-testid="import-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleFile(file);
            event.target.value = '';
          }}
        />

        {pendingImport !== null ? (
          <div className="card" style={{ marginTop: 'var(--gap)', marginBottom: 0 }}>
            <h3 className="card__title">Import this backup?</h3>
            <p className="card__subtitle">{pendingImport.summary}</p>
            <div className="button-row" style={{ marginTop: 'var(--gap)' }}>
              <button type="button" className="button button--primary" onClick={() => void runImport('merge')}>
                Merge
              </button>
              <button type="button" className="button" onClick={() => void runImport('replace')}>
                Replace everything
              </button>
              <button type="button" className="button button--ghost" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
            </div>
            <p className="card__subtitle" style={{ marginTop: 8 }}>
              Merge keeps what you already have and adds anything new. Replace discards current
              data. A snapshot is taken first either way.
            </p>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 className="card__title">How mastery works</h2>
        <p className="card__subtitle">{MASTERY_EXPLANATION}</p>
        <p className="card__subtitle" style={{ marginTop: 8 }}>
          A day counts toward your streak once you finish a session of at least{' '}
          {MIN_STREAK_QUESTIONS} questions.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">About</h2>
        <div className="list-row">
          <span>Version</span>
          <span>{APP_VERSION}</span>
        </div>
        <div className="list-row">
          <span>Package</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{PACKAGE_ID}</span>
        </div>
        <div className="list-row">
          <span>Storage</span>
          <span>{app.engine}</span>
        </div>
        {app.ephemeral ? (
          <p className="card__subtitle" style={{ color: 'var(--danger)', marginTop: 8 }}>
            No persistent storage is available, so progress will be lost when {APP_NAME} closes.
          </p>
        ) : null}
        {app.fallbacks.length > 0 ? (
          <p className="card__subtitle" style={{ marginTop: 8 }}>
            Storage fallbacks: {app.fallbacks.map((f) => `${f.engine} (${f.reason})`).join('; ')}
          </p>
        ) : null}
        <p className="card__subtitle" style={{ marginTop: 8 }}>
          {APP_NAME} works entirely offline. It has no account, no server, no adverts and no
          analytics.
        </p>
      </div>
    </div>
  );
}
