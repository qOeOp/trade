import { atom, useAtom } from "./atom";
import type { ResearchLine } from "../lib/lines";

export type LineIndex = { lines: ResearchLine[]; loaded: boolean; loading: boolean; error: string | null };
export const researchLines = atom<LineIndex>({ lines: [], loaded: false, loading: false, error: null });
export const useResearchLines = () => useAtom(researchLines);

let wanted: string | null | undefined;
let completed: string | null | undefined;
let reading: Promise<void> | null = null;

/** Start on page load, never on menu open. Retain entries while coalescing newer requested heads. */
export function readResearchLines(at: string | null, retry = false): Promise<void> {
  if (!retry && at === completed) return reading ?? Promise.resolve();
  wanted = at;
  if (reading) return reading;
  reading = (async () => {
    while (wanted !== undefined) {
      const target: string | null = wanted;
      wanted = undefined;
      researchLines.set({ ...researchLines.get(), loading: true, error: null });
      try {
        const response = await fetch(`/api/lines${target ? `?at=${encodeURIComponent(target)}` : ""}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Could not read research lines");
        completed = target;
        researchLines.set({ lines: body.lines as ResearchLine[], loaded: true, loading: true, error: null });
      } catch (e) {
        researchLines.set({ ...researchLines.get(), error: String(e) });
      }
      if (wanted === completed) wanted = undefined;
    }
  })().finally(() => {
    reading = null;
    researchLines.set({ ...researchLines.get(), loading: false });
  });
  return reading;
}
