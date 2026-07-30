/**
 * The mode registry. Adding a mode here is the only wiring a new mode needs -
 * the session engine, progress views and settings all read from this list.
 */

import type { ModeDefinition, ModeId, ModeVariant } from './types';
import {
  coordinateToSquareMode,
  memoryCoordinateToSquareMode,
  memorySquareToCoordinateMode,
  squareToCoordinateMode,
} from './generators/coordinate';
import { squareColorMode } from './generators/color';
import { knightVisionMode } from './generators/knight';
import {
  alignmentMode,
  blockerMode,
  pieceMovementMode,
  pieceVisionMode,
  sequenceMode,
} from './generators/pieces';

export const MODES: readonly ModeDefinition[] = Object.freeze([
  coordinateToSquareMode,
  squareToCoordinateMode,
  squareColorMode,
  knightVisionMode,
  pieceVisionMode,
  pieceMovementMode,
  memoryCoordinateToSquareMode,
  memorySquareToCoordinateMode,
  alignmentMode,
  blockerMode,
  sequenceMode,
]);

const MODE_BY_ID = new Map<ModeId, ModeDefinition>(MODES.map((mode) => [mode.id, mode]));

export function getMode(id: ModeId): ModeDefinition {
  const mode = MODE_BY_ID.get(id);
  if (mode === undefined) throw new RangeError(`Unknown mode: ${id}`);
  return mode;
}

export function findMode(id: string): ModeDefinition | undefined {
  return MODE_BY_ID.get(id as ModeId);
}

export function getVariant(modeId: ModeId, variantId: string): ModeVariant {
  const mode = getMode(modeId);
  const variant = mode.variants.find((v) => v.id === variantId);
  return variant ?? (mode.variants[0] as ModeVariant);
}

export function defaultVariantId(modeId: ModeId): string {
  return (getMode(modeId).variants[0] as ModeVariant).id;
}

/** Every (mode, variant) pair, used by the mode list and by tests. */
export function allModeVariants(): Array<{ mode: ModeDefinition; variant: ModeVariant }> {
  return MODES.flatMap((mode) => mode.variants.map((variant) => ({ mode, variant })));
}

/** Modes suggested on the home screen for someone starting out. */
export const RECOMMENDED_MODE_IDS: readonly ModeId[] = Object.freeze([
  'coordinate-to-square',
  'square-to-coordinate',
  'square-color',
  'knight-vision',
]);
