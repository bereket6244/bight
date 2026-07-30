/**
 * Session setup.
 *
 * The controls people change often — orientation, labels, how long, prompt
 * visibility, voice — are visible above the Start button as segmented
 * controls. The rare ones (adaptive weighting, file/rank filters, retry
 * scheduling) sit under "More settings".
 *
 * Every segment carries a text label. Nothing here depends on interpreting a
 * bare icon.
 */

import { useState } from 'react';
import { FILE_LETTERS } from '../../core/chess/types';
import { QUADRANT_LABELS, QUADRANTS } from '../../core/chess/square';
import { validateSettings, type SessionSettings } from '../../core/session/settings';
import type { ModeDefinition } from '../../core/training/types';
import { useVoiceAvailability, voiceShortStatus } from '../../services/voice/useVoice';

export interface SessionSetupProps {
  mode: ModeDefinition;
  initial: SessionSettings;
  onStart: (settings: SessionSettings) => void;
  onBack: () => void;
}

/** A labelled segmented control. Selection is shown by fill, not colour alone. */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  testId?: string;
}) {
  return (
    <div className="setup-row">
      <span className="setup-row__label" id={`${testId ?? label}-label`}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={`${testId ?? label}-label`} data-testid={testId}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              className={`segmented__item${selected ? ' segmented__item--on' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              data-testid={testId === undefined ? undefined : `${testId}-${option.value}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SessionSetup({ mode, initial, onStart, onBack }: SessionSetupProps) {
  const [settings, setSettings] = useState<SessionSettings>(initial);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const voice = useVoiceAvailability();

  const patch = (changes: Partial<SessionSettings>): void =>
    setSettings((current) => ({ ...current, ...changes }));

  const toggleIn = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);

  const limitKind = settings.limit.kind;
  const voiceSupported = mode.supportsVoice === true;
  const voiceReady = voice.state === 'ready';

  return (
    <div data-testid="session-setup">
      <button type="button" className="button button--ghost" onClick={onBack} style={{ marginBottom: 8 }}>
        ← Back
      </button>

      <div className="setup-header">
        <h1 className="screen-title" style={{ margin: 0 }}>
          {mode.title}
        </h1>
        <button
          type="button"
          className="icon-button"
          onClick={() => setShowInfo((v) => !v)}
          aria-expanded={showInfo}
          aria-label={showInfo ? 'Hide details about this mode' : 'What is this mode?'}
          data-testid="mode-info"
        >
          ?
        </button>
      </div>

      {showInfo ? (
        <p className="card__subtitle" data-testid="mode-info-text" style={{ marginBottom: 'var(--gap)' }}>
          {mode.description}
        </p>
      ) : null}

      {mode.variants.length > 1 ? (
        <Segmented
          label="Exercise"
          value={settings.variantId}
          options={mode.variants.map((v) => ({ value: v.id, label: v.label }))}
          onChange={(variantId) => patch({ variantId })}
          testId="setup-variant"
        />
      ) : null}

      <Segmented
        label="Orientation"
        value={settings.orientation}
        options={[
          { value: 'white', label: 'White' },
          { value: 'black', label: 'Black' },
          { value: 'alternating', label: 'Alternate' },
        ]}
        onChange={(orientation) => patch({ orientation })}
        testId="setup-orientation"
      />

      <Segmented
        label="Coordinate labels"
        value={settings.labels}
        options={[
          { value: 'always', label: 'On' },
          { value: 'never', label: 'Off' },
        ]}
        onChange={(labels) => patch({ labels })}
        testId="setup-labels"
      />

      <Segmented
        label="Session length"
        value={limitKind}
        options={[
          { value: 'questions', label: 'Questions' },
          { value: 'total-time', label: 'Timed' },
          { value: 'endless', label: 'Endless' },
        ]}
        onChange={(kind) =>
          patch({
            limit:
              kind === 'questions'
                ? { kind: 'questions', count: 20 }
                : kind === 'total-time'
                  ? { kind: 'total-time', seconds: 180 }
                  : { kind: 'endless' },
          })
        }
        testId="setup-limit"
      />

      {settings.limit.kind === 'questions' ? (
        <Segmented
          label="How many"
          value={settings.limit.count}
          options={[10, 20, 40, 80].map((count) => ({ value: count, label: String(count) }))}
          onChange={(count) => patch({ limit: { kind: 'questions', count } })}
          testId="setup-count"
        />
      ) : null}

      {settings.limit.kind === 'total-time' ? (
        <Segmented
          label="How long"
          value={settings.limit.seconds}
          options={[
            { value: 60, label: '1 min' },
            { value: 180, label: '3 min' },
            { value: 300, label: '5 min' },
            { value: 600, label: '10 min' },
          ]}
          onChange={(seconds) => patch({ limit: { kind: 'total-time', seconds } })}
          testId="setup-duration"
        />
      ) : null}

      <Segmented
        label="Time per question"
        value={settings.questionTimer.kind === 'none' ? 0 : settings.questionTimer.seconds}
        options={[
          { value: 0, label: 'Off' },
          { value: 3, label: '3s' },
          { value: 5, label: '5s' },
          { value: 10, label: '10s' },
        ]}
        onChange={(seconds) =>
          patch({
            questionTimer: seconds === 0 ? { kind: 'none' } : { kind: 'per-question', seconds },
          })
        }
        testId="setup-per-question"
      />

      {mode.supportsPromptVisibility === true ? (
        <Segmented
          label="Prompt"
          value={settings.promptVisibility}
          options={[
            { value: 'persistent', label: 'Stays up' },
            { value: 'flash', label: 'Flashes' },
          ]}
          onChange={(promptVisibility) => patch({ promptVisibility })}
          testId="setup-prompt"
        />
      ) : null}

      {settings.promptVisibility === 'flash' && mode.supportsPromptVisibility === true ? (
        <Segmented
          label="Flash for"
          value={settings.revealMs}
          options={[
            { value: 500, label: '0.5s' },
            { value: 1000, label: '1s' },
            { value: 2000, label: '2s' },
          ]}
          onChange={(revealMs) => patch({ revealMs })}
          testId="setup-reveal"
        />
      ) : null}

      {mode.supportedLayouts.includes('starting') ? (
        <Segmented
          label="Board"
          value={settings.layout}
          options={[
            { value: 'empty', label: 'Empty' },
            { value: 'starting', label: 'Pieces' },
          ]}
          onChange={(layout) => patch({ layout })}
          testId="setup-layout"
        />
      ) : null}

      {mode.supportsHideBoard === true ? (
        <Segmented
          label="Board visible"
          value={settings.hideBoard ? 'hidden' : 'shown'}
          options={[
            { value: 'shown', label: 'Shown' },
            { value: 'hidden', label: 'Hidden' },
          ]}
          onChange={(choice) => patch({ hideBoard: choice === 'hidden' })}
          testId="setup-hide-board"
        />
      ) : null}

      {voiceSupported ? (
        <div className="setup-row" data-testid="setup-voice-row">
          <span className="setup-row__label" id="voice-label">
            Voice answers
          </span>
          <div className="segmented" role="group" aria-labelledby="voice-label" data-testid="setup-voice">
            <button
              type="button"
              className={`segmented__item${!settings.voiceInput ? ' segmented__item--on' : ''}`}
              aria-pressed={!settings.voiceInput}
              onClick={() => patch({ voiceInput: false })}
              data-testid="setup-voice-off"
            >
              Off
            </button>
            <button
              type="button"
              className={`segmented__item${settings.voiceInput ? ' segmented__item--on' : ''}`}
              aria-pressed={settings.voiceInput}
              onClick={() => patch({ voiceInput: true })}
              disabled={!voiceReady}
              data-testid="setup-voice-on"
            >
              On
            </button>
          </div>
          <p className="setup-row__hint" data-testid="setup-voice-status">
            {voiceReady
              ? 'The keypad still works at any time.'
              : voiceShortStatus(voice)}
          </p>
        </div>
      ) : null}

      <button
        type="button"
        className="button button--ghost"
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
        style={{ width: '100%', marginBottom: 'var(--gap)' }}
        data-testid="toggle-advanced"
      >
        {showAdvanced ? 'Hide' : 'More'} settings
      </button>

      {showAdvanced ? (
        <div data-testid="advanced-settings">
          <div className="card">
            <span className="field__label">Files</span>
            <div className="chip-row" style={{ marginBottom: 'var(--gap)' }}>
              {FILE_LETTERS.map((letter, index) => (
                <button
                  key={letter}
                  type="button"
                  className={`chip${settings.filters.files.includes(index) ? ' chip--on' : ''}`}
                  aria-pressed={settings.filters.files.includes(index)}
                  onClick={() =>
                    patch({ filters: { ...settings.filters, files: toggleIn(settings.filters.files, index) } })
                  }
                >
                  {letter}
                </button>
              ))}
            </div>

            <span className="field__label">Ranks</span>
            <div className="chip-row" style={{ marginBottom: 'var(--gap)' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((rank) => (
                <button
                  key={rank}
                  type="button"
                  className={`chip${settings.filters.ranks.includes(rank - 1) ? ' chip--on' : ''}`}
                  aria-pressed={settings.filters.ranks.includes(rank - 1)}
                  onClick={() =>
                    patch({ filters: { ...settings.filters, ranks: toggleIn(settings.filters.ranks, rank - 1) } })
                  }
                >
                  {rank}
                </button>
              ))}
            </div>

            <span className="field__label">Quadrants</span>
            <div className="chip-row">
              {QUADRANTS.map((quadrant) => (
                <button
                  key={quadrant}
                  type="button"
                  className={`chip${settings.filters.quadrants.includes(quadrant) ? ' chip--on' : ''}`}
                  aria-pressed={settings.filters.quadrants.includes(quadrant)}
                  style={{ fontFamily: 'var(--font)', fontSize: '0.75rem' }}
                  onClick={() =>
                    patch({
                      filters: {
                        ...settings.filters,
                        quadrants: settings.filters.quadrants.includes(quadrant)
                          ? settings.filters.quadrants.filter((q) => q !== quadrant)
                          : [...settings.filters.quadrants, quadrant],
                      },
                    })
                  }
                >
                  {QUADRANT_LABELS[quadrant].split(',')[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="toggle-row">
              <span>Focus on weak squares</span>
              <input
                type="checkbox"
                checked={settings.adaptive}
                onChange={(event) => patch({ adaptive: event.target.checked })}
                data-testid="setting-adaptive"
              />
            </div>
            <div className="toggle-row">
              <span>Accuracy before speed</span>
              <input
                type="checkbox"
                checked={settings.accuracyFirst}
                onChange={(event) => patch({ accuracyFirst: event.target.checked })}
                data-testid="setting-accuracy-first"
              />
            </div>
            <div className="toggle-row">
              <span>Ask missed questions again later</span>
              <input
                type="checkbox"
                checked={settings.retry !== 'none'}
                onChange={(event) => patch({ retry: event.target.checked ? 'later' : 'none' })}
                data-testid="setting-retry"
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="button-row setup-start">
        <button
          type="button"
          className="button button--primary"
          onClick={() => onStart(validateSettings(settings))}
          data-testid="start-session"
        >
          Start
        </button>
      </div>
    </div>
  );
}
