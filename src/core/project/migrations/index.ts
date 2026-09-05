export { CURRENT_PROJECT_VERSION } from './version';
export { migrateProject, isSupportedVersion } from './migrate';
export { MIGRATIONS, type MigrationEntry } from './registry';
export type { RawProject, MigrationResult, MigrationFn } from './types';
