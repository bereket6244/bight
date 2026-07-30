/**
 * Session setup.
 *
 * Every control has a sensible default already applied, so "Start" is always
 * one tap away; the options are there for people who want them, not a form to
 * be filled in before practising.
 */

import { useState } from 'react';
import { FILE_LETTERS } from '../../core/chess/types';
import { QUADRANT_LABELS, QUADRANTS } from '../../core/chess/square';
import { validateSettings, type SessionSettings } from '../../core/session/settings';
import type { ModeDefinition, ModeVariant } from '../../core/training/types';

export interface SessionSetupProps {
  mode: ModeDefinition;
  variant: ModeVariant;
  initial: SessionSettings;
  onStart: (settings: SessionSettings) => void;
  onBack: () => void;
}

export function SessionSetup({ mode, variant, initial, onStart, onBack }: SessionSetupProps) {
  const [settings, setSettings] = useState<SessionSettings>(initial);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const patch = (changes: Partial<SessionSettings>): void =>
    setSettings((current) => ({ ...current, ...changes }));

  const toggleIn = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);

  return (
    <div data-testid="session-setup">
      <button type="button" className="button button--ghost" onClick={onBack} style={{ marginBottom: 8 }}>
        ← Modes
      </button>
      <h1 className="screen-title">{mode.title}</h1>
      <div className="card">
        <h2 className="card__title">{variant.label}</h2>
        <p className="card__subtitle">{variant.description}</p>
        {variant.semantics !== null ? (
          <p className="card__subtitle" style={{ marginTop: 8 }}>
            <span className="badge">
              {variant.semantics === 'geometry' ? 'Geometry' : 'Legal moves'}
            </span>
          </p>
        ) : null}
      </div>

      <div className="card">
        <label className="field">
          <span className="field__label">Session length</span>
          <select
            className="field__control"
            data-testid="setting-limit"
            value={settings.limit.kind}
            onChange={(event) => {
              const kind = event.target.value;
              patch({
                limit:
                  kind === 'questions'
                    ? { kind: 'questions', count: 20 }
                    : kind === 'total-time'
                      ? { kind: 'total-time', seconds: 180 }
                      : { kind: 'endless' },
              });
            }}
          >
            <option value="questions">Fixed number of questions</option>
            <option value="total-time">Timed session</option>
            <option value="endless">Endless</option>
          </select>
        </label>

        {settings.limit.kind === 'questions' ? (
          <label className="field">
            <span className="field__label">Questions: {settings.limit.count}</span>
            <input
              className="field__control"
              type="range"
              min={5}
              max={100}
              step={5}
              value={settings.limit.count}
              onChange={(event) => patch({ limit: { kind: 'questions', count: Number(event.target.value) } })}
            />
          </label>
        ) : null}

        {settings.limit.kind === 'total-time' ? (
          <label className="field">
            <span className="field__label">
              Session time: {Math.round(settings.limit.seconds / 60)} min
            </span>
            <input
              className="field__control"
              type="range"
              min={60}
              max={900}
              step={30}
              value={settings.limit.seconds}
              onChange={(event) =>
                patch({ limit: { kind: 'total-time', seconds: Number(event.target.value) } })
              }
            />
          </label>
        ) : null}

        <label className="field">
          <span className="field__label">Time per question</span>
          <select
            className="field__control"
            data-testid="setting-timer"
            value={settings.questionTimer.kind === 'none' ? 'none' : String(settings.questionTimer.seconds)}
            onChange={(event) => {
              const value = event.target.value;
              patch({
                questionTimer:
                  value === 'none' ? { kind: 'none' } : { kind: 'per-question', seconds: Number(value) },
              });
            }}
          >
            <option value="none">Untimed</option>
            <option value="3">3 seconds</option>
            <option value="5">5 seconds</option>
            <option value="10">10 seconds</option>
            <option value="20">20 seconds</option>
          </select>
        </label>

        <div className="toggle-row">
          <span>Accuracy first</span>
          <input
            type="checkbox"
            checked={settings.accuracyFirst}
            onChange={(event) => patch({ accuracyFirst: event.target.checked })}
            data-testid="setting-accuracy-first"
          />
        </div>
        <p className="card__subtitle">
          Holds the per-question timer back until you are answering accurately.
        </p>
      </div>

      <div className="card">
        <label className="field">
          <span className="field__label">Board orientation</span>
          <select
            className="field__control"
            data-testid="setting-orientation"
            value={settings.orientation}
            onChange={(event) => patch({ orientation: event.target.value as SessionSettings['orientation'] })}
          >
            <option value="white">White at the bottom</option>
            <option value="black">Black at the bottom</option>
            <option value="random">Random each question</option>
            <option value="alternating">Alternating</option>
          </select>
        </label>

        <label className="field">
          <span className="field__label">Coordinate labels</span>
          <select
            className="field__control"
            data-testid="setting-labels"
            value={settings.labels}
            onChange={(event) => patch({ labels: event.target.value as SessionSettings['labels'] })}
          >
            <option value="always">Always shown</option>
            <option value="never">Hidden</option>
            <option value="briefly">Briefly shown</option>
          </select>
        </label>

        {mode.supportedLayouts.includes('starting') ? (
          <label className="field">
            <span className="field__label">Pieces</span>
            <select
              className="field__control"
              data-testid="setting-layout"
              value={settings.layout}
              onChange={(event) => patch({ layout: event.target.value as SessionSettings['layout'] })}
            >
              <option value="empty">Empty board</option>
              <option value="starting">Starting position</option>
            </select>
          </label>
        ) : null}
      </div>

      <button
        type="button"
        className="button button--ghost"
        onClick={() => setShowAdvanced((v) => !v)}
        style={{ width: '100%', marginBottom: 'var(--gap)' }}
      >
        {showAdvanced ? 'Hide' : 'Show'} board filters and feedback options
      </button>

      {showAdvanced ? (
        <>
          <div className="card">
            <span className="field__label">Files</span>
            <div className="chip-row" style={{ marginBottom: 'var(--gap)' }}>
              {FILE_LETTERS.map((letter, index) => (
                <button
                  key={letter}
                  type="button"
                  className={`chip${settings.filters.files.includes(index) ? ' chip--on' : ''}`}
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
            <p className="card__subtitle" style={{ marginTop: 10 }}>
              Files and ranks combine: choosing file e and rank 4 asks only about e4.
            </p>
          </div>

          <div className="card">
            <label className="field">
              <span className="field__label">Feedback</span>
              <select
                className="field__control"
                value={settings.feedback}
                onChange={(event) => patch({ feedback: event.target.value as SessionSettings['feedback'] })}
              >
                <option value="immediate">After every question</option>
                <option value="end-of-session">At the end only</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">Mistakes</span>
              <select
                className="field__control"
                value={settings.retry}
                onChange={(event) => patch({ retry: event.target.value as SessionSettings['retry'] })}
              >
                <option value="none">Move on</option>
                <option value="immediate">Retry straight away</option>
                <option value="later">Come back to it later</option>
                <option value="both">Both</option>
              </select>
            </label>

            <div className="toggle-row">
              <span>Adaptive practice</span>
              <input
                type="checkbox"
                checked={settings.adaptive}
                onChange={(event) => patch({ adaptive: event.target.checked })}
              />
            </div>
            <div className="toggle-row">
              <span>Show destination hints</span>
              <input
                type="checkbox"
                checked={settings.showHints}
                onChange={(event) => patch({ showHints: event.target.checked })}
              />
            </div>
            <div className="toggle-row">
              <span>Speak the coordinate</span>
              <input
                type="checkbox"
                checked={settings.speakPrompts}
                onChange={(event) => patch({ speakPrompts: event.target.checked })}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="button-row">
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
