// Each line's recommendation for the phone's Research tab, read from the ledger through the product's command line
// (GET /api/readings: `line list --all --readings`, as the graph's summary reads it, with no graph drawn), so every
// line has its reading as soon as the ledger does.
import type { ResearchLine } from "../lib/lines";
import { whileVisible } from "../lib/whileVisible";
import { atom, useAtom } from "./atom";

/** A line's recommendation: the version the latest recommendation judgment names, since when it has, the line's research
 *  trials and how many came after, and that version's latest research run: eligible now, and its readings while it is. */
export type LineReading = {
  recommended: string; since: string | null; research_runs: number; runs_since: number;
  trial_id: number | null; eligible: boolean | null; annual_return: number | null; max_drawdown: number | null;
};
type Listed = ResearchLine & { recommendation: LineReading | null };
const readings = atom<{ lines: Record<string, LineReading | null>; read: boolean; error: string | null }>({ lines: {}, read: false, error: null });
export const useLineReadings = () => useAtom(readings);

async function read(): Promise<void> {
  try {
    const response = await fetch("/api/readings", { cache: "no-store" });
    const body = await response.json().catch(() => null) as { lines?: Listed[]; message?: string } | null;
    if (!response.ok || !body?.lines) throw new Error(body?.message ?? `HTTP ${response.status}`);
    readings.set({ lines: Object.fromEntries(body.lines.map((l) => [l.name, l.recommendation])), read: true, error: null });
  } catch (error) {
    readings.set({ ...readings.get(), error: String(error) });  // the last ones stay
  }
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
