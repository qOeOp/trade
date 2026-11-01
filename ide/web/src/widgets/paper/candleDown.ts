// The candle chart's side of the time a chain was offline (downLook.ts). Its time scale counts candles, not
// minutes, so the stretch gets room as blank candles (the chart's whitespace), one a period between the last
// candle before the stop and the first after the next start, and at least as many as make MIN px at the
// spacing shown, so the cover lies over blanks only. The chart then counts its places on the time scale
// (`times`), blanks included, where it counted candles.
import { candleOpen, type Candle } from "../../lib/bars";
import type { Restart } from "../../model/paper";
import { downSlots, downsOf, MIN, type Down } from "./downLook";

/** Each offline stretch from the candle at or before its stop to the first candle at or after the next start
 *  (s), at `minutes`; one with no candle either side is left out. */
export function candleDowns(data: readonly Candle[], restarts: readonly Restart[], minutes: number): Down[] {
  return downsOf(restarts).flatMap((d) => {
    const from = candleOpen(d.from * 1e9, minutes), to = candleOpen(d.to * 1e9, minutes);
    const before = data.filter((k) => k.time <= from).at(-1), after = data.find((k) => k.time >= to && k.time > (before?.time ?? -Infinity));
    return before && after ? [{ ...d, from: before.time, to: after.time }] : [];
  });
}

/** How many blanks a stretch takes at least, its candles `spacing` px apart. */
export const slotsFor = (spacing: number) => (spacing > 0 ? Math.ceil(MIN / spacing) : 0);

/** The candles' places on the time scale with the blanks between them (at least `least` a stretch), oldest first. */
export function onScale(data: readonly Candle[], downs: readonly Down[], minutes: number, least: number): { times: number[]; blanks: number[] } {
  const blanks = downSlots(data.map((k) => k.time), downs, minutes * 60, least);
  return { times: blanks.length ? [...data.map((k) => k.time), ...blanks].sort((a, b) => a - b) : data.map((k) => k.time), blanks };
}

/** The candle opening at `t` (s), -1 for a blank. */
export function candleAt(data: readonly Candle[], t: number): number {
  let lo = 0, hi = data.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (data[mid]!.time <= t) lo = mid; else hi = mid - 1; }
  return data[lo]?.time === t ? lo : -1;
}
