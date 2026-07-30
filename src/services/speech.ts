/**
 * Prompt pronunciation via the system voice.
 *
 * Optional in every sense: if speech synthesis is missing, has no voices, or
 * throws, the call resolves quietly and the session carries on silently.
 * Android's system TTS works offline once a voice is installed, which is why
 * this is acceptable in an offline-only app - and why it is never required.
 */

export function speechAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  } catch {
    return false;
  }
}

export async function speak(text: string): Promise<void> {
  if (!speechAvailable()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    synth.speak(utterance);
  } catch {
    // Pronunciation is a nicety; never surface a failure.
  }
}

export function stopSpeaking(): void {
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore.
  }
}
