/**
 * Repository factory: the fallback chain in one place.
 *
 *   SQLite (native only) -> IndexedDB -> in-memory
 *
 * Each step is tried and *verified* by actually opening the store; a plugin
 * that loads but fails on first use is caught here rather than at the first
 * save. The chosen engine is reported so Settings can tell the user where
 * their data lives, and so a memory-only fallback can warn that progress will
 * not survive a restart.
 */

import { IndexedDbRepository, indexedDbAvailable } from './indexedDb';
import { MemoryRepository } from './memory';
import { SqliteRepository, sqliteAvailable } from './sqlite';
import { RUNTIME_TARGET, type RuntimeTarget } from '../runtimeTarget';
import type { BightRepository } from './types';

export interface RepositorySelection {
  repository: BightRepository;
  /** Engines that were tried and failed, with the reason. */
  fallbacks: Array<{ engine: string; reason: string }>;
  /** True when nothing durable was available. */
  ephemeral: boolean;
}

/**
 * Opens the best available store.
 *
 * Never throws: if every engine fails the in-memory repository is returned so
 * training still works. Persistence is a feature, not a prerequisite.
 */
export async function createRepository(
  target: RuntimeTarget = RUNTIME_TARGET,
): Promise<RepositorySelection> {
  const fallbacks: Array<{ engine: string; reason: string }> = [];

  // The public Pages build is deliberately session-only. Do not even probe a
  // durable browser store: a failed or partial probe could still create an
  // IndexedDB database and would violate the web build's privacy contract.
  if (target === 'web-demo') {
    const repository = new MemoryRepository();
    await repository.init();
    return { repository, fallbacks, ephemeral: true };
  }

  if (await sqliteAvailable()) {
    const repository = new SqliteRepository();
    try {
      await repository.init();
      // Prove it works before committing to it.
      await repository.getPreferences();
      return { repository, fallbacks, ephemeral: false };
    } catch (error) {
      fallbacks.push({ engine: 'sqlite', reason: describeError(error) });
    }
  } else {
    fallbacks.push({ engine: 'sqlite', reason: 'Not a native platform, or plugin unavailable' });
  }

  if (indexedDbAvailable()) {
    const repository = new IndexedDbRepository();
    try {
      await repository.init();
      await repository.getPreferences();
      return { repository, fallbacks, ephemeral: false };
    } catch (error) {
      fallbacks.push({ engine: 'indexeddb', reason: describeError(error) });
    }
  } else {
    fallbacks.push({ engine: 'indexeddb', reason: 'IndexedDB is not available' });
  }

  const repository = new MemoryRepository();
  await repository.init();
  return { repository, fallbacks, ephemeral: true };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export * from './types';
export { MemoryRepository } from './memory';
export { IndexedDbRepository } from './indexedDb';
export { SqliteRepository } from './sqlite';
