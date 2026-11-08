// Whether another paper run fits the memory the paper listing reports (paper/runs.py memory_state, admit).
import type { PaperMemory } from "../lib/paperApi";

const gib = (mib: number) => `${(mib / 1024).toFixed(1)} GiB`;

/** Why not even the smallest run fits, or null when one does: a start would be refused until a run stops. The
 *  server decides each start by its own reservation. */
export function full(memory: PaperMemory | undefined): string | null {
  if (!memory || memory.free >= memory.smallest) return null;
  return memory.host_available !== null && memory.free < memory.budget - memory.reserved
    ? `The host has ${gib(memory.host_available)} available and keeps 1 GiB free, too little for another paper run`
    : `Running paper runs reserve ${gib(memory.reserved)} of the ${gib(memory.budget)} paper memory, too little for another`;
}
