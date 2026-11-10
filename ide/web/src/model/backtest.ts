// A sealed research replay (the Runs page's backtest stage) as the page reads it from its report
// (lib/trialApi.ts), only from what the ledger stores: a point a day of the account, compounded from its
// starting balance by the stored daily returns, with the day's mean gross exposure as a share of it and
// the cycles held that day; the cycles as closed trades (no prices or sizes are stored for them); the
// deepest drawdown the seal measured at bar closes, peak and trough; and the account and trade stats
// Details shows, as a paper run's (account.ts), with what the report measures taken from its slices (what
// moved the account, win rate, average win and loss, expectancy). A cycle still open at the window's end
// is held until that end, as the report reads it. Without a recorded starting balance there is no equity.
import { amount, symbolOf } from "../lib/paperApi";
import type { TrialReport } from "../lib/trialApi";
import { tradeStats, type Account, type TradeStats } from "./account";
import type { Closed } from "./trades";

/** A cycle as a closed trade: `pnl` after fees and funding, `gross` its price move alone; `open` when it was
 *  still open at the window's end, `closed` then being that end. */
export type Cycle = Closed & { fees: number; funding: number; gross: number; type: string; open: boolean };
/** A day: its start (s), return, closing equity, gross exposure (share of equity) and cycles held. */
type Day = { time: number; ret: number; equity: number; exposure: number | null; held: number };
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
const value = (m: { value: number | string | null } | null | undefined) => amount(m?.value ?? null);
/** The report's measure `name` (name@version) of its slice `id`. */
const sliced = (r: TrialReport, id: string, name: string) => value(r.slices?.find((s) => s.id === id)?.measures[name]);

export function backtest(r: TrialReport): Backtest {
  const window: [number, number] = [ms(r.trade_window.trade_start), ms(r.trade_window.trade_end)];
  const cycles: Cycle[] = (r.tables?.positions ?? []).map((c): Cycle => {
    const type = c.closing_order_type ?? "", open = c.ts_closed_ns === null;
    return {
      id: `${r.trial_id}:${c.seq}`, symbol: symbolOf(c.instrument_id), long: c.side.toLowerCase() === "long", quantity: 0, entry: null, exit: null,
      pnl: amount(c.realized_pnl), opened: c.ts_opened_ns / 1e6, closed: c.ts_closed_ns === null ? window[1] : c.ts_closed_ns / 1e6,
      how: type.includes("STOP") ? "stop" : /LIMIT|TAKE_PROFIT/.test(type) ? "target" : "other",
      fees: amount(c.commissions) ?? 0, funding: amount(c.funding) ?? 0, gross: amount(c.price_pnl) ?? 0, type, open,
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
  const account = starting === null || !days.length ? null : accountOf(r, starting, days, cycles, window, depth);
  const inMarket = value(r.capital?.["time_in_market@1"]), trade = (name: string) => sliced(r, "trade_structure", name);
  return {
    trial: r.trial_id, starting: days.length ? starting : null, days, cycles, drawdown, window,
    image: r.runtime?.image_digest ?? null, execution: r.cost_basis?.account?.execution ?? null,
    account, stats: account && { ...tradeStats(account, []), inMarket, winRate: trade("win_rate@1"), avgWin: trade("avg_win@1"),
                                 avgLoss: trade("avg_loss@1"), perTrade: trade("expectancy@1") },
  };
}

/** The account over the window: at its end, what moved it as the report's profit bridge gives it (the
 *  cycles' price moves, fees, funding and the open cycles' final mark; none when the report gives none),
 *  the drawdown below the daily peak then and the sealed deepest; its trades the closed cycles. */
function accountOf(r: TrialReport, starting: number, days: readonly Day[], cycles: readonly Cycle[], window: [number, number], deepest: number | null): Account {
  const equity = days.at(-1)!.equity, peak = Math.max(starting, ...days.map((d) => d.equity)), fee = sliced(r, "profit_bridge", "fee@1");
  return {
    starting, equity, net: equity - starting, ret: equity / starting - 1, gross: sliced(r, "profit_bridge", "price@1"),
    fees: fee === null ? null : -fee, funding: sliced(r, "profit_bridge", "funding@1"), open: sliced(r, "profit_bridge", "open_mark@1"),
    holding: cycles.filter((c) => c.open).length,
    drawdown: 1 - equity / peak, maxDrawdown: deepest, path: days.map((d) => [d.time * 1e9, d.equity]),
    start: window[0], end: window[1], trades: cycles.filter((c) => !c.open),
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
