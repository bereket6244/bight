/**
 * React binding for the voice service.
 *
 * Availability is probed once, without touching the microphone. Nothing here
 * throws into the render tree: an unavailable recognizer is a state, not an
 * error, and the rest of the app is unaffected by it.
 */

import { useCallback, useEffect, useState } from 'react';
import { checkVoiceAvailability, type VoiceAvailability } from './recognizer';

export function useVoiceAvailability(): VoiceAvailability {
  const [availability, setAvailability] = useState<VoiceAvailability>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await checkVoiceAvailability();
        if (!cancelled) setAvailability(result);
      } catch (error) {
        if (!cancelled) setAvailability({ state: 'unavailable', reason: (error as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return availability;
}

/**
 * Requests microphone access on demand.
 *
 * Deliberately separate from `useVoiceAvailability`: probing what the device
 * *could* do must never trigger a permission prompt. Only an explicit user
 * action calls this.
 */
export function useMicrophonePermission(): {
  state: 'idle' | 'requesting' | 'granted' | 'denied';
  reason: string | null;
  request: () => Promise<boolean>;
} {
  const [state, setState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [reason, setReason] = useState<string | null>(null);

  const request = useCallback(async (): Promise<boolean> => {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The probe is over; release the microphone immediately.
      stream.getTracks().forEach((track) => track.stop());
      setState('granted');
      setReason(null);
      return true;
    } catch (error) {
      setState('denied');
      setReason((error as Error).message);
      return false;
    }
  }, []);

  return { state, reason, request };
}

/** One short sentence for the Settings row. */
export function voiceStatusLabel(availability: VoiceAvailability): string {
  switch (availability.state) {
    case 'checking':
      return 'Checking whether offline recognition is available…';
    case 'ready':
      return 'Ready. Recognition runs on this device; nothing is sent anywhere.';
    case 'denied':
      return `Microphone access was refused: ${availability.reason}`;
    case 'unavailable':
      return availability.reason;
  }
}

/** A few words for the compact setup row. */
export function voiceShortStatus(availability: VoiceAvailability): string {
  switch (availability.state) {
    case 'checking':
      return 'Checking…';
    case 'ready':
      return 'Available';
    case 'denied':
      return 'Microphone blocked';
    case 'unavailable':
      return 'Not available in this build';
  }
}

/** The badge text shown next to the Voice answers heading. */
export function voiceBadge(availability: VoiceAvailability): string {
  switch (availability.state) {
    case 'checking':
      return 'Checking';
    case 'ready':
      return 'Available';
    case 'denied':
      return 'Permission needed';
    case 'unavailable':
      return 'Unavailable';
  }
}
