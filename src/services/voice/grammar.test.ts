import { describe, expect, it } from 'vitest';
import {
  buildVocabulary,
  describeIntent,
  interpretCandidates,
  parseVoiceInput,
  COLOR_ALIASES,
  FILE_ALIASES,
  MIN_CONFIDENCE,
  RANK_ALIASES,
} from './grammar';
import { ALL_SQUARES } from '../../core/chess/square';

describe('coordinate parsing', () => {
  it('accepts the plain letter-and-number form', () => {
    expect(parseVoiceInput('e four')).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(parseVoiceInput('a one')).toEqual({ kind: 'coordinate', square: 'a1' });
    expect(parseVoiceInput('h eight')).toEqual({ kind: 'coordinate', square: 'h8' });
  });

  it('accepts NATO words for files', () => {
    expect(parseVoiceInput('echo four')).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(parseVoiceInput('bravo three')).toEqual({ kind: 'coordinate', square: 'b3' });
    expect(parseVoiceInput('delta five')).toEqual({ kind: 'coordinate', square: 'd5' });
    expect(parseVoiceInput('golf two')).toEqual({ kind: 'coordinate', square: 'g2' });
  });

  it('accepts the "letter e four" form', () => {
    expect(parseVoiceInput('letter e four')).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(parseVoiceInput('the square e four')).toEqual({ kind: 'coordinate', square: 'e4' });
  });

  it('accepts a compact single token', () => {
    expect(parseVoiceInput('e4')).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(parseVoiceInput('B3')).toEqual({ kind: 'coordinate', square: 'b3' });
  });

  it('handles the commonly confused letters b, d, e and g', () => {
    // These four are the classic microphone confusion set.
    expect(parseVoiceInput('bee four')).toEqual({ kind: 'coordinate', square: 'b4' });
    expect(parseVoiceInput('dee four')).toEqual({ kind: 'coordinate', square: 'd4' });
    expect(parseVoiceInput('ee four')).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(parseVoiceInput('gee four')).toEqual({ kind: 'coordinate', square: 'g4' });
    expect(parseVoiceInput('jee four')).toEqual({ kind: 'coordinate', square: 'g4' });
  });

  it('tolerates common number mishearings', () => {
    expect(parseVoiceInput('e for')).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(parseVoiceInput('e to')).toEqual({ kind: 'coordinate', square: 'e2' });
    expect(parseVoiceInput('e ate')).toEqual({ kind: 'coordinate', square: 'e8' });
    expect(parseVoiceInput('e won')).toEqual({ kind: 'coordinate', square: 'e1' });
  });

  it('ignores punctuation and case', () => {
    expect(parseVoiceInput('  ECHO,  FOUR!  ')).toEqual({ kind: 'coordinate', square: 'e4' });
  });

  it('tolerates a stray token between the file and the rank', () => {
    expect(parseVoiceInput('echo um four')).toEqual({ kind: 'coordinate', square: 'e4' });
  });

  it('parses every square from its spoken NATO form', () => {
    const fileWord: Record<string, string> = {
      a: 'alpha', b: 'bravo', c: 'charlie', d: 'delta',
      e: 'echo', f: 'foxtrot', g: 'golf', h: 'hotel',
    };
    const rankWord = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

    for (const square of ALL_SQUARES) {
      const spoken = `${fileWord[square[0]] as string} ${rankWord[Number(square[1]) - 1] as string}`;
      expect(parseVoiceInput(spoken), spoken).toEqual({ kind: 'coordinate', square });
    }
  });

  it('rejects input that is not a coordinate', () => {
    for (const input of ['', 'hello there', 'nine', 'zebra four', 'i nine', 'e nine', 'j four']) {
      expect(parseVoiceInput(input).kind, input).toBe('unrecognised');
    }
  });

  it('rejects a rank with no file', () => {
    expect(parseVoiceInput('four').kind).toBe('unrecognised');
  });

  it('rejects a file with no rank', () => {
    expect(parseVoiceInput('echo').kind).toBe('unrecognised');
  });
});

describe('colour parsing', () => {
  it('recognises light and dark only when colours are enabled', () => {
    expect(parseVoiceInput('light', { colors: true })).toEqual({ kind: 'color', color: 'light' });
    expect(parseVoiceInput('dark', { colors: true })).toEqual({ kind: 'color', color: 'dark' });
    expect(parseVoiceInput('light').kind).toBe('unrecognised');
  });

  it('accepts white and black as synonyms', () => {
    expect(parseVoiceInput('white', { colors: true })).toEqual({ kind: 'color', color: 'light' });
    expect(parseVoiceInput('black', { colors: true })).toEqual({ kind: 'color', color: 'dark' });
  });

  it('accepts every documented colour alias', () => {
    for (const [color, words] of Object.entries(COLOR_ALIASES)) {
      for (const word of words) {
        expect(parseVoiceInput(word, { colors: true }), word).toEqual({ kind: 'color', color });
      }
    }
  });
});

describe('commands', () => {
  it('recognises control words', () => {
    expect(parseVoiceInput('repeat')).toEqual({ kind: 'command', command: 'repeat' });
    expect(parseVoiceInput('skip')).toEqual({ kind: 'command', command: 'skip' });
    expect(parseVoiceInput('submit')).toEqual({ kind: 'command', command: 'submit' });
    expect(parseVoiceInput('undo')).toEqual({ kind: 'command', command: 'undo' });
  });

  it('can be switched off', () => {
    expect(parseVoiceInput('skip', { commands: false }).kind).toBe('unrecognised');
  });
});

describe('vocabulary', () => {
  it('includes every alias it claims to accept', () => {
    const vocabulary = new Set(buildVocabulary({ coordinates: true, colors: true, commands: true }));
    for (const words of Object.values(FILE_ALIASES)) {
      for (const word of words) expect(vocabulary.has(word), word).toBe(true);
    }
    for (const words of Object.values(RANK_ALIASES)) {
      for (const word of words) expect(vocabulary.has(word), word).toBe(true);
    }
    for (const words of Object.values(COLOR_ALIASES)) {
      for (const word of words) expect(vocabulary.has(word), word).toBe(true);
    }
  });

  it('narrows to the current exercise', () => {
    const coordinatesOnly = buildVocabulary({ coordinates: true, colors: false, commands: false });
    expect(coordinatesOnly).toContain('echo');
    expect(coordinatesOnly).not.toContain('light');

    const colorsOnly = buildVocabulary({ coordinates: false, colors: true, commands: false });
    expect(colorsOnly).toContain('light');
    expect(colorsOnly).not.toContain('echo');
  });

  it('is sorted and free of duplicates', () => {
    const vocabulary = buildVocabulary({ colors: true });
    expect(vocabulary).toEqual([...new Set(vocabulary)].sort());
  });
});

describe('confidence handling', () => {
  it('accepts a confident, parseable result', () => {
    const result = interpretCandidates([{ transcript: 'echo four', confidence: 0.95 }]);
    expect(result.intent).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(result.lowConfidence).toBe(false);
  });

  /**
   * The important rule: a mumble must not be scored as a wrong chess answer.
   */
  it('flags a low-confidence result rather than scoring it', () => {
    const result = interpretCandidates([{ transcript: 'echo four', confidence: 0.2 }]);
    expect(result.intent).toEqual({ kind: 'coordinate', square: 'e4' });
    expect(result.lowConfidence).toBe(true);
  });

  it('treats the threshold as inclusive', () => {
    expect(interpretCandidates([{ transcript: 'e4', confidence: MIN_CONFIDENCE }]).lowConfidence).toBe(
      false,
    );
    expect(
      interpretCandidates([{ transcript: 'e4', confidence: MIN_CONFIDENCE - 0.01 }]).lowConfidence,
    ).toBe(true);
  });

  it('prefers a parseable candidate over a more confident meaningless one', () => {
    const result = interpretCandidates([
      { transcript: 'the the the', confidence: 0.99 },
      { transcript: 'delta five', confidence: 0.8 },
    ]);
    expect(result.intent).toEqual({ kind: 'coordinate', square: 'd5' });
  });

  it('returns unrecognised when nothing parses', () => {
    const result = interpretCandidates([{ transcript: 'banana', confidence: 0.9 }]);
    expect(result.intent.kind).toBe('unrecognised');
  });

  it('handles no candidates at all', () => {
    const result = interpretCandidates([]);
    expect(result.intent.kind).toBe('unrecognised');
    expect(result.lowConfidence).toBe(true);
    expect(result.confidence).toBe(0);
  });
});

describe('feedback text', () => {
  it('shows what was heard and how it was read', () => {
    expect(describeIntent(interpretCandidates([{ transcript: 'echo four', confidence: 0.9 }]))).toBe(
      'Heard "echo four" → e4',
    );
  });

  it('explains an unrecognised utterance without blaming the user', () => {
    const text = describeIntent(interpretCandidates([{ transcript: 'banana', confidence: 0.9 }]));
    expect(text).toContain('not a coordinate');
    expect(text).toContain('tap');
  });

  it('handles silence', () => {
    expect(describeIntent(interpretCandidates([{ transcript: '   ', confidence: 0 }]))).toBe(
      'Nothing heard',
    );
  });
});
