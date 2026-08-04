import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createRepository } from './storage';
import { defaultPreferences } from './storage/types';
import {
  assetUrl,
  engineGamePersistenceEnabled,
  runtimeTargetFromValue,
} from './runtimeTarget';
import { engineAssetUrls } from '../services/engine/engineConfig';
import { voiceModelUrls } from '../services/voice/recognizer';
import { loadSavedEngineGame, storeSavedEngineGame } from './engineGame/savedGameStorage';

describe('GitHub Pages runtime contract', () => {
  it('resolves copied assets against root and project-site bases', () => {
    expect(assetUrl('engine/stockfish.js', '/')).toBe('/engine/stockfish.js');
    expect(assetUrl('/engine/stockfish.js', '/bight/')).toBe('/bight/engine/stockfish.js');
    expect(assetUrl('engine/stockfish.js', './')).toBe('./engine/stockfish.js');
  });

  it('resolves Stockfish Worker and WASM beneath /bight/', () => {
    expect(engineAssetUrls('/bight/')).toEqual({
      worker: '/bight/engine/stockfish-18-lite-single.js',
      wasm: '/bight/engine/stockfish-18-lite-single.wasm',
    });
  });

  it('resolves both voice-model candidates beneath /bight/', () => {
    expect(voiceModelUrls('/bight/')).toEqual([
      '/bight/models/vosk-model-small-en-us-0.15.tar.gz',
      '/bight/models/vosk-model-small-en-us-0.15.tar',
    ]);
  });

  it('selects the in-memory repository directly for the web demo', async () => {
    const indexedDbOpen = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDbOpen });
    const selection = await createRepository('web-demo');

    expect(selection.repository.engine).toBe('memory');
    expect(selection.ephemeral).toBe(true);
    expect(selection.fallbacks).toEqual([]);
    expect(indexedDbOpen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the ordinary Android/development storage chain as the default', () => {
    expect(runtimeTargetFromValue(undefined)).toBe('app');
    expect(runtimeTargetFromValue('')).toBe('app');
    expect(runtimeTargetFromValue('web-demo')).toBe('web-demo');
  });

  it('retains the ordinary durable browser fallback for the app target', async () => {
    const selection = await createRepository('app');
    expect(selection.repository.engine).toBe('indexeddb');
    expect(selection.ephemeral).toBe(false);
    expect(selection.fallbacks[0]?.engine).toBe('sqlite');
    await selection.repository.clear();
  });

  it('starts with clean progress when the web runtime is reinitialized', async () => {
    const first = await createRepository('web-demo');
    await first.repository.savePreferences({ ...defaultPreferences(), dailyGoal: 200 });

    const refreshed = await createRepository('web-demo');
    expect(await refreshed.repository.getPreferences()).toEqual(defaultPreferences());
    expect(await refreshed.repository.getAttempts()).toEqual([]);
    expect(await refreshed.repository.getSessions()).toEqual([]);
  });

  it('never reads or writes engine-game saves for the web demo', () => {
    const storage = {
      getItem: vi.fn(() => '{"version":1}'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    storeSavedEngineGame(storage, 'web-demo', '{"version":1}');
    expect(loadSavedEngineGame(storage, 'web-demo')).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(engineGamePersistenceEnabled('web-demo')).toBe(false);
    expect(engineGamePersistenceEnabled('app')).toBe(true);
  });
});
