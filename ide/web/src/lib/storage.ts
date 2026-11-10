// Browser storage that may be missing or blocked (private windows, previews): every read
// and write is guarded, and the page works without it.
export const tabStorage = {
  get(key: string): string | null {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null): void {
    try { if (value === null) window.sessionStorage.removeItem(key); else window.sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

const storage = {
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

// What the page keeps to spare the server a second computation: IndexedDB, in one store, the least recently
// used of a kind going past its limit. Guarded like the rest: without it every read is a miss and a write does nothing.
const KEPT = "kept";
let opened: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open("trade-ide", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(KEPT, { keyPath: "key" }).createIndex("used", ["kind", "used"]);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opened;
}

/** The value kept under `key` of `kind`, or null. */
export async function readKept<T>(kind: string, key: string): Promise<T | null> {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const store = db.transaction(KEPT, "readwrite").objectStore(KEPT);
      const request = store.get(`${kind}/${key}`);
      request.onsuccess = () => {
        const found = request.result as { value: T } | undefined;
        if (found) store.put({ ...found, used: Date.now() });
        resolve(found ? found.value : null);
      };
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** Keep `value` under `key` of `kind`, at most `limit` of that kind. */
export async function keep(kind: string, key: string, value: unknown, limit: number): Promise<void> {
  const db = await database();
  if (!db) return;
  try {
    const store = db.transaction(KEPT, "readwrite").objectStore(KEPT);
    store.put({ key: `${kind}/${key}`, kind, value, used: Date.now() });
    const oldest = store.index("used");
    const range = IDBKeyRange.bound([kind, 0], [kind, Infinity]);
    const counted = oldest.count(range);
    counted.onsuccess = () => {
      let extra = counted.result - limit;
      if (extra <= 0) return;
      oldest.openCursor(range).onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor && extra-- > 0) { cursor.delete(); cursor.continue(); }
      };
    };
  } catch { /* storage unavailable */ }
}
