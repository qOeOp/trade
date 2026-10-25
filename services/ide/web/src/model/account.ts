// A paper run's account as the Paper page shows it, from the journal so far, the last minute's state and
// the readings (or, once sealed, the seal): equity and what moved it since the start (closed trades
// before fees, fees, funding, open positions), the drawdown now and at its deepest, the return a minimum
// annual return asks for by now, and what its closed trades say.
import { amount, type JournalLine, type Live, type PaperState, type Seal } from "../lib/paperApi";
import { fills, spans } from "./paper";
import { trades, type Closed } from "./trades";

const YEAR_MS = 365 * 86_400_000;

export type Account = {
  starting: number; equity: number | null; net: number | null; ret: number | null;
  /** Closed trades before fees, so that gross − fees + funding + open = net. */
  gross: number | null; fees: number; funding: number; open: number | null; holding: number;
  drawdown: number | null; maxDrawdown: number | null; path: readonly [number, number][];
  start: number | null; end: number; trades: Closed[];
};

export function account(lines: readonly JournalLine[], state: PaperState | null, readings: Live | null, seal: Seal | null, now = Date.now()): Account {
  const fees = lines.reduce((sum, l) => sum + (l.kind === "order" && l.type === "OrderFilled" ? amount(l.commission) ?? 0 : 0), 0);
  const path = readings?.equity ?? [];
  const starting = amount(readings?.starting_balance_usdt) ?? 100_000;
  const equity = amount(seal?.final_equity_usdt ?? readings?.final_equity_usdt);
  let peak = starting;
  for (const [, value] of path) peak = Math.max(peak, value);
  const latest = path[path.length - 1]?.[1];
  // A sealed run's positions were booked at its stop: nothing is open any more.
  const open = seal ? 0 : state ? state.positions.reduce((sum, p) => sum + (amount(p.unrealized_pnl) ?? 0), 0) : null;
  const funding = amount(readings?.funding_usdt) ?? 0;
  const net = equity === null ? null : equity - starting;
  const started = seal?.started_ns ?? readings?.started_ns ?? null;
  return {
    starting, equity, net, ret: seal?.total_return ?? readings?.total_return ?? null,
    gross: net === null || open === null ? null : net + fees - funding - open, fees, funding, open,
    holding: seal ? 0 : state?.positions.length ?? 0,
    drawdown: seal ? null : latest != null ? 1 - latest / peak : null, maxDrawdown: seal?.max_drawdown ?? readings?.max_drawdown ?? null,
    path, start: started === null ? null : started / 1e6, end: seal?.stopped_ns ? seal.stopped_ns / 1e6 : now, trades: trades(lines),
  };
}

/** The return a minimum annual return asks for after the run's time so far, compounding. */
export const neededReturn = (annual: number, a: Account) => (a.start === null ? null : (1 + annual) ** ((a.end - a.start) / YEAR_MS) - 1);

export type TradeStats = {
  winRate: number | null; profitFactor: number | null; perTrade: number | null; hold: number | null;
  inMarket: number | null; longs: number; shorts: number;
};

/** What the closed trades say (win rate is a report dimension, never a target), and the share of the
 *  run's time it held any position. */
export function tradeStats(a: Account, lines: readonly JournalLine[]): TradeStats {
  const closed = a.trades.filter((t) => t.pnl !== null), pnl = closed.map((t) => t.pnl!);
  const won = pnl.filter((p) => p > 0).reduce((s, p) => s + p, 0), lost = -pnl.filter((p) => p < 0).reduce((s, p) => s + p, 0);
  const found = fills(lines);
  let inMarket: number | null = null;
  if (a.start !== null && a.end > a.start) {
    // The union of every contract's held spans, so two held at once count once.
    const held = [...new Set(found.map((f) => f.symbol))].flatMap((s) => spans(found, s).map(([from, to]) => [Math.max(from, a.start!), Math.min(to ?? a.end, a.end)] as const))
      .filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0]);
    let covered = 0, reach = a.start;
    for (const [x, y] of held) if (y > reach) { covered += y - Math.max(x, reach); reach = y; }
    inMarket = covered / (a.end - a.start);
  }
  return {
    winRate: closed.length ? pnl.filter((p) => p > 0).length / closed.length : null,
    profitFactor: lost > 0 ? won / lost : null, perTrade: closed.length ? pnl.reduce((s, p) => s + p, 0) / closed.length : null,
    hold: a.trades.length ? a.trades.reduce((s, t) => s + (t.closed - t.opened), 0) / a.trades.length : null,
    inMarket, longs: a.trades.filter((t) => t.long).length, shorts: a.trades.filter((t) => !t.long).length,
  };
}
