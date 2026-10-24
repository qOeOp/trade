import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../lib/storage";

// A tiny external store: readers subscribe without re-rendering one another.
type Listener = () => void;
export type Atom<T> = { get: () => T; set: (next: T) => void; subscribe: (l: Listener) => () => void };

export function atom<T>(initial: T): Atom<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next) { if (!Object.is(next, value)) { value = next; listeners.forEach((l) => l()); } },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

/** An atom kept in browser storage under `key` (ignored when storage is unavailable). */
export function persistedAtom<T>(key: string, fallback: T, valid: (v: unknown) => v is T): Atom<T> {
  const a = atom(readJson(key, fallback, valid));
  a.subscribe(() => writeJson(key, a.get()));
  return a;
}

export const useAtom = <T,>(a: Atom<T>): T => useSyncExternalStore(a.subscribe, a.get);
