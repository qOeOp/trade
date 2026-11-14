import { dateTime, type TimeZone } from "../lib/time";
// The current runner's phase and the historical data drawn beside it are distinct facts.
import type { JournalLine, PaperRun } from "../lib/paperApi";
import type { DailyCloses } from "./equityReadings";

export const LAG_MS = 2 * 60_000;
/** An unsealed runner before its first bar: its declared input boundary, never an older run's. */
export function waitingUntil(run: PaperRun): number | null {
  if (run.state !== "running" || run.readings?.last_bar_ns != null) return null;
  return run.readings?.input_start_ns != null ? run.readings.input_start_ns / 1e6 : null;
}
export const utcMinute = (ms: number, zone: TimeZone = "UTC") => dateTime(ms, zone, "minute");
export const waitingText = (until: number, now: number, zone: TimeZone = "UTC") => now < until
  ? `Waiting for warm-up until ${utcMinute(until, zone)}` : now - until > LAG_MS
    ? `No first bar · scheduled start ${utcMinute(until, zone)}` : `Starting after warm-up · scheduled ${utcMinute(until, zone)}`;

/** A chart's last observed bar, distinct from its coarser candle's open and from the wall clock. */
export function observedThrough(bars: readonly JournalLine[], closes: DailyCloses): number | null {
  const times = [...Object.values(closes).map((c) => c.at(-1)?.[0] ?? 0), Number(bars.at(-1)?.ts_event ?? 0)];
  const last = Math.max(...times);
  return last ? last / 1e6 : null;
}
