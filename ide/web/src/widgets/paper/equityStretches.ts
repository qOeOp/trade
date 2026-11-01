// The Runs page's stretches (state/stretches.ts) as the equity chart's one line. Each stretch's minutes
// follow the one before it on the chart's axis with nothing between them: the chart places its points by
// index, so the time between two stretches takes no room and shows only as the jump of the axis's dates.
// Each stretch is scaled to start where the one before it ended, so the line runs on unbroken, but for an
// invalid chain's (model/ending.ts): its evidence is untrusted, so the next starts where the one before it
// ended, the line broken between them, as nothing joins onto an invalid run in a chain either
// (model/chain.ts); its peak is
// its own, so no stretch carries a drawdown its own account never had; the pace is one curve from the
// first stretch's start, compounding over the stretches' own time only (nothing ran in between), so it and
// the fill against it run on across a seam. What the chart reads beside equity is each stretch's own,
// scaled likewise: the shown stretch's in full, the others' exposure alone, as they draw no more.
import { amount, type PaperRun } from "../../lib/paperApi";
import { equityReadings, type Reading } from "../../model/equityReadings";
import { days as daysOf, fills as fillsOf, restartsOf, type Restart } from "../../model/paper";
import { runName } from "../../model/stage";
import type { Stretch } from "../../state/stretches";
import type { DayBar, EquityPoint } from "./equityLayers";
import { withDowns } from "./equityResolution";

/** A stretch as the chart places it: its name and chain's latest run, whether it is the one shown, its
 *  first and last minute (s) and their indexes among the minutes, its scale and its own starting balance. */
/** A stretch's name: its chain's (runName), on the paper stage, said invalid when it is. */
export const stretchName = (chain: readonly PaperRun[]) => `Paper · ${runName(chain)}${chain.at(-1)!.status === "invalid" ? " · invalid" : ""}`;

export type Placed = { label: string; run: PaperRun; selected: boolean; from: number; to: number; first: number; last: number; scale: number; starting: number };
/** The line: every minute, the stretches, their restarts, the readings by minute (s) and the shown
 *  stretch's days. */
export type Line = { minutes: EquityPoint[]; placed: Placed[]; restarts: Restart[]; readings: Map<number, Reading>; days: DayBar[] };

const YEAR_S = 365 * 86_400, START = 100_000;
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const scaled = (v: number | null, k: number) => (v === null ? null : v * k);

/** The stretches as one line, a pace for `annual` a year (none when null); `readings` whether to read
 *  beside equity at all. A stretch that would start before the last one ends is left out. */
export function continuous(stretches: readonly Stretch[], annual: number | null, readings: boolean): Line {
  const line: Line = { minutes: [], placed: [], restarts: [], readings: new Map(), days: [] }, { minutes, placed } = line;
  let carried: number | null = null, elapsed = 0, base: number | null = null, anew = false;
  for (const { chain, piece, selected } of stretches) {
    const path = piece.readings?.equity ?? [];
    if (!path.length || Math.floor(path[0]![0] / 1e9) <= (minutes.at(-1)?.time ?? -Infinity)) continue;
    const starting = amount(piece.readings?.starting_balance_usdt) ?? START, scale: number = carried === null ? 1 : carried / starting, k = placed.length;
    base ??= starting;
    const started = piece.readings?.started_ns ?? piece.seal?.started_ns ?? null, t0 = Math.floor((started ?? path[0]![0]) / 1e9);
    let peak = starting * scale;
    const own: EquityPoint[] = [];
    for (const [ns, v] of path) {
      const time = Math.floor(ns / 1e9), value = v * scale;
      peak = Math.max(peak, value);
      const p: EquityPoint = { time, value, peak, pace: annual === null ? null : base * (1 + annual) ** ((elapsed + time - t0) / YEAR_S), stretch: k };
      if (own.at(-1)?.time === time) own[own.length - 1] = p; else own.push(p);
    }
    if (anew) own[0] = { ...own[0]!, cut: true };
    const restarts = restartsOf(piece.lines), points = withDowns(own, restarts), first = minutes.length;
    minutes.push(...points);
    line.restarts.push(...restarts);
    placed.push({ label: stretchName(chain), run: chain.at(-1)!, selected, from: points[0]!.time, to: points.at(-1)!.time, first, last: minutes.length - 1, scale, starting });
    anew = chain.at(-1)!.status === "invalid";  // the next stretch does not carry on from this one: the line breaks
    if (!anew) carried = path.at(-1)![1] * scale;
    elapsed += points.at(-1)!.time - t0;
    if (selected) line.days = daysOf(path, starting, []).map((d) => ({ from: dayStart(d.day), ret: d.ret }));
    if (!readings) continue;
    for (const [t, r] of equityReadings(path, piece.lines, fillsOf(piece.lines), piece.closes, starting)) {
      line.readings.set(t, selected ? { ...r, balance: scaled(r.balance, scale), before: scaled(r.before, scale), hold: scaled(r.hold, scale) }
        : { balance: null, before: null, margin: null, exposure: r.exposure, hold: null });
    }
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

/** The seconds of minutes between `a` and `b` (s): the span a step is picked for, the time between two
 *  stretches left out. */
export const covered = (minutes: readonly EquityPoint[], a: number, b: number) => Math.max(0, from(minutes, b + 1) - from(minutes, a)) * 60;

/** The view a stretch first shows with (a logical range over `points`): the shown stretch (`k`) over the
 *  right 85% of the pane and the end of the one before it over the left 15%; the shown stretch alone when
 *  it is the first. */
export function firstView(points: readonly EquityPoint[], k: number): { from: number; to: number } | null {
  const a = points.findIndex((p) => p.stretch === k), b = lastWhere(points, (p) => p.stretch === k);
  if (a < 0) return null;
  return { from: a - Math.min(a, ((b - a + 1) * 15) / 85), to: b };
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
