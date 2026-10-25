// What a tree tool window offers to its header (expand, collapse, reveal the selection): the version
// tree and the source tree each register these while they are mounted.
import { atom } from "./atom";

export type TreeControl = { expandAll: () => void; collapseAll: () => void; revealSelected: () => void };
export const versionTreeControl = atom<TreeControl | null>(null);
export const sourceTreeControl = atom<TreeControl | null>(null);
