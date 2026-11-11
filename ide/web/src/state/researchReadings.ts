// Each line's recommendation as its newest drawn graph says it (GET /api/readings: the server's cached graphs
// only), for a phone's Research tab. A line not drawn yet is asked for once, when its row opens.
import type { SummaryWidget } from "../model/types";
import { whileVisible } from "../lib/whileVisible";
import { atom, useAtom } from "./atom";

export type LineReading = Pick<SummaryWidget, "recommended" | "reading" | "targets" | "recommendations" | "runs_since_recommendation_changed" | "research_runs" | "versions"> & { ledger_commit: string };
const readings = atom<{ lines: Record<string, LineReading>; read: boolean }>({ lines: {}, read: false });
export const useLineReadings = () => useAtom(readings);

async function read(line?: string): Promise<void> {
  try {
    const response = await fetch(`/api/readings${line ? `?line=${encodeURIComponent(line)}` : ""}`, { cache: "no-store" });
    const body = response.ok ? await response.json() as { lines: Record<string, LineReading> } : null;
    if (body) readings.set({ lines: body.lines, read: true });
  } catch { /* the last ones stay */ }
}

const asked = new Set<string>();
/** Asks the server to draw `line` once; the next reads have it when it is drawn. */
export function askReading(line: string): void {
  if (asked.has(line) || readings.get().lines[line]) return;
  asked.add(line);
  void read(line);
}

let following = false, started = false;
/** Reads now and every 10 s while the page is visible and `on` was the last said. */
export function followReadings(on: boolean): void {
  following = on;
  if (!on) return;
  void read();
  if (!started) whileVisible(() => { if (following) void read(); }, 10_000);
  started = true;
}
