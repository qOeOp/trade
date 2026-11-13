// A paper run's account as the Runs page shows it, from the journal so far, the last minute's state and
// the readings (or, once sealed, the seal): equity and what moved it since the start (closed trades
// before fees, fees, funding, open positions), the drawdown now and at its deepest, the return a minimum
// annual return asks for by now, and what its closed trades say.
import { amount, type JournalLine, type Readings, type PaperState, type Seal } from "../lib/paperApi";
import { YEAR_MS } from "../lib/time";
import { START } from "./chain";
import { heldSides } from "./held";
import { fills, restartsOf } from "./paper";
import { trades, type Closed } from "./trades";

export type Account = {
  starting: number; equity: number | null; net: number | null; ret: number | null;
  /** Closed trades before fees, so that gross − fees + funding + open = net. */
  gross: number | null; fees: number | null; funding: number | null; open: number | null;
  drawdown: number | null; maxDrawdown: number | null; path: readonly [number, number][];
  start: number | null; end: number; trades: Closed[];
};

export function account(lines: readonly JournalLine[], state: PaperState | null, readings: Readings | null, seal: Seal | null): Account {
  const fees = lines.reduce((sum, l) => sum + (l.kind === "order" && l.type === "OrderFilled" ? amount(l.commission) ?? 0 : 0), 0);
  const path = readings?.equity ?? [];
  const starting = amount(readings?.starting_balance_usdt) ?? START;
  const equity = amount(seal?.final_equity_usdt ?? readings?.final_equity_usdt);
  // A sealed run's positions were booked at its stop: nothing is open any more.
  const open = seal ? 0 : state ? state.positions.reduce((sum, p) => sum + (amount(p.unrealized_pnl) ?? 0), 0) : null;
  const funding = amount(readings?.funding_usdt) ?? 0;
  const net = equity === null ? null : equity - starting;
  const started = seal?.started_ns ?? readings?.started_ns ?? null;
  return {
    starting, equity, net, ret: seal?.total_return ?? readings?.total_return ?? null,
    gross: net === null || open === null ? null : net + fees - funding - open, fees, funding, open,
    drawdown: seal ? null : drawdownNow(starting, path), maxDrawdown: seal?.max_drawdown ?? readings?.max_drawdown ?? null,
    path, start: started === null ? null : started / 1e6, end: seal?.stopped_ns ? seal.stopped_ns / 1e6 : Date.now(), trades: trades(lines),
  };
}

/** How far below its highest (the starting balance or a later point) the equity is at the path's last point. */
export function drawdownNow(starting: number, path: readonly (readonly [number, number])[]): number | null {
  let peak = starting;
  for (const [, value] of path) peak = Math.max(peak, value);
  const latest = path.at(-1)?.[1];
  return latest == null ? null : 1 - latest / peak;
}

/** The return a minimum annual return asks for after the run's time from `start` to `end` (ms), compounding. */
export const neededReturn = (annual: number, start: number | null, end: number) => (start === null ? null : (1 + annual) ** ((end - start) / YEAR_MS) - 1);

/** How far a return is ahead of what the minimum asks for by now, and that in USDT: by the difference of the two
 *  figures as shown (four decimals), so the notes add up on screen. */
export function pace(ret: number | null | undefined, needed: number | null, starting: number): { ahead: number | null; usdt: number | null } {
  const shown = (n: number) => Math.round(n * 1e4) / 1e4;
  const ahead = needed === null || ret == null ? null : shown(ret) - shown(needed);
  return { ahead, usdt: ahead === null ? null : ahead * starting };
}

/** A paper run's return is annualized once it has run this long. */
export const ANNUAL_DAYS = 30;
/** A return over `days`, annualized once the run has run ANNUAL_DAYS days. */
export const annualized = (ret: number | null | undefined, days: number) => (ret != null && days >= ANNUAL_DAYS ? (1 + ret) ** (365 / days) - 1 : null);

type Side = { n: number; won: number; pnl: number };

export type TradeStats = {
  winRate: number | null; profitFactor: number | null; perTrade: number | null; hold: number | null;
  inMarket: number | null;
  /** The closed trades on each side: how many, how many won and their profit and loss together. */
  sides: Record<"long" | "short", Side>;
  /** The average winning and losing trade (the loss negative), the longest run of losing trades, and how
   *  many closed at their target, at their stop or otherwise. */
  avgWin: number | null; avgLoss: number | null; streak: number; exits: Record<Closed["how"], number>;
};

/** What the closed trades say (win rate is a report dimension, never a target), and the share of the
 *  run's time it held any position. */
export function tradeStats(a: Account, lines: readonly JournalLine[]): TradeStats {
  const closed = a.trades.filter((t) => t.pnl !== null), pnl = closed.map((t) => t.pnl!);
  const won = pnl.filter((p) => p > 0).reduce((s, p) => s + p, 0), lost = -pnl.filter((p) => p < 0).reduce((s, p) => s + p, 0);
  const wins = pnl.filter((p) => p > 0), losses = pnl.filter((p) => p < 0), count = (how: Closed["how"]) => closed.filter((t) => t.how === how).length;
  let streak = 0, run = 0;
  for (const p of pnl) { run = p < 0 ? run + 1 : 0; streak = Math.max(streak, run); }
  const side = (long: boolean): Side => {
    const mine = closed.filter((t) => t.long === long);
    return { n: mine.length, won: mine.filter((t) => t.pnl! > 0).length, pnl: mine.reduce((s, t) => s + t.pnl!, 0) };
  };
  const found = fills(lines);
  let inMarket: number | null = null;
  if (a.start !== null && a.end > a.start) {
    inMarket = heldSides(found, a.start, a.end, restartsOf(lines)).reduce((sum, [x, y]) => sum + y - x, 0) / (a.end - a.start);
  }
  return {
    winRate: closed.length ? pnl.filter((p) => p > 0).length / closed.length : null,
    profitFactor: lost > 0 ? won / lost : null, perTrade: closed.length ? pnl.reduce((s, p) => s + p, 0) / closed.length : null,
    hold: a.trades.length ? a.trades.reduce((s, t) => s + (t.closed - t.opened), 0) / a.trades.length : null,
    inMarket, sides: { long: side(true), short: side(false) },
    avgWin: wins.length ? won / wins.length : null, avgLoss: losses.length ? -lost / losses.length : null, streak,
    exits: { target: count("target"), stop: count("stop"), other: count("other") },
  };
}
