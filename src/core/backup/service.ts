/**
 * Backup service: the safe path between a file and the repository.
 *
 * Order of operations on import, which the spec requires and the tests pin:
 *   1. parse and validate the whole file;
 *   2. refuse outright if anything is wrong - existing data is untouched;
 *   3. take a snapshot of current data;
 *   4. migrate the incoming data to the current schema;
 *   5. replace or merge.
 *
 * If step 5 throws, the snapshot is restored, so a failed import cannot leave
 * the user worse off than before they tried.
 */

import type { BightRepository } from '../storage/types';
import {
  createBackup,
  migrate,
  parseBackup,
  previewBackup,
  serialiseBackup,
  type BackupFile,
  type BackupPreview,
} from './format';

export type ImportMode = 'replace' | 'merge';

export interface ImportResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Migrations applied, in order. */
  migrationsApplied: string[];
  preview: BackupPreview | null;
  /** Set when the import failed and the snapshot was restored. */
  rolledBack: boolean;
}

export async function exportBackup(
  repository: BightRepository,
  now: number = Date.now(),
): Promise<string> {
  const data = await repository.exportAll();
  return serialiseBackup(createBackup(data, now));
}

export async function importBackup(
  repository: BightRepository,
  json: string,
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const validation = parseBackup(json);
  if (!validation.ok || validation.backup === undefined) {
    // Nothing has been touched.
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      migrationsApplied: [],
      preview: null,
      rolledBack: false,
    };
  }

  const backup: BackupFile = validation.backup;
  const preview = previewBackup(backup);

  let migrated;
  try {
    migrated = migrate(backup);
  } catch (error) {
    return {
      ok: false,
      errors: [(error as Error).message],
      warnings: validation.warnings,
      migrationsApplied: [],
      preview,
      rolledBack: false,
    };
  }

  // Snapshot before the first write.
  const snapshot = await repository.exportAll();

  try {
    if (mode === 'replace') await repository.importAll(migrated.data);
    else await repository.mergeAll(migrated.data);
  } catch (error) {
    try {
      await repository.importAll(snapshot);
    } catch {
      // Restoring failed too; surface the original error either way.
    }
    return {
      ok: false,
      errors: [`Import failed and your data was restored: ${(error as Error).message}`],
      warnings: validation.warnings,
      migrationsApplied: migrated.applied,
      preview,
      rolledBack: true,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    migrationsApplied: migrated.applied,
    preview,
    rolledBack: false,
  };
}

/** Validates and previews without importing, for the confirmation screen. */
export function inspectBackup(json: string): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  preview: BackupPreview | null;
} {
  const validation = parseBackup(json);
  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    preview: validation.backup === undefined ? null : previewBackup(validation.backup),
  };
}
