/**
 * Voice state machine tests.
 *
 * These pin the Android failure reported from a real device: Settings showed
 * "Voice answers" checked and "Ready — recognition runs on this device"
 * before the microphone had ever been requested, then reported a denial after
 * the user granted permission.
 */

import { describe, expect, it } from 'vitest';
import {
  describeVoiceState,
  effectiveVoiceEnabled,
  isVoiceRecoverable,
  isVoiceUsable,
  voiceBadgeText,
  type VoiceState,
} from './state';

const ALL_STATES: VoiceState[] = [
  'model-checking',
  'model-missing',
  'library-missing',
  'permission-not-requested',
  'permission-requesting',
  'permission-denied',
  'permission-blocked',
  'permission-granted',
  'recognizer-loading',
  'ready',
  'listening',
  'recognizer-error',
  'unavailable',
];

describe('what counts as usable', () => {
  it('treats only ready and listening as usable', () => {
    for (const state of ALL_STATES) {
      const expected = state === 'ready' || state === 'listening';
      expect(isVoiceUsable(state), state).toBe(expected);
    }
  });

  /**
   * The core of the reported bug: having the model was reported as "Ready".
   * Model presence alone must never be usable, because it says nothing about
   * whether the microphone was ever granted.
   */
  it('never calls a state usable merely because the model exists', () => {
    expect(isVoiceUsable('permission-not-requested')).toBe(false);
    expect(isVoiceUsable('permission-granted')).toBe(false);
    expect(isVoiceUsable('recognizer-loading')).toBe(false);
  });

  it('marks the states a user can act on', () => {
    expect(isVoiceRecoverable('permission-not-requested')).toBe(true);
    expect(isVoiceRecoverable('permission-denied')).toBe(true);
    expect(isVoiceRecoverable('permission-blocked')).toBe(true);
    expect(isVoiceRecoverable('recognizer-error')).toBe(true);
    expect(isVoiceRecoverable('model-missing')).toBe(false);
    expect(isVoiceRecoverable('ready')).toBe(false);
  });
});

describe('reconciling the stored preference', () => {
  /**
   * A stored `voiceInput: true` used to render straight into the checkbox, so
   * a preference from a previous install showed voice as on with no permission
   * behind it. The preference is an intention, never a capability.
   */
  it('does not show voice as enabled when permission was never requested', () => {
    expect(effectiveVoiceEnabled(true, 'permission-not-requested')).toBe(false);
  });

  it('does not show voice as enabled when permission was denied or blocked', () => {
    expect(effectiveVoiceEnabled(true, 'permission-denied')).toBe(false);
    expect(effectiveVoiceEnabled(true, 'permission-blocked')).toBe(false);
  });

  it('does not show voice as enabled when the model is missing', () => {
    expect(effectiveVoiceEnabled(true, 'model-missing')).toBe(false);
    expect(effectiveVoiceEnabled(true, 'library-missing')).toBe(false);
  });

  it('shows voice as enabled only when the user asked for it and it works', () => {
    expect(effectiveVoiceEnabled(true, 'ready')).toBe(true);
    expect(effectiveVoiceEnabled(true, 'listening')).toBe(true);
  });

  it('never enables voice the user did not ask for', () => {
    for (const state of ALL_STATES) {
      expect(effectiveVoiceEnabled(false, state), state).toBe(false);
    }
  });
});

describe('what the user is told', () => {
  it('describes every state without leaving a gap', () => {
    for (const state of ALL_STATES) {
      const status = describeVoiceState(state);
      expect(status.state).toBe(state);
      expect(status.detail.length, state).toBeGreaterThan(0);
      expect(voiceBadgeText(state).length, state).toBeGreaterThan(0);
    }
  });

  it('never claims on-device recognition before it has been proven', () => {
    for (const state of ALL_STATES) {
      if (isVoiceUsable(state)) continue;
      expect(describeVoiceState(state).detail.toLowerCase(), state).not.toContain(
        'runs on this device',
      );
    }
  });

  it('offers a retry exactly where one would help', () => {
    expect(describeVoiceState('permission-not-requested').canRetry).toBe(true);
    expect(describeVoiceState('permission-denied').canRetry).toBe(true);
    expect(describeVoiceState('recognizer-error').canRetry).toBe(true);
    // Asking again cannot help when the OS will not prompt.
    expect(describeVoiceState('permission-blocked').canRetry).toBe(false);
    expect(describeVoiceState('model-missing').canRetry).toBe(false);
  });

  it('points at system settings only when that is the only route', () => {
    for (const state of ALL_STATES) {
      const expected = state === 'permission-blocked';
      expect(describeVoiceState(state).needsAppSettings, state).toBe(expected);
    }
  });

  it('says permission has not been requested rather than "Ready"', () => {
    const status = describeVoiceState('permission-not-requested');
    expect(status.detail).toMatch(/not been requested/i);
    expect(voiceBadgeText('permission-not-requested')).toBe('Needs permission');
  });

  it('keeps every message short enough for a settings row', () => {
    for (const state of ALL_STATES) {
      expect(describeVoiceState(state).detail.length, state).toBeLessThan(120);
      expect(voiceBadgeText(state).length, state).toBeLessThan(20);
    }
  });
});
