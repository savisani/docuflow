export { CURRENT_PROJECT_VERSION } from './migrations/version';
export { migrateProject, isSupportedVersion } from './migrations/migrate';
export type { RawProject, MigrationResult } from './migrations/types';
