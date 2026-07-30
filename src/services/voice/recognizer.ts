/**
 * Offline speech recognition, backed by Vosk in the WebView.
 *
 * Follows the approach Lichess uses: a small Vosk model loaded locally, with
 * recognition constrained to a per-exercise grammar rather than open dictation.
 * Nothing is sent anywhere - the model runs inside the app.
 *
 * The model itself is *not* committed to the repository. It is fetched once by
 * `scripts/fetch-voice-model.mjs` into `public/models/`, because redistributing
 * a 40 MB binary through git would bloat every clone. When the model is absent
 * the recogniser reports `unavailable` and the app carries on with the keypad,
 * which is the documented fallback.
 */

import { buildVocabulary, interpretCandidates, type ParseOptions, type VoiceResult } from './grammar';

export type VoiceAvailability =
  | { state: 'checking' }
  | { state: 'ready' }
  | { state: 'unavailable'; reason: string }
  | { state: 'denied'; reason: string };

/** Where the fetch script puts the model, relative to the app root. */
export const MODEL_PATH = 'models/vosk-model-small-en-us-0.15.tar.gz';

export interface RecognizerOptions extends ParseOptions {
  /** Restricts recognition to the words this exercise can accept. */
  vocabulary?: string[];
}

interface VoskModel {
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizer;
  terminate?: () => void;
}

interface VoskRecognizer {
  on: (event: 'result' | 'partialresult', handler: (message: unknown) => void) => void;
  acceptWaveform: (buffer: AudioBuffer) => void;
  remove?: () => void;
}

let cachedModel: VoskModel | null = null;
let cachedFailure: string | null = null;

/**
 * Checks whether recognition could run, without asking for the microphone.
 * Permission is only requested when a session actually starts listening.
 */
export async function checkVoiceAvailability(): Promise<VoiceAvailability> {
  if (typeof window === 'undefined') {
    return { state: 'unavailable', reason: 'No browser environment' };
  }
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    return { state: 'unavailable', reason: 'This device exposes no microphone API' };
  }
  if (cachedFailure !== null) {
    return { state: 'unavailable', reason: cachedFailure };
  }

  try {
    // Probe for the model file without downloading all of it.
    const response = await fetch(MODEL_PATH, { method: 'HEAD' });
    if (!response.ok) {
      const reason = 'The offline voice model is not bundled in this build.';
      cachedFailure = reason;
      return { state: 'unavailable', reason };
    }
  } catch {
    const reason = 'The offline voice model is not bundled in this build.';
    cachedFailure = reason;
    return { state: 'unavailable', reason };
  }

  try {
    await import('vosk-browser');
  } catch {
    const reason = 'The Vosk recognition library is not installed in this build.';
    cachedFailure = reason;
    return { state: 'unavailable', reason };
  }

  return { state: 'ready' };
}

async function loadModel(): Promise<VoskModel> {
  if (cachedModel !== null) return cachedModel;
  const vosk = (await import('vosk-browser')) as unknown as {
    createModel: (path: string) => Promise<VoskModel>;
  };
  cachedModel = await vosk.createModel(MODEL_PATH);
  return cachedModel;
}

export interface VoiceSession {
  stop: () => void;
}

/**
 * Starts listening and calls `onResult` for each complete utterance.
 *
 * Rejects if the microphone is refused or the model cannot load; callers treat
 * a rejection as "voice is off for this session" and keep the keypad.
 */
export async function startListening(
  onResult: (result: VoiceResult) => void,
  options: RecognizerOptions = {},
): Promise<VoiceSession> {
  const grammar = options.vocabulary ?? buildVocabulary({ colors: options.colors ?? false });

  // Requesting the stream is what triggers the Android permission prompt, and
  // it happens here - not at launch, and not when merely browsing settings.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  let model: VoskModel;
  try {
    model = await loadModel();
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(`Voice model failed to load: ${(error as Error).message}`);
  }

  const recognizer = new model.KaldiRecognizer(16000, JSON.stringify(grammar));

  recognizer.on('result', (message: unknown) => {
    const payload = message as {
      result?: { text?: string; result?: Array<{ conf?: number }> };
    };
    const text = payload.result?.text ?? '';
    const words = payload.result?.result ?? [];
    // Vosk reports per-word confidence; the utterance is only as trustworthy
    // as its weakest word.
    const confidence =
      words.length === 0 ? 0 : Math.min(...words.map((word) => word.conf ?? 0));
    onResult(interpretCandidates([{ transcript: text, confidence }], options));
  });

  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    try {
      recognizer.acceptWaveform(event.inputBuffer);
    } catch {
      // A dropped buffer is not worth interrupting the session for.
    }
  };

  source.connect(processor);
  processor.connect(context.destination);

  return {
    stop: () => {
      try {
        processor.disconnect();
        source.disconnect();
        void context.close();
        recognizer.remove?.();
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Best-effort teardown.
      }
    },
  };
}

/** Clears cached state so a retry re-probes; used after installing a model. */
export function resetVoiceCache(): void {
  cachedModel?.terminate?.();
  cachedModel = null;
  cachedFailure = null;
}
