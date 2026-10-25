// The editor's tabs: the lineage is always open; a version can open in its own tabs: its detail at full
// width, its source, and its source's change from its parent's. One tab is active.
import { atom, useAtom } from "./atom";

export const LINEAGE_TAB = "lineage";
// tab ids: "lineage", a version id (its detail), "source:<version>" or "diff:<version>"
export type EditorTabs = { tabs: readonly string[]; active: string };
export type TabKind = "lineage" | "detail" | "source" | "diff";

export const editors = atom<EditorTabs>({ tabs: [LINEAGE_TAB], active: LINEAGE_TAB });
export const useEditors = () => useAtom(editors);

/** What a tab shows and of which version. */
export function parseTab(tab: string): { kind: TabKind; id: string } {
  if (tab === LINEAGE_TAB) return { kind: "lineage", id: "" };
  const m = /^(source|diff):(.+)$/.exec(tab);
  return m ? { kind: m[1] as "source" | "diff", id: m[2] ?? "" } : { kind: "detail", id: tab };
}

function openTab(tab: string): void {
  const { tabs } = editors.get();
  editors.set({ tabs: tabs.includes(tab) ? tabs : [...tabs, tab], active: tab });
}

export const openVersionTab = (id: string) => openTab(id);
export const openSourceTab = (id: string) => openTab(`source:${id}`);
export const openDiffTab = (id: string) => openTab(`diff:${id}`);

export const activateTab = (id: string) => editors.set({ ...editors.get(), active: id });

export function closeTab(id: string): void {
  if (id === LINEAGE_TAB) return;
  const { tabs, active } = editors.get();
  const i = tabs.indexOf(id), rest = tabs.filter((t) => t !== id);
  editors.set({ tabs: rest, active: active === id ? rest[Math.max(0, i - 1)] ?? LINEAGE_TAB : active });
}
