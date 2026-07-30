/**
 * Feedback tones, synthesised with the Web Audio API.
 *
 * Generating them avoids bundling audio files and keeps the app fully offline
 * with nothing to download. The context is created lazily on first use, since
 * mobile browsers only allow audio to start from a user gesture.
 */

export type ToneKind = 'correct' | 'wrong' | 'finish';

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (context !== null) return context;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null;
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

const TONES: Record<ToneKind, { frequency: number; durationMs: number; type: OscillatorType }> = {
  // Deliberately short and quiet: the spec asks for restraint, not fanfare.
  correct: { frequency: 660, durationMs: 90, type: 'sine' },
  wrong: { frequency: 180, durationMs: 150, type: 'triangle' },
  finish: { frequency: 520, durationMs: 220, type: 'sine' },
};

export function playTone(kind: ToneKind): void {
  const ctx = ensureContext();
  if (ctx === null) return;

  try {
    if (ctx.state === 'suspended') void ctx.resume();

    const { frequency, durationMs, type } = TONES[kind];
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const now = ctx.currentTime;
    const seconds = durationMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + seconds);
  } catch {
    // Sound is optional; a failure here must never interrupt a session.
  }
}

export function soundAvailable(): boolean {
  return ensureContext() !== null;
}
