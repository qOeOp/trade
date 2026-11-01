// The selected version, mirrored in the address (#<version>) so a link opens on it.
import { useSyncExternalStore } from "react";
import { atom, useAtom } from "./atom";
import { requestFocus } from "./linking";

const fromHash = () => decodeURIComponent(window.location.hash.slice(1)) || null;

export const selection = atom<string | null>(null);

let known: ReadonlySet<string> | null = null;

/** Starts the selection from the address when it names a known version, else from `fallback`. On a
 *  new view of a served page it keeps the selected version while that view still has it. */
export function initSelection(versions: ReadonlySet<string>, fallback: string | null): void {
  const first = known === null;
  known = versions;
  const current = first ? fromHash() : selection.get();
  selection.set(current && versions.has(current) ? current : fallback);
  if (!first) return;
  window.addEventListener("hashchange", () => {
    const id = fromHash();
    if (id && known?.has(id) && id !== selection.get()) { selection.set(id); requestFocus(id); }
  });
}

export function select(id: string, options: { reveal?: boolean } = {}): void {
  selection.set(id);
  history.replaceState(null, "", `#${encodeURI(id)}`);
  if (options.reveal) requestFocus(id);
}

/** No version selected: the Runs page shows a paper run that declares none of this line's. */
export function deselect(): void {
  selection.set(null);
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** Whether `id` is a version of the view shown. */
export const isKnown = (id: string) => known?.has(id) ?? false;

export const useSelection = () => useAtom(selection);

/** Whether `id` is selected; re-renders only when that answer changes. */
export const useIsSelected = (id: string) => useSyncExternalStore(selection.subscribe, () => selection.get() === id);
