/**
 * Migration Registry
 *
 * Each entry maps a source version to its migration function.
 * The migration function receives data at version N and returns data at version N+1.
 *
 * Migrations run sequentially: the output of one feeds into the next.
 *
 * To add a new migration:
 * 1. Increment CURRENT_PROJECT_VERSION in version.ts
 * 2. Create a migration file (e.g., v2.ts) that exports a MigrationFn
 * 3. Add an entry to MIGRATIONS below
 *
 * Example for a future v2 migration:
 * ```ts
 * import { migrateV1toV2 } from './v2';
 * // Then add to MIGRATIONS:
 * // { fromVersion: 1, migrate: migrateV1toV2 },
 * ```
 */

import type { MigrationFn } from './types';

export interface MigrationEntry {
  fromVersion: number;
  migrate: MigrationFn;
}

/**
 * Ordered list of migrations. Each entry transforms fromVersion → fromVersion + 1.
 * Migrations run in array order (sequential composition).
 */
export const MIGRATIONS: MigrationEntry[] = [
  // Future example:
  // { fromVersion: 1, migrate: migrateV1toV2 },
];
