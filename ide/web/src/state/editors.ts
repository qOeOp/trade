// The editor's open file: one version's source at a time, or with "Compare with parent" on, its change
// from its parent's. Opening another version replaces it; the comparison stays on, so stepping through the
// versions reads each one's change. The editor shows the file while Sources is the left tool window last
// chosen; while Versions is, it shows the lineage instead (shell/Editor.tsx).
import { atom, useAtom } from "./atom";
import { showToolWindow } from "./shell";

export type OpenFile = { id: string | null; diff: boolean };

export const editor = atom<OpenFile>({ id: null, diff: false });
export const useOpenFile = () => useAtom(editor);

export function openSource(id: string): void {
  editor.set({ ...editor.get(), id });
  showToolWindow("sources", "left");
}

export const toggleDiff = () => editor.set({ ...editor.get(), diff: !editor.get().diff });

/** Back to the lineage: Versions on the left, the canvas in the editor. */
export const showLineage = () => showToolWindow("versions", "left");
