/**
 * Current Project Version
 *
 * This is the single authoritative constant for the current project format version.
 * All saves produce this version. All loads migrate to this version.
 *
 * To add a new migration:
 * 1. Increment CURRENT_PROJECT_VERSION
 * 2. Create a new migration file (e.g., v2.ts) that transforms v1 data → v2 data
 * 3. Register it in the MIGRATIONS array in migrate.ts
 * 4. Add tests
 */

export const CURRENT_PROJECT_VERSION = 1;
