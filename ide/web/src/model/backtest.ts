// A sealed research replay (the Runs page's backtest stage) as the page reads it from its report
// (lib/trialApi.ts), only from what the ledger stores: a point a day of the account, compounded from its
// starting balance by the stored daily returns, with the day's mean gross exposure as a share of it and
// the cycles held that day; the cycles as closed trades (no prices or sizes are stored for them); the
// deepest drawdown the seal measured at bar closes, peak and trough; and the account and trade stats
// Details shows, as a paper run's (account.ts). Without a recorded starting balance there is no equity.
import { amount, symbolOf } from "../lib/paperApi";
import type { TrialReport } from "../lib/trialApi";
import { tradeStats, type Account, type TradeStats } from "./account";
import type { Closed } from "./trades";

/** A cycle as a closed trade: `pnl` after fees and funding, `gross` its price move alone. */
export type Cycle = Closed & { fees: number; funding: number; gross: number; type: string };
/** A day: its start (s), return, closing equity, gross exposure (share of equity) and cycles held. */
export type Day = { time: number; ret: number; equity: number; exposure: number | null; held: number };
export type Backtest = {
  trial: number; starting: number | null; days: Day[]; cycles: Cycle[];
  /** The sealed deepest drawdown: its depth, peak and trough (s). */
  drawdown: { depth: number; peak: number; trough: number } | null;
  /** The trade window (ms). */
  window: [number, number];
  image: string | null; execution: string | null; account: Account | null; stats: TradeStats | null;
};

const DAY_MS = 86_400_000;
/** The report's times: UTC, written without a zone. */
const ms = (text: string) => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
const value = (m: { value: number | string | null } | undefined) => amount(m?.value ?? null);

export function backtest(r: TrialReport): Backtest {
  const window: [number, number] = [ms(r.trade_window.trade_start), ms(r.trade_window.trade_end)];
  const cycles: Cycle[] = (r.tables?.positions ?? []).map((c): Cycle => {
    const type = c.closing_order_type ?? "";
    return {
      id: `${r.trial_id}:${c.seq}`, symbol: symbolOf(c.instrument_id), long: c.side.toLowerCase() === "long", quantity: 0, entry: null, exit: null,
      pnl: amount(c.realized_pnl), opened: c.ts_opened_ns / 1e6, closed: c.ts_closed_ns / 1e6,
      how: type.includes("STOP") ? "stop" : /LIMIT|TAKE_PROFIT/.test(type) ? "target" : "other",
      fees: amount(c.commissions) ?? 0, funding: amount(c.funding) ?? 0, gross: amount(c.price_pnl) ?? 0, type,
    };
  }).sort((a, b) => b.closed - a.closed);
  const starting = amount(r.cost_basis?.account?.starting_balance_usdt ?? null), rows = r.tables?.daily_returns ?? [];
  const days: Day[] = [];
  if (starting !== null && rows.every((d) => d.native_return !== null)) {
    let equity = starting;
    for (const d of rows) {
      equity *= 1 + d.native_return!;
      const from = d.ts_event_ns / 1e6, gross = amount(d.mean_gross_notional);
      days.push({ time: from / 1000, ret: d.native_return!, equity, exposure: gross === null || !equity ? null : gross / equity,
                  held: cycles.filter((c) => c.opened < from + DAY_MS && c.closed >= from).length });
    }
  }
  const dd = r.drawdown, depth = value(dd?.["mark_max_drawdown@2"]), peak = dd?.["peak_utc@2"]?.value, trough = dd?.["trough_utc@2"]?.value;
  const drawdown = depth !== null && typeof peak === "string" && typeof trough === "string" ? { depth, peak: ms(peak) / 1000, trough: ms(trough) / 1000 } : null;
  const account = starting === null || !days.length ? null : accountOf(starting, days, cycles, window, depth);
  const inMarket = value(r.capital?.["time_in_market@1"]);
  return {
    trial: r.trial_id, starting: days.length ? starting : null, days, cycles, drawdown, window,
    image: r.runtime?.image_digest ?? null, execution: r.cost_basis?.account?.execution ?? null,
    account, stats: account && { ...tradeStats(account, []), inMarket },
  };
}

/** The account over the window: at its end, what moved it (the cycles' price moves, fees and funding;
 *  nothing open), the drawdown below the daily peak then and the sealed deepest. */
function accountOf(starting: number, days: readonly Day[], cycles: readonly Cycle[], window: [number, number], deepest: number | null): Account {
  const equity = days.at(-1)!.equity, net = equity - starting, sum = (pick: (c: Cycle) => number) => cycles.reduce((s, c) => s + pick(c), 0);
  const fees = sum((c) => c.fees), funding = sum((c) => c.funding), peak = Math.max(starting, ...days.map((d) => d.equity));
  return {
    starting, equity, net, ret: equity / starting - 1, gross: net + fees - funding, fees, funding, open: 0, holding: 0,
    drawdown: 1 - equity / peak, maxDrawdown: deepest, path: days.map((d) => [d.time * 1e9, d.equity]),
    start: window[0], end: window[1], trades: [...cycles],
  };
}

/** When any cycle was open (ms), overlapping ones joined, oldest first. */
export function cyclesHeld(cycles: readonly Cycle[]): [number, number][] {
  const out: [number, number][] = [];
  for (const c of [...cycles].sort((a, b) => a.opened - b.opened)) {
    const top = out.at(-1);
    if (top && c.opened <= top[1]) top[1] = Math.max(top[1], c.closed); else out.push([c.opened, c.closed]);
  }
  return out;
}
