// Each line's recommendation for the phone's Research tab, read from the ledger through the product's command line
// (GET /api/readings: `line list --all --readings`, as the graph's summary reads it, with no graph drawn), so every
// line has its reading as soon as the ledger does.
import type { ResearchLine } from "../lib/lines";
import { polled, type Answer, type Poll } from "../lib/polled";
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

function map(answer: Answer): void {
  const body = answer?.body as { lines?: Listed[]; message?: string } | null | undefined;
  if (answer?.ok && body?.lines) readings.set({ lines: Object.fromEntries(body.lines.map((l) => [l.name, l.recommendation])), read: true, error: null });
  else readings.set({ ...readings.get(), error: body?.message ?? (answer ? `HTTP ${answer.status}` : "The page's server did not answer.") });  // the last ones stay
}

let poll: Poll | null = null;
/** Reads now and every 10 s while the page is visible and `on` was the last said. */
export function followReadings(on: boolean): void {
  if (!on) poll?.stop();
  else if (poll) void poll.read();
  else poll = polled("/api/readings", 10_000, map);
}
