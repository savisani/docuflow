/**
 * Project Migration Types
 *
 * Migrations transform raw project data from one version to the next.
 * Each migration is a pure function: input → output.
 * Migrations run sequentially: v1 → v2 → v3 → ... → current.
 */

/** Raw project data before migration (loosely typed — untrusted input). */
export interface RawProject {
  version?: unknown;
  settings?: unknown;
  assets?: unknown;
  commands?: unknown;
  voiceover?: unknown;
  transcript?: unknown;
  sceneMarkers?: unknown;
  [key: string]: unknown;
}

/** Result of a migration step. */
export interface MigrationResult {
  /** The migrated project data (ready for Zod validation). */
  project: RawProject;
  /** Whether any migration was applied. */
  migrated: boolean;
  /** The version the project was at before migration. */
  fromVersion: number;
}

/** A single migration function. Transforms project data from one version to the next. */
export type MigrationFn = (data: RawProject) => RawProject;
