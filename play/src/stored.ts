/**
 * A value a standalone page keeps in this browser's storage (the player's timing offset, their
 * vowel calibration): JSON under one key, checked when read back. Storage may be refused (a
 * private window, blocked site data): then a read is null and a write says it failed, and the page
 * plays without it.
 */
export interface Stored<T> {
  read(): T | null;
  write(value: T): boolean;
  clear(): void;
}

export function stored<T>(key: string, valid: (v: unknown) => v is T): Stored<T> {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const v: unknown = JSON.parse(raw);
        return valid(v) ? v : null;
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing stored, nothing to clear.
      }
    },
  };
}
