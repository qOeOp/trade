// The editor's tabs: the lineage is always open; a version can open in its own tab (its detail at full
// width). One tab is active.
import { atom, useAtom } from "./atom";

export const LINEAGE_TAB = "lineage";
export type EditorTabs = { tabs: readonly string[]; active: string };  // tab ids: "lineage" or a version id

export const editors = atom<EditorTabs>({ tabs: [LINEAGE_TAB], active: LINEAGE_TAB });
export const useEditors = () => useAtom(editors);

export function openVersionTab(id: string): void {
  const { tabs } = editors.get();
  editors.set({ tabs: tabs.includes(id) ? tabs : [...tabs, id], active: id });
}

export const activateTab = (id: string) => editors.set({ ...editors.get(), active: id });

export function closeTab(id: string): void {
  if (id === LINEAGE_TAB) return;
  const { tabs, active } = editors.get();
  const i = tabs.indexOf(id), rest = tabs.filter((t) => t !== id);
  editors.set({ tabs: rest, active: active === id ? rest[Math.max(0, i - 1)] ?? LINEAGE_TAB : active });
}
