// Positions left open when a runner ended are observations, not closing fills or current holdings.
import { amount, symbolOf, type JournalLine } from "../lib/paperApi";
import { eventMs } from "./paper";

export type Closes = Readonly<Record<string, readonly (readonly [number, number])[]>>;
export type StoppedPosition = {
  id: string; symbol: string; long: boolean; quantity: number; entry: number | null;
  last: number | null; pnl: number | null; opened: number; stopped: number; observed: number | null;
};
/** Last observed close at/before a cutoff (ms), never borrowing a price from before this position opened. */
export function closeAt(closes: readonly (readonly [number, number])[], cutoff: number, opened = -Infinity): readonly [number, number] | null {
  let lo = 0, hi = closes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (closes[mid]![0] / 1e6 <= cutoff) lo = mid + 1; else hi = mid; }
  const found = lo ? closes[lo - 1]! : null;
  return found && found[0] / 1e6 >= opened ? found : null;
}

/** Contract prices from an Account stream, or a contract stream's bars; neither writes a new fact. */
export function observedCloses(bars: readonly JournalLine[], closes: Closes): Closes {
  const found: Record<string, [number, number][]> = {};
  for (const b of bars) {
    const price = amount(b.close);
    if (price !== null) (found[symbolOf(b.instrument_id)] ??= []).push([Number(b.ts_event), price]);
  }
  return { ...closes, ...found };
}

/** Every earlier runner's residual position at its restart, plus the latest one's if sealed. The ids
 *  in a joined journal are already namespaced. A flat or genuinely closed position produces no row. */
export function stoppedPositions(lines: readonly JournalLine[], closes: Closes, stopped: number | null = null): StoppedPosition[] {
  const held = new Map<string, { line: JournalLine; opened: number }>(), out: StoppedPosition[] = [];
  const finish = (at: number) => {
    for (const [id, { line, opened }] of held) {
      const qty = amount(line.signed_qty) ?? 0, entry = amount(line.avg_px_open), symbol = symbolOf(line.instrument_id);
      if (!qty) continue;
      const observed = closeAt(closes[symbol] ?? [], at, opened), last = observed?.[1] ?? null;
      out.push({ id, symbol, long: qty > 0, quantity: Math.abs(qty), entry, last, opened, stopped: at,
        observed: observed ? observed[0] / 1e6 : null, pnl: last !== null && entry !== null ? (last - entry) * qty : null });
    }
    held.clear();
  };
  for (const l of lines) {
    if (l.kind === "restart") { finish(Number(l.from_ns) / 1e6); continue; }
    if (l.kind !== "position" || !l.position_id) continue;
    const id = String(l.position_id);
    if (l.type === "PositionClosed") held.delete(id);
    else held.set(id, { line: l, opened: l.type === "PositionOpened" ? eventMs(l) : held.get(id)?.opened ?? eventMs(l) });
  }
  if (stopped !== null) finish(stopped);
  return out.sort((a, b) => b.stopped - a.stopped);
}
