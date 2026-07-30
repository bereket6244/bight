/**
 * Mode list and the setup sheet.
 *
 * Every mode and variant in the registry appears here - the list is generated,
 * so a mode can never be added to the app and forgotten in navigation.
 */

import { useState } from 'react';
import { MODES } from '../../core/training/registry';
import { defaultSettings, type SessionSettings } from '../../core/session/settings';
import type { ModeDefinition, ModeVariant } from '../../core/training/types';
import { useApp } from '../state/AppContext';
import { SessionSetup } from './SessionSetup';

export interface ModesScreenProps {
  onStart: (settings: SessionSettings) => void;
}

export function ModesScreen({ onStart }: ModesScreenProps) {
  const app = useApp();
  const [chosen, setChosen] = useState<{ mode: ModeDefinition; variant: ModeVariant } | null>(null);

  if (chosen !== null) {
    const saved = app.preferences.savedSettings[chosen.mode.id];
    const base: SessionSettings = {
      ...(saved ?? defaultSettings(chosen.mode.id, chosen.variant.id)),
      modeId: chosen.mode.id,
      variantId: chosen.variant.id,
      sound: app.preferences.sound,
      haptics: app.preferences.haptics,
      speakPrompts: app.preferences.speakPrompts,
      voiceInput: app.preferences.voiceInput,
    };
    return (
      <SessionSetup
        mode={chosen.mode}
        variant={chosen.variant}
        initial={base}
        onStart={onStart}
        onBack={() => setChosen(null)}
      />
    );
  }

  return (
    <div data-testid="modes-screen">
      <h1 className="screen-title">Modes</h1>
      <div className="mode-list">
        {MODES.map((mode) => (
          <div className="card" key={mode.id}>
            <h2 className="card__title">{mode.title}</h2>
            <p className="card__subtitle" style={{ marginBottom: 10 }}>
              {mode.summary}
            </p>
            <div className="chip-row">
              {mode.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  className="chip"
                  style={{ fontFamily: 'var(--font)' }}
                  onClick={() => setChosen({ mode, variant })}
                  data-testid={`variant-${mode.id}-${variant.id}`}
                >
                  {variant.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
