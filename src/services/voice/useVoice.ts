/**
 * React binding for the voice capability.
 *
 * Nothing here ever throws into the render tree: an unavailable recognizer is
 * a state, not an error, and every other mode is unaffected by it.
 *
 * The hook deliberately does *not* request the microphone. Probing what the
 * device could do must never produce a permission dialog; only
 * `requestVoice()`, called from an explicit user action, does that.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkModelAvailability } from './recognizer';
import { checkMicrophoneSilently, microphoneApiAvailable, requestMicrophone } from './permission';
import { describeVoiceState, type VoiceState, type VoiceStatus } from './state';

export interface VoiceCapability extends VoiceStatus {
  /** Asks for the microphone. Safe to call repeatedly; never runs twice at once. */
  requestVoice: () => Promise<boolean>;
  /** Re-checks without prompting. Called on mount and on app resume. */
  refresh: () => Promise<void>;
  /**
   * How to reach the microphone permission when it is blocked.
   *
   * Opening the Android app-settings screen programmatically needs a native
   * plugin this build does not ship, so rather than a button that silently
   * does nothing the UI shows the path to follow. Adding a settings plugin is
   * noted as future work in CODEX_HANDOFF.md.
   */
  appSettingsHint: string;
}

export function useVoiceCapability(): VoiceCapability {
  const [state, setState] = useState<VoiceState>('model-checking');
  const requesting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useCallback((next: VoiceState) => {
    if (mounted.current) setState(next);
  }, []);

  /**
   * Works out the honest state without prompting.
   *
   * Order matters: a missing model makes permission irrelevant, so it is
   * checked first and the user is never asked for a microphone the app
   * cannot use.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (!microphoneApiAvailable()) {
      settle('unavailable');
      return;
    }

    const model = await checkModelAvailability();
    if (model !== 'ok') {
      settle(model === 'no-model' ? 'model-missing' : 'library-missing');
      return;
    }

    const permission = await checkMicrophoneSilently();
    if (permission === 'granted') {
      // Permission alone is not readiness, but it is as far as we can get
      // without opening a stream, which would light the microphone
      // indicator just for a status check.
      settle('ready');
      return;
    }
    if (permission === 'blocked') {
      settle('permission-blocked');
      return;
    }
    if (permission === 'unsupported') {
      settle('unavailable');
      return;
    }

    // null means "prompt" or the WebView could not answer.
    settle('permission-not-requested');
  }, [settle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Re-check when the app comes back to the foreground.
   *
   * This is the moment a permission granted in the Android dialog — or in the
   * system settings screen — becomes visible to the WebView. Without it the
   * app keeps showing a stale "permission declined" after the user has said
   * yes, which is exactly what was reported.
   */
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { App } = (await import('@capacitor/app')) as unknown as {
          App: {
            addListener: (
              event: 'resume',
              handler: () => void,
            ) => Promise<{ remove: () => void }>;
          };
        };
        const handle = await App.addListener('resume', () => void refresh());
        remove = () => handle.remove();
      } catch {
        // Not running under Capacitor; visibilitychange is enough.
      }
    })();

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      remove?.();
    };
  }, [refresh]);

  const requestVoice = useCallback(async (): Promise<boolean> => {
    // Guard against a double tap opening two system dialogs.
    if (requesting.current) return false;
    requesting.current = true;
    settle('permission-requesting');

    try {
      const outcome = await requestMicrophone();
      if (outcome === 'granted') {
        settle('ready');
        return true;
      }
      settle(
        outcome === 'blocked'
          ? 'permission-blocked'
          : outcome === 'unsupported'
            ? 'unavailable'
            : 'permission-denied',
      );
      return false;
    } catch {
      settle('permission-denied');
      return false;
    } finally {
      requesting.current = false;
    }
  }, [settle]);

  return {
    ...describeVoiceState(state),
    requestVoice,
    refresh,
    appSettingsHint: 'Android Settings → Apps → Bight → Permissions → Microphone',
  };
}
