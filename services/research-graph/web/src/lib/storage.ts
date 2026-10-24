// Browser storage that may be missing or blocked (private windows, previews, file://): every read
// and write is guarded, and the page works without it.
export const storage = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

/** A stored JSON value, or `fallback` when it is absent, unreadable or fails `valid`. */
export function readJson<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  const raw = storage.get(key);
  if (raw == null) return fallback;
  try { const v: unknown = JSON.parse(raw); return valid(v) ? v : fallback; } catch { return fallback; }
}

export const writeJson = (key: string, value: unknown) => storage.set(key, JSON.stringify(value));
