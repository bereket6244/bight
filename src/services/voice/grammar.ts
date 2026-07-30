/**
 * Voice grammar and parsing.
 *
 * Modelled on the approach Lichess uses for its Vosk integration: rather than
 * open-ended dictation, recognition is restricted to a small vocabulary built
 * from the current exercise, and the transcript is parsed against that
 * vocabulary. A restricted grammar is what makes offline recognition on a
 * phone accurate enough to be useful.
 *
 * This module is pure text handling, so the whole parser is unit-testable
 * without audio or a model.
 */

import { normalizeSquare } from '../../core/chess/square';
import type { SquareName } from '../../core/chess/types';

export type VoiceIntent =
  | { kind: 'coordinate'; square: SquareName }
  | { kind: 'color'; color: 'light' | 'dark' }
  | { kind: 'command'; command: 'repeat' | 'skip' | 'submit' | 'undo' }
  | { kind: 'unrecognised'; transcript: string };

/**
 * File aliases.
 *
 * The NATO word is the primary form because b/d/e/g are the classic confusion
 * set over a phone microphone, and "bravo/delta/echo/golf" are unambiguous.
 * Plain letters and a few common mishearings are accepted too.
 */
export const FILE_ALIASES: Record<string, string[]> = {
  a: ['a', 'alpha', 'alfa', 'ay', 'eh'],
  b: ['b', 'bravo', 'bee', 'be', 'be4', 'beat'],
  c: ['c', 'charlie', 'see', 'sea', 'si'],
  // "the" is deliberately not a d-alias: it is far more often a filler word
  // ("the square e four") than an attempt to say the d-file.
  d: ['d', 'delta', 'dee', 'de'],
  e: ['e', 'echo', 'ee', 'eee'],
  f: ['f', 'foxtrot', 'ef', 'eff'],
  g: ['g', 'golf', 'gee', 'jee', 'ji'],
  h: ['h', 'hotel', 'aitch', 'aych', 'age'],
};

export const RANK_ALIASES: Record<string, string[]> = {
  '1': ['1', 'one', 'won'],
  '2': ['2', 'two', 'to', 'too'],
  '3': ['3', 'three', 'tree'],
  '4': ['4', 'four', 'for', 'fore'],
  '5': ['5', 'five'],
  '6': ['6', 'six', 'sicks'],
  '7': ['7', 'seven'],
  '8': ['8', 'eight', 'ate'],
};

export const COLOR_ALIASES: Record<'light' | 'dark', string[]> = {
  light: ['light', 'white', 'lite'],
  dark: ['dark', 'black', 'darc'],
};

export const COMMAND_ALIASES: Record<'repeat' | 'skip' | 'submit' | 'undo', string[]> = {
  repeat: ['repeat', 'again', 'say again'],
  skip: ['skip', 'pass', 'next'],
  submit: ['submit', 'done', 'go'],
  undo: ['undo', 'clear', 'cancel'],
};

/**
 * Words with no meaning that speakers add: "letter e four", "square e4".
 * Note "a" is absent - it is the a-file, and stripping it would make every
 * square on that file unsayable.
 */
const FILLER_WORDS = new Set(['letter', 'square', 'the', 'is', 'on', 'at', 'it', 'its']);

function invert(aliases: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [canonical, words] of Object.entries(aliases)) {
    for (const word of words) out.set(word, canonical);
  }
  return out;
}

const FILE_LOOKUP = invert(FILE_ALIASES);
const RANK_LOOKUP = invert(RANK_ALIASES);

/** The complete word list handed to the recogniser as its grammar. */
export function buildVocabulary(options: {
  coordinates?: boolean;
  colors?: boolean;
  commands?: boolean;
} = {}): string[] {
  const { coordinates = true, colors = false, commands = true } = options;
  const words = new Set<string>();

  if (coordinates) {
    for (const list of Object.values(FILE_ALIASES)) for (const word of list) words.add(word);
    for (const list of Object.values(RANK_ALIASES)) for (const word of list) words.add(word);
  }
  if (colors) {
    for (const list of Object.values(COLOR_ALIASES)) for (const word of list) words.add(word);
  }
  if (commands) {
    for (const list of Object.values(COMMAND_ALIASES)) {
      for (const phrase of list) for (const word of phrase.split(' ')) words.add(word);
    }
  }

  // Vosk expects a JSON array of words; single characters are kept because the
  // model can emit bare letters.
  return [...words].sort();
}

function tokenise(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !FILLER_WORDS.has(token));
}

/**
 * Splits a token like "e4" or "b3" that the recogniser emitted as one word.
 * Returns null when the token is not a compact coordinate.
 */
function splitCompactCoordinate(token: string): [string, string] | null {
  const match = /^([a-h])([1-8])$/.exec(token);
  if (match === null) return null;
  return [match[1] as string, match[2] as string];
}

export interface ParseOptions {
  /** Accept light/dark answers. */
  colors?: boolean;
  /** Accept control words. */
  commands?: boolean;
}

/**
 * Parses a transcript into an intent.
 *
 * Deliberately conservative: anything not clearly a coordinate, colour or
 * command comes back as `unrecognised`, which the session treats as "not an
 * answer" rather than as a wrong answer.
 */
export function parseVoiceInput(transcript: string, options: ParseOptions = {}): VoiceIntent {
  const { colors = false, commands = true } = options;
  const tokens = tokenise(transcript);
  if (tokens.length === 0) return { kind: 'unrecognised', transcript };

  if (commands) {
    const joined = tokens.join(' ');
    for (const [command, phrases] of Object.entries(COMMAND_ALIASES)) {
      if (phrases.some((phrase) => joined === phrase || tokens.includes(phrase))) {
        return { kind: 'command', command: command as 'repeat' | 'skip' | 'submit' | 'undo' };
      }
    }
  }

  if (colors) {
    for (const [color, words] of Object.entries(COLOR_ALIASES)) {
      if (tokens.some((token) => words.includes(token))) {
        return { kind: 'color', color: color as 'light' | 'dark' };
      }
    }
  }

  // "e4" as a single token.
  for (const token of tokens) {
    const compact = splitCompactCoordinate(token);
    if (compact !== null) {
      const square = normalizeSquare(`${compact[0]}${compact[1]}`);
      if (square !== null) return { kind: 'coordinate', square };
    }
  }

  // A file word followed later by a rank word. Scanning rather than requiring
  // adjacency tolerates the recogniser inserting a stray token between them.
  let file: string | null = null;
  for (const token of tokens) {
    if (file === null) {
      const candidate = FILE_LOOKUP.get(token);
      if (candidate !== undefined) {
        file = candidate;
        continue;
      }
    } else {
      const rank = RANK_LOOKUP.get(token);
      if (rank !== undefined) {
        const square = normalizeSquare(`${file}${rank}`);
        if (square !== null) return { kind: 'coordinate', square };
      }
    }
  }

  return { kind: 'unrecognised', transcript };
}

/**
 * Confidence below this is treated as "did not hear you" rather than as an
 * answer, so a misheard word is never scored as a chess mistake.
 */
export const MIN_CONFIDENCE = 0.6;

export interface RecognitionCandidate {
  transcript: string;
  confidence: number;
}

export interface VoiceResult {
  intent: VoiceIntent;
  confidence: number;
  transcript: string;
  /** True when the utterance was too unclear to score either way. */
  lowConfidence: boolean;
}

/**
 * Picks the best candidate and decides whether it is confident enough to count.
 *
 * A low-confidence result keeps its parsed intent so the UI can show what it
 * thought it heard, but `lowConfidence` tells the session not to score it.
 */
export function interpretCandidates(
  candidates: readonly RecognitionCandidate[],
  options: ParseOptions = {},
): VoiceResult {
  if (candidates.length === 0) {
    return {
      intent: { kind: 'unrecognised', transcript: '' },
      confidence: 0,
      transcript: '',
      lowConfidence: true,
    };
  }

  // Prefer the highest-confidence candidate that actually parses; a clear
  // second choice beats a confident but meaningless first one.
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  let fallback: VoiceResult | null = null;

  for (const candidate of ranked) {
    const intent = parseVoiceInput(candidate.transcript, options);
    const result: VoiceResult = {
      intent,
      confidence: candidate.confidence,
      transcript: candidate.transcript,
      lowConfidence: candidate.confidence < MIN_CONFIDENCE,
    };
    if (intent.kind !== 'unrecognised') return result;
    fallback ??= result;
  }

  return (
    fallback ?? {
      intent: { kind: 'unrecognised', transcript: ranked[0]?.transcript ?? '' },
      confidence: ranked[0]?.confidence ?? 0,
      transcript: ranked[0]?.transcript ?? '',
      lowConfidence: true,
    }
  );
}

/** Human-readable description of what was heard, shown under the prompt. */
export function describeIntent(result: VoiceResult): string {
  if (result.transcript.trim().length === 0) return 'Nothing heard';
  switch (result.intent.kind) {
    case 'coordinate':
      return `Heard "${result.transcript}" → ${result.intent.square}`;
    case 'color':
      return `Heard "${result.transcript}" → ${result.intent.color}`;
    case 'command':
      return `Heard "${result.transcript}" → ${result.intent.command}`;
    case 'unrecognised':
      return `Heard "${result.transcript}" — not a coordinate. Try again or tap.`;
  }
}
