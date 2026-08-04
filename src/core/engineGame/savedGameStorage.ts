import { SAVED_GAME_KEY } from './savedGame';
import {
  engineGamePersistenceEnabled,
  type RuntimeTarget,
} from '../runtimeTarget';

export interface EngineGameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSavedEngineGame(
  storage: EngineGameStorage,
  target: RuntimeTarget,
): string | null {
  if (!engineGamePersistenceEnabled(target)) return null;
  return storage.getItem(SAVED_GAME_KEY);
}

export function storeSavedEngineGame(
  storage: EngineGameStorage,
  target: RuntimeTarget,
  serialized: string | null,
): void {
  if (!engineGamePersistenceEnabled(target)) return;
  if (serialized === null) storage.removeItem(SAVED_GAME_KEY);
  else storage.setItem(SAVED_GAME_KEY, serialized);
}
