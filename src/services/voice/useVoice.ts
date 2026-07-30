/**
 * React binding for the voice service.
 *
 * Availability is probed once and cached. Nothing here ever throws into the
 * render tree: an unavailable recogniser is a state, not an error, so the rest
 * of the app is unaffected.
 */

import { useEffect, useState } from 'react';
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
        if (!cancelled) {
          setAvailability({ state: 'unavailable', reason: (error as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return availability;
}

export function voiceStatusLabel(availability: VoiceAvailability): string {
  switch (availability.state) {
    case 'checking':
      return 'Checking whether offline recognition is available…';
    case 'ready':
      return 'Offline recognition is available on this device.';
    case 'denied':
      return `Microphone access was refused: ${availability.reason}`;
    case 'unavailable':
      return `Voice answers are unavailable: ${availability.reason}`;
  }
}
