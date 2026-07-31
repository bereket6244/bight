/**
 * Settings.
 *
 * Audio used to be a single "Sound" checkbox plus a vague voice toggle, which
 * told you nothing about what would make noise, what needed a microphone, or
 * why voice did nothing. It is now three clearly separate capabilities:
 *
 *   Sound effects   — correct/wrong tones.        No microphone.
 *   Spoken prompts  — the system voice reads out. No microphone.
 *   Voice answers   — on-device recognition.      Microphone, on request only.
 *
 * Backup import/export uses the browser's own download and file-picker flows,
 * which Capacitor maps to the Android document picker. No broad storage
 * permission is requested.
 */

import { useRef, useState } from 'react';
import { exportBackup, importBackup, inspectBackup } from '../../core/backup/service';
import { backupFilename } from '../../core/backup/format';
import { useApp } from '../state/AppContext';
import { APP_VERSION, PACKAGE_ID } from '../../core/version';
import { useVoiceCapability } from '../../services/voice/useVoice';
import { effectiveVoiceEnabled, isVoiceUsable, voiceBadgeText } from '../../services/voice/state';
import { speechAvailable } from '../../services/speech';

/**
 * Reads a picked file as text.
 *
 * `Blob.text()` is absent from older Android WebViews, so FileReader stays as
 * a fallback rather than assuming the newer API exists.
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

function Toggle({
  label,
  hint,
  checked,
  onChange,
  testId,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="toggle-row">
        <span>{label}</span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          data-testid={testId}
          aria-label={label}
        />
      </div>
      {hint !== undefined ? <p className="card__subtitle setting-hint">{hint}</p> : null}
    </>
  );
}

export function SettingsScreen() {
  const app = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ json: string; summary: string } | null>(null);
  const voice = useVoiceCapability();

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
      summary: `${preview.attempts} answers, ${preview.sessions} sessions${
        preview.needsMigration ? ' · will be upgraded' : ''
      }`,
    });
    setMessage(null);
  };

  const runImport = async (mode: 'merge' | 'replace'): Promise<void> => {
    if (pendingImport === null) return;
    const result = await importBackup(app.repository, pendingImport.json, mode);
    if (result.ok) {
      setMessage({ kind: 'ok', text: 'Backup imported.' });
      app.notifyDataChanged();
    } else {
      setMessage({
        kind: 'error',
        text: `${result.errors.join(' ')}${result.rolledBack ? ' Your data was restored.' : ' Nothing changed.'}`,
      });
    }
    setPendingImport(null);
  };

  /**
   * Enabling voice is the only thing that may ask for the microphone.
   *
   * The preference records intent and is saved regardless of the outcome; what
   * the checkbox *shows* is the reconciled state. Writing `voiceInput: false`
   * on a failed request, as the first version did, meant a permission granted
   * a moment later left the switch stuck off.
   */
  const toggleVoice = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      await app.updatePreferences({ voiceInput: false });
      return;
    }
    await app.updatePreferences({ voiceInput: true });
    await voice.requestVoice();
  };

  const voiceUsable = isVoiceUsable(voice.state);

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
      </div>

      <div className="card">
        <h2 className="card__title">Sound and voice</h2>

        <Toggle
          label="Sound effects"
          hint="Short tones for right and wrong answers."
          checked={app.preferences.sound}
          onChange={(value) => void app.updatePreferences({ sound: value })}
          testId="setting-sound-effects"
        />

        <Toggle
          label="Haptics"
          hint="A short buzz on each answer."
          checked={app.preferences.haptics}
          onChange={(value) => void app.updatePreferences({ haptics: value })}
          testId="setting-haptics"
        />

        <Toggle
          label="Spoken prompts"
          hint={
            speechAvailable()
              ? 'Reads coordinates aloud using your device voice. No microphone needed.'
              : 'This device has no speech voice installed.'
          }
          checked={app.preferences.speakPrompts}
          disabled={!speechAvailable()}
          onChange={(value) => void app.updatePreferences({ speakPrompts: value })}
          testId="setting-spoken-prompts"
        />

        <div className="toggle-row" style={{ marginTop: 'var(--gap)' }}>
          <span>
            Voice answers{' '}
            <span className={`badge${voiceUsable ? ' badge--on' : ''}`} data-testid="voice-badge">
              {voiceBadgeText(voice.state)}
            </span>
          </span>
          <input
            type="checkbox"
            /*
             * The *effective* state, not the raw preference. A stored
             * preference of true with no permission behind it used to render
             * as an enabled checkbox, which is how the app claimed voice was
             * on before it had ever asked for a microphone.
             */
            checked={effectiveVoiceEnabled(app.preferences.voiceInput, voice.state)}
            disabled={voice.state === 'permission-requesting' || voice.state === 'model-checking'}
            onChange={(event) => void toggleVoice(event.target.checked)}
            data-testid="setting-voice-answers"
            aria-label="Voice answers"
          />
        </div>

        <p className="card__subtitle setting-hint" data-testid="voice-status">
          {voice.detail}
        </p>

        {/* A stable, actionable row - not a message that flashes and vanishes. */}
        {voice.canRetry ? (
          <div className="button-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="button"
              onClick={() => void toggleVoice(true)}
              data-testid="retry-microphone"
            >
              {voice.state === 'permission-not-requested' ? 'Allow microphone' : 'Try again'}
            </button>
          </div>
        ) : null}

        {voice.needsAppSettings ? (
          <p className="card__subtitle setting-hint" data-testid="voice-settings-hint">
            To turn it back on: {voice.appSettingsHint}
          </p>
        ) : null}

        <p className="card__subtitle setting-hint">
          Touch and the two-tap keypad always keep working, whatever voice does.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">Daily goal</h2>
        <label className="field">
          <span className="field__label">{app.preferences.dailyGoal} questions a day</span>
          <input
            className="field__control"
            type="range"
            min={10}
            max={200}
            step={10}
            value={app.preferences.dailyGoal}
            onChange={(event) => void app.updatePreferences({ dailyGoal: Number(event.target.value) })}
            aria-label="Daily goal in questions"
          />
        </label>
      </div>

      <div className="card">
        <h2 className="card__title">Backup</h2>
        <p className="card__subtitle" style={{ marginBottom: 'var(--gap)' }}>
          Everything stays on this device.
        </p>
        <div className="button-row">
          <button type="button" className="button" onClick={() => void handleExport()} data-testid="export-backup">
            Export
          </button>
          <button
            type="button"
            className="button"
            onClick={() => fileInput.current?.click()}
            data-testid="import-backup"
          >
            Import
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
                Replace
              </button>
              <button type="button" className="button button--ghost" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
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
            No storage is available, so progress will be lost when the app closes.
          </p>
        ) : null}
        <p className="card__subtitle" style={{ marginTop: 8 }}>
          Works offline. No account, no server, no ads, no analytics.
        </p>
      </div>
    </div>
  );
}
