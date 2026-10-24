// The selected version, mirrored in the address (#<version>) so a link opens on it.
import { useSyncExternalStore } from "react";
import { atom, useAtom } from "./atom";
import { requestFocus } from "./linking";

const fromHash = () => decodeURIComponent(window.location.hash.slice(1)) || null;

export const selection = atom<string | null>(null);

/** Starts the selection from the address when it names a known version, else from `fallback`. */
export function initSelection(known: ReadonlySet<string>, fallback: string | null): void {
  const linked = fromHash();
  selection.set(linked && known.has(linked) ? linked : fallback);
  window.addEventListener("hashchange", () => {
    const id = fromHash();
    if (id && known.has(id) && id !== selection.get()) { selection.set(id); requestFocus(id); }
  });
}

export function select(id: string, options: { reveal?: boolean } = {}): void {
  selection.set(id);
  history.replaceState(null, "", `#${encodeURI(id)}`);
  if (options.reveal) requestFocus(id);
}

export const useSelection = () => useAtom(selection);

/** Whether `id` is selected; re-renders only when that answer changes. */
export const useIsSelected = (id: string) => useSyncExternalStore(selection.subscribe, () => selection.get() === id);
