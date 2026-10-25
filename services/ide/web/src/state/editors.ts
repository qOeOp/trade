// The editor's file tabs: a version's source, or its source's change from its parent's. Opening a file
// that is open activates its tab. The editor shows them while Sources is the left tool window last
// chosen; while Versions is, it shows the lineage instead (shell/Editor.tsx).
import { atom, useAtom } from "./atom";
import { showToolWindow } from "./shell";

// tab ids: "source:<version>" or "diff:<version>"
export type EditorTabs = { tabs: readonly string[]; active: string | null };
export type TabKind = "source" | "diff";

export const editors = atom<EditorTabs>({ tabs: [], active: null });
export const useEditors = () => useAtom(editors);

/** What a tab shows and of which version. */
export function parseTab(tab: string): { kind: TabKind; id: string } {
  const at = tab.indexOf(":");
  return { kind: tab.slice(0, at) as TabKind, id: tab.slice(at + 1) };
}

function openTab(tab: string): void {
  const { tabs } = editors.get();
  editors.set({ tabs: tabs.includes(tab) ? tabs : [...tabs, tab], active: tab });
  showToolWindow("sources", "left");
}

export const openSourceTab = (id: string) => openTab(`source:${id}`);
export const openDiffTab = (id: string) => openTab(`diff:${id}`);

/** Back to the lineage: Versions on the left, the canvas in the editor. */
export const showLineage = () => showToolWindow("versions", "left");

export const activateTab = (id: string) => editors.set({ ...editors.get(), active: id });

export function closeTab(id: string): void {
  const { tabs, active } = editors.get();
  const i = tabs.indexOf(id), rest = tabs.filter((t) => t !== id);
  editors.set({ tabs: rest, active: active === id ? rest[Math.max(0, i - 1)] ?? null : active });
}
