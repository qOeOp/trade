// The Runs page's stretches as the equity chart's one line: the version's backtest first (model/backtest.ts),
// a point a day, then each chain of its paper runs (state/stretches.ts), a point a minute. Each stretch's
// points follow the one before it on the chart's axis with nothing between them: the chart places its
// points by index, so the time between two stretches takes no room and shows only as the jump of the
// axis's dates. Each stretch is scaled to start where the one before it ended, so the line runs on
// unbroken, but for an invalid chain's (model/ending.ts): its evidence is untrusted, so the next starts
// where the one before it ended, the line broken between them, as nothing joins onto an invalid run in a
// chain either (model/chain.ts); its peak is its own, so no stretch carries a drawdown its own account
// never had; the pace is one curve from the first stretch's start, compounding over the stretches' own
// time only (nothing ran in between), so it and the fill against it run on across a seam. What the chart
// reads beside equity is each stretch's own, scaled likewise: the shown stretch's in full, the others'
// exposure alone, as they draw no more. A day's point sits at the day's start and is the account at its
// close, as a coarser step's point is (equityResolution.ts).
import { amount, type PaperRun } from "../../lib/paperApi";
import type { Backtest } from "../../model/backtest";
import { equityReadings, type Reading } from "../../model/equityReadings";
import { days as daysOf, fills as fillsOf, restartsOf, type Restart } from "../../model/paper";
import { runName } from "../../model/stage";
import type { Stretch } from "../../state/stretches";
import type { DayBar, EquityPoint } from "./equityLayers";
import type { Episode } from "./equityNotes";
import { stepFor, withDowns } from "./equityResolution";

/** A paper stretch's name: its chain's (runName), said invalid when it is. */
export const stretchName = (chain: readonly PaperRun[]) => `Paper · ${runName(chain)}${chain.at(-1)!.status === "invalid" ? " · invalid" : ""}`;

/** A stretch as the chart places it: its name and chain's latest run (null: the backtest), whether it is
 *  the one shown, its first and last point's time (s) and their indexes, its scale and own starting balance. */
export type Placed = { label: string; run: PaperRun | null; selected: boolean; from: number; to: number; first: number; last: number; scale: number; starting: number };
/** The line: every point, the stretches, their restarts, the readings by point (s), the shown stretch's
 *  days and, when it is the backtest, its sealed deepest drawdown at the days that hold its ends (null:
 *  found from the points); `sealed` the backtest's sealed depth, the dot band's scale at least. */
export type Line = { minutes: EquityPoint[]; placed: Placed[]; restarts: Restart[]; readings: Map<number, Reading>; days: DayBar[]; drops: Episode[] | null; sealed: number };
/** A stretch to join: its points' own equity by time (s), when its own clock starts (s), how far a
 *  point's value lies after its time (s), and what the chart reads of it. */
type Segment = {
  label: string; run: PaperRun | null; selected: boolean; path: [number, number][]; starting: number; t0: number; lead: number; invalid: boolean;
  restarts: Restart[]; days: () => DayBar[]; readings: () => Map<number, Reading>;
};

const YEAR_S = 365 * 86_400, DAY_S = 86_400, START = 100_000;
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const scaled = (v: number | null, k: number) => (v === null ? null : v * k);

function paper({ chain, piece, selected }: Stretch): Segment {
  const ns = piece.readings?.equity ?? [], starting = amount(piece.readings?.starting_balance_usdt) ?? START;
  const started = piece.readings?.started_ns ?? piece.seal?.started_ns ?? null;
  return {
    label: stretchName(chain), run: chain.at(-1)!, selected, path: ns.map(([t, v]) => [Math.floor(t / 1e9), v]), starting,
    t0: Math.floor((started ?? ns[0]?.[0] ?? 0) / 1e9), lead: 0, invalid: chain.at(-1)!.status === "invalid", restarts: restartsOf(piece.lines),
    days: () => daysOf(ns, starting, []).map((d) => ({ from: dayStart(d.day), ret: d.ret })),
    readings: () => equityReadings(ns, piece.lines, fillsOf(piece.lines), piece.closes, starting),
  };
}

function tested(b: Backtest, selected: boolean): Segment {
  return {
    label: `Backtest · trial ${b.trial}`, run: null, selected, path: b.days.map((d) => [d.time, d.equity]), starting: b.starting!,
    t0: b.window[0] / 1000, lead: DAY_S, invalid: false, restarts: [], days: () => b.days.map((d) => ({ from: d.time, ret: d.ret })),
    readings: () => new Map(b.days.map((d) => [d.time, { balance: null, before: null, margin: null, exposure: d.exposure, hold: null, positions: d.held }])),
  };
}

/** The backtest (`backtest`, with a starting balance, shown when `testing`) and the paper stretches as one
 *  line, a pace for `annual` a year (none when null); `readings` whether to read beside equity at all.
 *  A stretch that would start before the last one ends is left out. */
export function continuous(stretches: readonly Stretch[], annual: number | null, readings: boolean, backtest: Backtest | null = null, testing = false): Line {
  const line: Line = { minutes: [], placed: [], restarts: [], readings: new Map(), days: [], drops: null, sealed: 0 }, { minutes, placed } = line;
  const segments = [...(backtest?.starting != null && backtest.days.length ? [tested(backtest, testing)] : []), ...stretches.map(paper)];
  let carried: number | null = null, elapsed = 0, base: number | null = null, anew = false;
  for (const g of segments) {
    const { path, starting } = g;
    if (!path.length || path[0]![0] <= (minutes.at(-1)?.time ?? -Infinity)) continue;
    const scale: number = carried === null ? 1 : carried / starting, k = placed.length;
    base ??= starting;
    let peak = starting * scale;
    const own: EquityPoint[] = [];
    for (const [time, v] of path) {
      const value = v * scale;
      peak = Math.max(peak, value);
      const p: EquityPoint = { time, value, peak, pace: annual === null ? null : base * (1 + annual) ** ((elapsed + time + g.lead - g.t0) / YEAR_S), stretch: k, ...(g.lead ? { day: true } : {}) };
      if (own.at(-1)?.time === time) own[own.length - 1] = p; else own.push(p);
    }
    if (anew) own[0] = { ...own[0]!, cut: true };
    const points = withDowns(own, g.restarts), first = minutes.length;
    minutes.push(...points);
    line.restarts.push(...g.restarts);
    placed.push({ label: g.label, run: g.run, selected: g.selected, from: points[0]!.time, to: points.at(-1)!.time, first, last: minutes.length - 1, scale, starting });
    anew = g.invalid;  // the next stretch does not carry on from this one: the line breaks
    if (!anew) carried = path.at(-1)![1] * scale;
    elapsed += points.at(-1)!.time + g.lead - g.t0;
    if (g.selected) line.days = g.days();
    if (!readings) continue;
    for (const [t, r] of g.readings()) {
      line.readings.set(t, g.selected ? { ...r, balance: scaled(r.balance, scale), before: scaled(r.before, scale), hold: scaled(r.hold, scale) }
        : { balance: null, before: null, margin: null, exposure: r.exposure, hold: null });
    }
  }
  const d = placed[0]?.run === null ? backtest!.drawdown : null;
  line.sealed = d?.depth ?? 0;
  if (d && testing) {
    // At the days holding its peak and trough: the line has no finer points there.
    const at = (t: number) => minutes[Math.max(0, lastWhere(minutes, (p) => p.stretch === 0 && p.time <= t))]!;
    const peakDay = at(d.peak), troughDay = at(d.trough);
    line.drops = [{ from: peakDay.time, to: troughDay.time, peak: peakDay.value, trough: troughDay.value, depth: d.depth }];
  }
  return line;
}

/** The index of the first of `points` at or after `t` (s). */
function from(points: readonly { time: number }[], t: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid]!.time < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The index of the last of `points` that `test` holds for; -1 when none. */
export function lastWhere<T>(points: readonly T[], test: (p: T) => boolean): number {
  for (let i = points.length - 1; i >= 0; i--) if (test(points[i]!)) return i;
  return -1;
}

/** Between `a` and `b` (s), the seconds of minutes and the days' points (a point at any step): what a step
 *  is picked for, the time between two stretches left out. */
export function covered(minutes: readonly EquityPoint[], a: number, b: number): { span: number; days: number } {
  const i = from(minutes, a), j = from(minutes, b + 1);
  let days = 0;
  while (i + days < j && minutes[i + days]!.day) days++;  // the backtest's days come first
  return { span: Math.max(0, j - i - days) * 60, days };
}

/** The step (stepFor) for the points between `a` and `b` (s) across `width` px, `widen` times as many. */
export function stepOver(minutes: readonly EquityPoint[], a: number, b: number, width: number, current: number, widen = 1): number {
  const { span, days } = covered(minutes, a, b);
  return stepFor(span * widen, width, current, undefined, undefined, days * widen);
}

/** The view a stretch first shows with (a logical range over `points`): the shown stretch (`k`) over the
 *  right 85% of the pane and the end of the one before it over the left 15%; the shown stretch alone when
 *  it is the first. */
export function firstView(points: readonly EquityPoint[], k: number): { from: number; to: number } | null {
  const a = points.findIndex((p) => p.stretch === k), b = lastWhere(points, (p) => p.stretch === k);
  if (a < 0) return null;
  return { from: a - Math.min(a, ((b - a + 1) * 15) / 85), to: b };
}

/** Whether the shown stretch (`k`) holds at least half of the points between logical `a` and `b`: only then
 *  does the value axis fit it and its drawdowns get their depths, so a sliver of it beside a long backtest
 *  leaves the view to all of the line. */
export function focused(points: readonly EquityPoint[], k: number, a: number, b: number): boolean {
  let mine = 0, all = 0;
  for (let i = Math.max(0, Math.floor(a)); i <= Math.min(points.length - 1, Math.ceil(b)); i++, all++) if (points[i]!.stretch === k) mine++;
  return all > 0 && mine * 2 >= all;
}

/** The lowest and highest of the shown stretch's points (`k`) between logical `a` and `b`; null when none
 *  of them is in view. */
export function shownReach(points: readonly EquityPoint[], k: number, a: number, b: number): { minValue: number; maxValue: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = Math.max(0, Math.floor(a)); i <= Math.min(points.length - 1, Math.ceil(b)); i++) {
    const p = points[i]!;
    if (p.stretch === k && !p.down) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }
  }
  return lo <= hi ? { minValue: lo, maxValue: hi } : null;
}
