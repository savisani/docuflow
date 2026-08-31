/**
 * Config Storage Abstraction
 *
 * Wraps localStorage for Phase 1. Can be swapped to Electron safeStorage
 * or OS keychain later without changing consumers.
 */

export interface ConfigStorage {
  load<T>(key: string, fallback: T): T;
  save<T>(key: string, value: T): void;
  remove(key: string): void;
}

class LocalStorageAdapter implements ConfigStorage {
  load<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      // corrupt or missing — fall through
    }
    return fallback;
  }

  save<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }
}

/** Default storage instance — swap this one line to change back-end. */
export const configStorage: ConfigStorage = new LocalStorageAdapter();
