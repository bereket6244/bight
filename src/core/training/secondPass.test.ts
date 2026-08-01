/**
 * Second-pass guarantees.
 *
 * These tests encode decisions rather than mechanics: which exercises the app
 * offers, which it deliberately dropped, and the spelling convention. They
 * exist so a future change cannot quietly reintroduce a removed drill or an
 * unexplained mode card.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODES, allModeVariants, findMode, isActiveMode, modeLabel, modesByCategory, variantLabel } from './registry';
import { DEPRECATED_MODES, DEPRECATED_VARIANTS, replacementFor } from './legacy';
import { MODE_CATEGORY_LABELS } from './types';

describe('mode registry shape', () => {
  it('gives every mode a category, a one-line summary and at least one variant', () => {
    for (const mode of MODES) {
      expect(mode.category, mode.id).toBeTruthy();
      expect(MODE_CATEGORY_LABELS[mode.category]).toBeTruthy();
      expect(mode.variants.length, mode.id).toBeGreaterThan(0);
      expect(mode.summary.length, mode.id).toBeGreaterThan(0);
      // A card shows one line. Anything longer belongs in the info sheet.
      expect(mode.summary.length, `${mode.id} summary too long`).toBeLessThanOrEqual(60);
      expect(mode.summary, mode.id).not.toContain('\n');
    }
  });

  it('has no duplicate mode ids', () => {
    const ids = MODES.map((mode) => mode.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every mode in exactly one browser category', () => {
    const grouped = modesByCategory();
    const listed = grouped.flatMap((group) => group.modes.map((mode) => mode.id));
    expect(new Set(listed).size).toBe(MODES.length);
    expect(listed.length).toBe(MODES.length);
  });

  it('keeps the browser to a readable number of cards', () => {
    // The first version showed 11 modes and 42 variant cards. The blindfold
    // pass added exactly one category of at most three cards on top.
    expect(MODES.length).toBeLessThanOrEqual(15);
    for (const group of modesByCategory()) {
      expect(group.modes.length, group.label).toBeLessThanOrEqual(4);
    }
  });

  it('collapses variants that differ only by settings', () => {
    // No mode should carry a variant list long enough to be a menu of its own.
    for (const mode of MODES) {
      expect(mode.variants.length, `${mode.id} has too many variants`).toBeLessThanOrEqual(4);
    }
  });
});

describe('removed exercises stay removed', () => {
  const variantIds = allModeVariants().map(({ mode, variant }) => `${mode.id}:${variant.id}`);

  it('no longer offers square-color variants that show the square', () => {
    // Seeing a green or cream square answers "is it light or dark".
    expect(variantIds).not.toContain('square-color:highlighted');
    expect(variantIds).not.toContain('square-color:flashed');

    const squareColor = findMode('square-color');
    expect(squareColor).toBeDefined();
    expect(squareColor!.variants).toHaveLength(1);
    expect(squareColor!.variants[0]!.id).toBe('coordinate');
  });

  it('no longer offers empty-board slider target collection', () => {
    for (const id of [
      'piece-vision:queen-geometry',
      'piece-vision:rook-geometry',
      'piece-vision:bishop-geometry',
      'piece-vision:king-geometry',
      'piece-vision:diagonal',
      'piece-vision:file-and-rank',
    ]) {
      expect(variantIds, id).not.toContain(id);
    }
  });

  it('no longer offers a pawn push/capture drill', () => {
    expect(variantIds).not.toContain('piece-vision:pawn-moves-vs-captures');
    expect(variantIds).not.toContain('piece-vision:pawn-geometry');
  });

  it('no longer offers the directional coordinate walk', () => {
    expect(isActiveMode('sequence')).toBe(false);
    expect(MODES.some((mode) => mode.id === ('sequence' as never))).toBe(false);
  });

  it('no longer exposes flash prompts as separate modes', () => {
    expect(isActiveMode('memory-coordinate-to-square')).toBe(false);
    expect(isActiveMode('memory-square-to-coordinate')).toBe(false);
  });

  it('offers flash as a setting on the coordinate modes instead', () => {
    for (const id of ['coordinate-to-square', 'square-to-coordinate'] as const) {
      expect(findMode(id)?.supportsPromptVisibility, id).toBe(true);
    }
  });

  it('replaced the sparse "move the piece" drill with notation', () => {
    expect(isActiveMode('piece-movement')).toBe(false);
    expect(isActiveMode('notation')).toBe(true);
  });
});

describe('new exercises exist', () => {
  it('offers knight and queen fork training', () => {
    expect(isActiveMode('knight-fork')).toBe(true);
    expect(isActiveMode('queen-fork')).toBe(true);
    for (const id of ['knight-fork', 'queen-fork'] as const) {
      expect(findMode(id)!.category).toBe('forks');
    }
  });

  it('offers a knight routing mode separate from knight vision', () => {
    expect(isActiveMode('knight-route')).toBe(true);
    expect(findMode('knight-vision')!.variants.map((v) => v.id)).not.toContain('shortest-route');
  });
});

describe('legacy identifiers keep old data readable', () => {
  it('gives every removed mode a readable label', () => {
    for (const modeId of Object.keys(DEPRECATED_MODES)) {
      const label = modeLabel(modeId);
      expect(label, modeId).not.toBe(modeId);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('gives every removed variant a readable label', () => {
    for (const combined of Object.keys(DEPRECATED_VARIANTS)) {
      const [modeId, variantId] = combined.split(':') as [string, string];
      expect(variantLabel(modeId, variantId), combined).not.toBe(variantId);
    }
  });

  it('never claims a removed mode is active', () => {
    for (const modeId of Object.keys(DEPRECATED_MODES)) {
      expect(isActiveMode(modeId), modeId).toBe(false);
      expect(findMode(modeId)).toBeUndefined();
    }
  });

  it('points removed modes at a surviving replacement where one exists', () => {
    for (const [modeId, entry] of Object.entries(DEPRECATED_MODES)) {
      const replacement = replacementFor(modeId);
      if (entry.replacement === null) {
        expect(replacement).toBeNull();
      } else {
        expect(replacement, modeId).toBe(entry.replacement);
        expect(isActiveMode(replacement as string), `${modeId} -> ${replacement}`).toBe(true);
      }
    }
  });

  it('falls back to the raw id for an id it has never heard of', () => {
    expect(modeLabel('some-future-mode')).toBe('some-future-mode');
  });
});

/* ------------------------------------------------------------------ *
 * Spelling
 * ------------------------------------------------------------------ */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'android') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|css|html)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('American spelling', () => {
  /**
   * The app uses American English. "Practise" is the British verb form and had
   * leaked into buttons, achievements and comments; this fails the build if it
   * comes back.
   */
  it('never contains "practise" or "practising" anywhere in the source', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const contents = readFileSync(file, 'utf8');
      contents.split('\n').forEach((line, index) => {
        // This test necessarily names the word it forbids, so skip itself.
        if (file.endsWith('secondPass.test.ts')) return;
        if (/practis/i.test(line)) {
          offenders.push(`${file.replace(process.cwd(), '')}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, `Use "practice"/"practicing":\n${offenders.join('\n')}`).toEqual([]);
  });
});
