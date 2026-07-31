/**
 * Connects the recognizer to a running practice session.
 *
 * Before this existed, `startListening()` was never called from anywhere in
 * the app. Settings had a working-looking toggle, the model shipped in the
 * APK, the grammar had 29 passing tests — and no session ever opened the
 * microphone. Turning voice on did nothing at all.
 *
 * Rules this enforces, from the specification:
 *
 *  - the microphone opens only when a voice-enabled session actually starts;
 *  - the grammar is rebuilt for each question, so recognition is constrained
 *    to what the current exercise can accept;
 *  - a confident answer is routed to the *same* grader touch input uses;
 *  - silence, low confidence and recognizer failures are never chess mistakes;
 *  - the microphone stops on pause, exit, completion, unmount and error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildVocabulary, type VoiceResult } from './grammar';
import { startListening, type VoiceSession } from './recognizer';
import type { Question } from '../../core/training/types';

export interface VoiceSessionOptions {
  /** Whether the microphone should be open at all right now. */
  active: boolean;
  /** The question being answered, used to build the grammar. */
  question: Question | null;
  /** Called only for a confidently recognized, parseable answer. */
  onCoordinate: (square: string) => void;
  onColor: (color: 'light' | 'dark') => void;
}

export interface VoiceSessionStatus {
  listening: boolean;
  /** What the recognizer last thought it heard, for the on-screen readout. */
  heard: string | null;
  /** Set when the utterance was too unclear to act on. */
  unclear: boolean;
  error: string | null;
}

/** Which answer kinds can be spoken at all. */
function vocabularyFor(question: Question | null): { words: string[]; colors: boolean } | null {
  if (question === null) return null;
  switch (question.expected.kind) {
    case 'coordinate':
      return { words: buildVocabulary({ coordinates: true, colors: false }), colors: false };
    case 'square-color':
      return { words: buildVocabulary({ coordinates: false, colors: true }), colors: true };
    default:
      // Tapping a square or moving a piece cannot sensibly be spoken.
      return null;
  }
}

export function useVoiceSession(options: VoiceSessionOptions): VoiceSessionStatus {
  const { active, question, onCoordinate, onColor } = options;

  const [status, setStatus] = useState<VoiceSessionStatus>({
    listening: false,
    heard: null,
    unclear: false,
    error: null,
  });

  const sessionRef = useRef<VoiceSession | null>(null);
  // Handlers are held in a ref so restarting the recognizer is driven purely
  // by the grammar changing, not by a new render.
  const handlers = useRef({ onCoordinate, onColor });
  handlers.current = { onCoordinate, onColor };

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus((s) => ({ ...s, listening: false }));
  }, []);

  const grammar = vocabularyFor(question);
  const grammarKey = grammar === null ? null : `${grammar.colors}:${grammar.words.join(',')}`;

  useEffect(() => {
    let cancelled = false;

    if (!active || grammar === null) {
      stop();
      return;
    }

    void (async () => {
      try {
        const session = await startListening(
          (result: VoiceResult) => {
            // A misheard word must never be scored as a chess mistake.
            if (result.lowConfidence || result.intent.kind === 'unrecognised') {
              setStatus((s) => ({ ...s, heard: result.transcript || null, unclear: true }));
              return;
            }
            setStatus((s) => ({ ...s, heard: result.transcript, unclear: false }));

            if (result.intent.kind === 'coordinate') handlers.current.onCoordinate(result.intent.square);
            else if (result.intent.kind === 'color') handlers.current.onColor(result.intent.color);
          },
          { vocabulary: grammar.words, colors: grammar.colors },
        );

        if (cancelled) {
          session.stop();
          return;
        }
        sessionRef.current = session;
        setStatus((s) => ({ ...s, listening: true, error: null }));
      } catch (error) {
        if (cancelled) return;
        // Voice failing is never fatal: the keypad is still there.
        setStatus({
          listening: false,
          heard: null,
          unclear: false,
          error: (error as Error).message,
        });
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, grammarKey, stop]);

  // Belt and braces: release the microphone if the component goes away.
  useEffect(() => stop, [stop]);

  return status;
}
