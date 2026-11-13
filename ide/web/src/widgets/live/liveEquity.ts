// A live run's account as the equity chart's one line: its budget plus its result at the venue's mark, a point
// a minute (engine/live_session.py record_minute), with the pace the minimum annual return asks for from the budget
// over the time the run has run. A minute whose result is unknown (a position open without a price) is left
// out, so the line runs across it.
import type { Equity } from "../paper/EquityReading";
import { withDowns } from "../paper/equityResolution";
import { entryLows, stretchPoints, type Line } from "../paper/equityStretches";
import { fixed } from "../../lib/paperApi";
import { YEAR_S } from "../../lib/time";
import type { LiveRun } from "../../model/liveTrading";

/** The line of `equity`, a pace for `annual` a year (none when null); null while no minute is known. */
export function liveLine(equity: NonNullable<LiveRun["equity"]>, annual: number | null): Line | null {
  const { budget } = equity, known = equity.minutes.filter((m): m is readonly [number, number] => m[1] !== null);
  if (!known.length) return null;
  const t0 = known[0]![0];
  // A run's last row is the minute it stopped in, after that minute's first mark: the later one stands.
  const own = stretchPoints(known, 1, budget, 0, annual === null ? null : (time) => budget * (1 + annual) ** ((time - t0) / YEAR_S));
  entryLows(own);
  const minutes = withDowns(own, []);
  return {
    minutes, restarts: [], readings: new Map(), days: [], drops: null, sealed: 0,
    placed: [{ label: "Live", run: null, tested: false, selected: true, from: minutes[0]!.time, to: minutes.at(-1)!.time, first: 0, last: minutes.length - 1, scale: 1, starting: budget }],
  };
}

/** The Equity switch's reading: the last known account, split at the point, and its return on the budget. */
export function liveReading(equity: LiveRun["equity"]): Equity | null {
  const last = equity?.minutes.filter((m) => m[1] !== null).at(-1)?.[1];
  if (last == null || !equity) return null;
  const [whole = "", cents = ""] = (fixed(last, 2) ?? "").split(".");
  return { whole, cents, ret: last / equity.budget - 1 };
}
