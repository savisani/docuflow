/**
 * Project Migration Engine
 *
 * Detects the project version and runs sequential migrations to bring
 * the project data to the current version.
 *
 * Pipeline:
 *   raw JSON → detect version → migrate N → N+1 → ... → current → Zod validation
 *
 * Migrations are pure functions. This module does not access
 * the filesystem, Electron, IPC, or any global state.
 */

import type { RawProject, MigrationResult } from './types';
import { CURRENT_PROJECT_VERSION } from './version';
import { MIGRATIONS } from './registry';

/**
 * Extract the version number from raw project data.
 * Returns 0 if version is missing or not a valid number.
 */
function extractVersion(data: RawProject): number {
  const v = data.version;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) {
    return v;
  }
  return 0;
}

/**
 * Run all sequential migrations from `fromVersion` to CURRENT_PROJECT_VERSION.
 * Returns the migrated project data.
 */
function runMigrations(data: RawProject, fromVersion: number): RawProject {
  let current = data;

  for (let v = fromVersion; v < CURRENT_PROJECT_VERSION; v++) {
    const entry = MIGRATIONS.find((m) => m.fromVersion === v);
    if (!entry) {
      // No migration found for this version step — this is a programming error
      // if we previously allowed loading this version. Fail explicitly.
      throw new Error(
        `No migration registered for version ${v} → ${v + 1}. ` +
        `Cannot migrate project from version ${fromVersion} to ${CURRENT_PROJECT_VERSION}.`
      );
    }
    current = entry.migrate(current);
  }

  return current;
}

/**
 * Migrate raw project data to the current version.
 *
 * Behavior:
 * - version === CURRENT_PROJECT_VERSION → no-op (returns as-is)
 * - version < CURRENT_PROJECT_VERSION → runs sequential migrations
 * - version > CURRENT_PROJECT_VERSION → returns error (future version)
 * - version missing or 0 → treated as legacy unversioned format
 *
 * @returns MigrationResult with the migrated project and metadata,
 *          or an error object for unsupported versions.
 */
export function migrateProject(
  data: RawProject
): MigrationResult | { error: string; code: string; context?: Record<string, unknown> } {
  const version = extractVersion(data);

  // Future version — reject
  if (version > CURRENT_PROJECT_VERSION) {
    return {
      error: `Project version ${version} is not supported. Current version is ${CURRENT_PROJECT_VERSION}. ` +
        `This project was likely created with a newer version of DocuFlow.`,
      code: 'PROJECT_VERSION_UNSUPPORTED',
      context: {
        projectVersion: version,
        currentVersion: CURRENT_PROJECT_VERSION,
      },
    };
  }

  // Current version — no-op
  if (version === CURRENT_PROJECT_VERSION) {
    return {
      project: data,
      migrated: false,
      fromVersion: version,
    };
  }

  // Older version (including missing/0) — migrate
  try {
    const migrated = runMigrations(data, version);
    return {
      project: migrated,
      migrated: version > 0, // only "migrated" if there was a real version
      fromVersion: version,
    };
  } catch (err) {
    return {
      error: `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'PROJECT_MIGRATION',
      context: {
        projectVersion: version,
        currentVersion: CURRENT_PROJECT_VERSION,
      },
    };
  }
}

/**
 * Check if a version number represents a supported (not future) version.
 */
export function isSupportedVersion(version: number): boolean {
  return version > 0 && version <= CURRENT_PROJECT_VERSION;
}
