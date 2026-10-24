// What the version tree offers to its tool-window header (expand, collapse, reveal the selection);
// the tree registers these while it is mounted.
import { atom } from "./atom";

export type TreeControl = { expandAll: () => void; collapseAll: () => void; revealSelected: () => void };
export const versionTreeControl = atom<TreeControl | null>(null);
