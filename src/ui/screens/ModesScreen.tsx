/**
 * Mode browser, grouped by what you want to practice.
 *
 * The first version rendered one card per generator variant — nine nearly
 * identical knight cards, five "move the piece" cards. Cards are now one per
 * mode with a single line of purpose; variants live inside setup, where they
 * sit alongside the other settings they resemble.
 */

import { useState } from 'react';
import { modesByCategory } from '../../core/training/registry';
import { defaultSettings, type SessionSettings } from '../../core/session/settings';
import type { ModeDefinition } from '../../core/training/types';
import { useApp } from '../state/AppContext';
import { SessionSetup } from './SessionSetup';

export interface ModesScreenProps {
  onStart: (settings: SessionSettings) => void;
}

export function ModesScreen({ onStart }: ModesScreenProps) {
  const app = useApp();
  const [chosen, setChosen] = useState<ModeDefinition | null>(null);

  if (chosen !== null) {
    const saved = app.preferences.savedSettings[chosen.id];
    const base: SessionSettings = {
      ...(saved ?? defaultSettings(chosen.id, chosen.variants[0]!.id)),
      modeId: chosen.id,
      // A saved variant that no longer exists falls back to the first one.
      variantId:
        chosen.variants.some((v) => v.id === saved?.variantId) && saved !== undefined
          ? saved.variantId
          : chosen.variants[0]!.id,
      sound: app.preferences.sound,
      haptics: app.preferences.haptics,
      speakPrompts: app.preferences.speakPrompts,
      voiceInput: app.preferences.voiceInput,
    };

    return <SessionSetup mode={chosen} initial={base} onStart={onStart} onBack={() => setChosen(null)} />;
  }

  return (
    <div data-testid="modes-screen">
      <h1 className="screen-title">Practice</h1>

      {modesByCategory().map((group) => (
        <section key={group.category}>
          <h2 className="section-title">{group.label}</h2>
          <div className="mode-list">
            {group.modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className="mode-card"
                onClick={() => setChosen(mode)}
                data-testid={`mode-${mode.id}`}
              >
                <span className="mode-card__title">{mode.title}</span>
                <span className="mode-card__summary">{mode.summary}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
