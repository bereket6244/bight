/**
 * Deprecated mode and variant identifiers.
 *
 * The second pass removed or merged a number of exercises. Their identifiers
 * still exist in users' stored history and in backups written by v1.0.0, so
 * they survive here at the data layer while being absent from the visible
 * registry.
 *
 * Three things depend on this module:
 *  - History and Progress render a readable label instead of a raw id.
 *  - Home's recent/frequent sections refuse to launch a mode that no longer
 *    exists.
 *  - A saved "last mode" pointing at a removed mode is remapped to its closest
 *    surviving replacement rather than failing to open.
 *
 * Nothing is rewritten inside stored records. Old attempts keep their original
 * ids so an export re-imported into v1.0.0 still means what it said.
 */

import type { ModeId } from './types';

/** Modes removed from the visible registry, with the reason shown in the audit. */
export const DEPRECATED_MODES: Record<string, { label: string; replacement: ModeId | null }> = {
  'memory-coordinate-to-square': {
    label: 'Flashed coordinate (now a setting)',
    replacement: 'coordinate-to-square',
  },
  'memory-square-to-coordinate': {
    label: 'Flashed square (now a setting)',
    replacement: 'square-to-coordinate',
  },
  'piece-movement': {
    label: 'Move the piece (replaced by Notation)',
    replacement: 'notation',
  },
  sequence: {
    label: 'Coordinate walk (removed)',
    replacement: null,
  },
};

/**
 * Variants removed from a mode that still exists.
 * Keyed `modeId:variantId`.
 */
export const DEPRECATED_VARIANTS: Record<string, string> = {
  // Showing the square gave the colour away.
  'square-color:highlighted': 'Square colour from the board (removed)',
  'square-color:flashed': 'Flashed square colour (removed)',

  // Collecting every square a slider sees on an empty board.
  'piece-vision:bishop-geometry': 'Bishop sight on an empty board (removed)',
  'piece-vision:rook-geometry': 'Rook sight on an empty board (removed)',
  'piece-vision:queen-geometry': 'Queen sight on an empty board (removed)',
  'piece-vision:king-geometry': 'King sight on an empty board (removed)',
  'piece-vision:pawn-geometry': 'Pawn sight on an empty board (removed)',
  'piece-vision:diagonal': 'Name the diagonal (removed)',
  'piece-vision:file-and-rank': 'File and rank (removed)',
  'piece-vision:pawn-moves-vs-captures': 'Pawn pushes or captures (removed)',

  // Folded into other knight variants.
  'knight-vision:geometry-with-pieces': 'Knight sight through pieces (merged)',
  'knight-vision:candidates': 'Which are attacked? (merged)',
  'knight-vision:move-to-target': 'Play the knight move (replaced by Notation)',
  'knight-vision:shortest-route': 'Shortest knight route (now its own mode)',
  'knight-vision:any-route': 'Any knight route (now its own mode)',
};

export function isDeprecatedMode(modeId: string): boolean {
  return Object.hasOwn(DEPRECATED_MODES, modeId);
}

export function isDeprecatedVariant(modeId: string, variantId: string): boolean {
  return Object.hasOwn(DEPRECATED_VARIANTS, `${modeId}:${variantId}`);
}

/** Where a removed mode's saved settings should now point, if anywhere. */
export function replacementFor(modeId: string): ModeId | null {
  return DEPRECATED_MODES[modeId]?.replacement ?? null;
}

/**
 * A readable label for any historical mode id, current or removed.
 * Falls back to the raw id so an unknown future id still renders something.
 */
export function legacyModeLabel(modeId: string): string | null {
  return DEPRECATED_MODES[modeId]?.label ?? null;
}

export function legacyVariantLabel(modeId: string, variantId: string): string | null {
  return DEPRECATED_VARIANTS[`${modeId}:${variantId}`] ?? null;
}
