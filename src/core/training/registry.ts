/**
 * The mode registry.
 *
 * This list is the single source of truth for what the app offers. The mode
 * browser, Home's recent/frequent sections, session setup and the tests all
 * read from it, so a mode cannot exist in one place and be forgotten in
 * another.
 *
 * Modes removed in the second pass are absent here on purpose. Their ids still
 * resolve to readable labels through `legacy.ts` so stored history and old
 * backups keep working.
 */

import {
  MODE_CATEGORY_LABELS,
  type ModeCategory,
  type ModeDefinition,
  type ModeId,
  type ModeVariant,
} from './types';
import { coordinateToSquareMode, squareToCoordinateMode } from './generators/coordinate';
import { squareColorMode } from './generators/color';
import { knightRouteMode, knightVisionMode } from './generators/knight';
import { knightForkMode, queenForkMode } from './generators/fork';
import { notationMode } from './generators/notation';
import { alignmentMode, blockerMode, pieceVisionMode } from './generators/pieces';
import {
  blindfoldEngineGameMode,
  blindfoldProgressiveMode,
  blindfoldReconstructionMode,
  blindfoldTrackingMode,
} from './generators/blindfold';
import { legacyModeLabel, legacyVariantLabel } from './legacy';

export const MODES: readonly ModeDefinition[] = Object.freeze([
  coordinateToSquareMode,
  squareToCoordinateMode,
  alignmentMode,
  squareColorMode,
  knightVisionMode,
  knightRouteMode,
  knightForkMode,
  queenForkMode,
  notationMode,
  pieceVisionMode,
  blockerMode,
  blindfoldTrackingMode,
  blindfoldReconstructionMode,
  blindfoldProgressiveMode,
  blindfoldEngineGameMode,
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

/** True when the id names a mode the app still offers. */
export function isActiveMode(id: string): boolean {
  return MODE_BY_ID.has(id as ModeId);
}

export function getVariant(modeId: ModeId, variantId: string): ModeVariant {
  const mode = getMode(modeId);
  return mode.variants.find((v) => v.id === variantId) ?? (mode.variants[0] as ModeVariant);
}

export function defaultVariantId(modeId: ModeId): string {
  return (getMode(modeId).variants[0] as ModeVariant).id;
}

export function allModeVariants(): Array<{ mode: ModeDefinition; variant: ModeVariant }> {
  return MODES.flatMap((mode) => mode.variants.map((variant) => ({ mode, variant })));
}

/**
 * Every mode that produces questions, which is every mode except the engine
 * game.
 *
 * The generator contract, the session screen and the "open every mode" sweeps
 * all mean this set rather than `allModeVariants()`. A game against the engine
 * has no generator and no expected answer, so asking it to satisfy a question
 * contract would be asking the wrong question.
 */
export function questionModeVariants(): Array<{ mode: ModeDefinition; variant: ModeVariant }> {
  return allModeVariants().filter(({ mode }) => mode.isEngineGame !== true);
}

/** Modes grouped for the browser, in a stable display order. */
export const CATEGORY_ORDER: readonly ModeCategory[] = Object.freeze([
  'coordinates',
  'square-color',
  'knight',
  'forks',
  'notation',
  'position',
  'blindfold',
]);

export function modesByCategory(): Array<{ category: ModeCategory; label: string; modes: ModeDefinition[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: MODE_CATEGORY_LABELS[category],
    modes: MODES.filter((mode) => mode.category === category),
  })).filter((group) => group.modes.length > 0);
}

/**
 * A readable name for any mode id, including ones that no longer exist.
 * History and Progress render this so old sessions never show a raw id.
 */
export function modeLabel(modeId: string): string {
  return findMode(modeId)?.title ?? legacyModeLabel(modeId) ?? modeId;
}

export function variantLabel(modeId: string, variantId: string): string {
  const mode = findMode(modeId);
  const variant = mode?.variants.find((v) => v.id === variantId);
  if (variant !== undefined) return variant.label;
  return legacyVariantLabel(modeId, variantId) ?? variantId;
}

/**
 * Shown on a fresh install, before there is any history to rank.
 * Deliberately labelled "Start here" in the UI rather than dressed up as a
 * personalized recommendation.
 */
export const STARTER_MODE_IDS: readonly ModeId[] = Object.freeze([
  'coordinate-to-square',
  'square-to-coordinate',
  'square-color',
  'knight-vision',
]);
