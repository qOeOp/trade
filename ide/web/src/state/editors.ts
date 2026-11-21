// The editor's open file: one version's source at a time, by default its change from its parent's ("Compare
// with parent", kept on or off across versions, so stepping through the versions reads each one's change).
// As VS Code's preview editor, a file opened by a single click in Sources is a preview that follows the
// selected version wherever it is chosen, so the editor and Details never show two versions; a double-click,
// Enter, "Open source" or Pin keeps the file open whatever is selected next. The editor shows the file while
// Sources is the left tool window last chosen; while Versions is, it shows the lineage instead (shell/Editor.tsx).
import { atom, useAtom } from "./atom";
import { useSelection } from "./selection";
import { showToolWindow } from "./shell";

export type OpenFile = { id: string | null; diff: boolean; pinned: boolean };

const editor = atom<OpenFile>({ id: null, diff: true, pinned: false });

/** The file the editor shows: a preview shows the selected version. */
export const shownFile = (file: OpenFile, selected: string | null): OpenFile =>
  (file.pinned || selected === null ? file : { ...file, id: selected });

export function useOpenFile(): OpenFile {
  return shownFile(useAtom(editor), useSelection());
}

/** Opens version `id`'s source, kept open whatever is selected next. */
export function openSource(id: string): void {
  editor.set({ ...editor.get(), id, pinned: true });
  showToolWindow("sources", "left");
}

/** The open file becomes a preview of the selected version (a single click in Sources). */
export const previewSource = () => editor.set({ ...editor.get(), pinned: false });

/** Keeps the shown file `id` open, or makes it a preview again. */
export const togglePin = (id: string) => editor.set(editor.get().pinned ? { ...editor.get(), pinned: false } : { ...editor.get(), id, pinned: true });

/** Opens version `id`'s change from its parent's source. */
export function openDiff(id: string): void {
  editor.set({ id, diff: true, pinned: true });
  showToolWindow("sources", "left");
}

export const toggleDiff = () => editor.set({ ...editor.get(), diff: !editor.get().diff });

/** Back to the lineage: Versions on the left, the canvas in the editor. */
export const showLineage = () => showToolWindow("versions", "left");
