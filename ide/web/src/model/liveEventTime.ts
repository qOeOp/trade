import type { LiveEventRow } from "../lib/liveTradingDto";
import { nsMilliseconds } from "../lib/time";

export function liveEventTime(row: LiveEventRow) {
  const native = nsMilliseconds(row.ts_event);
  if (native !== null) return { ms: native, ns: row.ts_event!, source: "event" as const };
  const observed = nsMilliseconds(row.observed_ns);
  return observed === null ? null : { ms: observed, ns: row.observed_ns!, source: "observed" as const };
}
