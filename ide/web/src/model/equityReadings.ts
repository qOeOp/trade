// What the Account chart reads beside equity, each minute, from the journal (paper.equity_path's minutes):
// the balance (equity less the open profit then), equity before costs (fees and funding added back), the
// margin in use (balance less free balance) and the gross exposure (each contract's size held, at its
// close then, summed), both as shares of equity, and an equal-weight buy and hold of the run's contracts
// from its first minute, in the starting balance. A snapshot is taken as its minute ends, so it carries
// the fills, settlements and closes up to then.
import { amount, type JournalLine } from "../lib/paperApi";
import type { Fill } from "./paper";

export type Reading = { balance: number | null; before: number | null; margin: number | null; exposure: number | null; hold: number | null };
export type Closes = Readonly<Record<string, readonly (readonly [number, number])[]>>;
const MINUTE_NS = 60e9;

/** A settlement's funding cash flow (ledger/paper.py _funding): a positive rate moves money from longs to shorts. */
const funding = (l: JournalLine) => {
  const rate = amount(l.stream_rate), mark = amount(l.mark), held = Array.isArray(l.positions) ? l.positions as { signed_qty?: unknown }[] : [];
  return rate === null || mark === null ? 0 : -held.reduce((q, p) => q + (amount(p.signed_qty) ?? 0), 0) * mark * rate;
};

/** The readings at each minute of `path` ([minute ns, equity]), by the minute in seconds. */
export function equityReadings(path: readonly (readonly [number, number])[], lines: readonly JournalLine[], fills: readonly Fill[], closes: Closes, starting: number): Map<number, Reading> {
  const snapshots = new Map(lines.filter((l) => l.kind === "snapshot").map((l) => [Number(l.minute_ns), l]));
  const costs = [
    ...lines.filter((l) => l.kind === "order" && l.type === "OrderFilled").map((l) => [Number(l.ts_event), amount(l.commission) ?? 0] as const),
    ...lines.filter((l) => l.kind === "funding_settlement").map((l) => [Number(l.settlement_ns), -funding(l)] as const),
  ].sort((a, b) => a[0] - b[0]);
  const moves = [...fills].sort((a, b) => a.ms - b.ms);
  const symbols = Object.keys(closes).filter((s) => closes[s]!.length);
  const at = new Map(symbols.map((s) => [s, 0])), last = new Map<string, number>(), base = new Map<string, number>(), held = new Map<string, number>();
  const found = new Map<number, Reading>();
  let cost = 0, c = 0, m = 0;
  for (const [minute, equity] of path) {
    const end = minute + MINUTE_NS;
    while (c < costs.length && costs[c]![0] <= end) cost += costs[c++]![1];
    while (m < moves.length && moves[m]!.ms * 1e6 <= end) { const f = moves[m++]!; held.set(f.symbol, (held.get(f.symbol) ?? 0) + (f.buy ? f.qty : -f.qty)); last.set(f.symbol, last.get(f.symbol) ?? f.px); }
    for (const s of symbols) {
      const series = closes[s]!;
      let i = at.get(s)!;
      while (i < series.length && series[i]![0] <= end) last.set(s, series[i++]![1]);
      at.set(s, i);
      if (!base.has(s) && i > 0) base.set(s, series[i - 1]![1]);
    }
    const snap = snapshots.get(minute), open = amount(snap?.unrealized_pnl), total = amount(snap?.balance_total), free = amount(snap?.balance_free);
    const gross = [...held].reduce((sum, [s, q]) => sum + Math.abs(q) * (last.get(s) ?? 0), 0);
    // Each contract bought for an equal share of the start at its first close; one with no close yet is cash.
    const share = starting / (symbols.length || 1);
    const hold = symbols.length ? symbols.reduce((sum, s) => sum + (base.has(s) ? (share * last.get(s)!) / base.get(s)! : share), 0) : null;
    found.set(Math.floor(minute / 1e9), {
      balance: open === null ? null : equity - open, before: equity + cost,
      margin: total === null || free === null || !equity ? null : (total - free) / equity,
      exposure: symbols.length && equity ? gross / equity : null, hold,
    });
  }
  return found;
}

