// The equity chart's yearly scorecards (equityZones' top row): over each calendar year (UTC, as the backtest's
// days) of the shown backtest, at the left of its own stretch of the row, two lines: the year's return, in the
// meets colour when it meets the return target and the misses colour when not, as Details marks it, and, while
// the buy and hold is shown, the buy and hold's return; each line's name (the year, `hold`) at the left and
// its figure at the right of the column, SPACE px apart at least. To their right, its P&L bars (equityShares).
// A year the backtest covers only part of is named as any other; its return is that part's, not annualised,
// and meets the pace's share of the annual target over those days (as the dashed pace line asks for). Each
// year is a unit of its own, INSET px in from its edges; its names give way first where they would leave its
// bars less than BARS px.
import { meets } from "../../model/semantics";
import { DAY_S, type Frame } from "./equityBands";
import type { Share } from "./equityShares";
import { LINE, UNIT } from "./equityZones";

/** A year of daily points: its year, first and last point (s), the months when only part of it is covered
 *  (`Oct–Dec`; null when whole), the days covered, its return, the buy and hold's return (null without one)
 *  and its P&L by contract. */
export type Year = { year: number; first: number; last: number; part: string | null; days: number; ret: number; hold: number | null; shares: readonly Share[] };
export type YearLook = { font: string; label: string; quiet: string; meets: string; misses: string; halo: string; grid: string };

const YEAR_DAYS = 365, PAD = 6, INSET = 4, BARS = 32, SPACE = 8;  // the pace's year (equityStretches' YEAR_S); px: from the words to the bars, from a year's edges, the bars' least, a name's from its figure
const month = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

/** The years of `points` (a point a day, at the day's start holding its close), oldest first: each opens at
 *  the year before's last equity, the first at `opening`; `hold` the buy and hold's equity at a point's time,
 *  which opens at `opening` too. */
export function yearsOf(points: readonly { time: number; value: number }[], opening: number, hold: ((t: number) => number | null) | null = null): Year[] {
  const out: Year[] = [];
  let open = opening, held: number | null = opening;
  for (let i = 0; i < points.length;) {
    const year = yearOf(points[i]!.time);
    let j = i;
    while (j < points.length && yearOf(points[j]!.time) === year) j++;
    const first = points[i]!.time, last = points[j - 1]!.time, close = points[j - 1]!.value, h = hold?.(last) ?? null;
    const whole = first <= Date.UTC(year, 0, 1) / 1000 && last + DAY_S >= Date.UTC(year + 1, 0, 1) / 1000;
    const part = whole ? null : month(first) === month(last) ? month(first) : `${month(first)}–${month(last)}`;
    out.push({ year, first, last, part, days: Math.round((last + DAY_S - first) / DAY_S), ret: close / open - 1, hold: h === null || held === null ? null : h / held - 1, shares: [] });
    open = close; held = h;
    i = j;
  }
  return out;
}

/** Whether a year's return meets `annual` (a whole year's), a part of a year its share over the days it
 *  covers; null without a target. */
export const yearMeets = (y: Year, annual: number | null): boolean | null =>
  annual === null ? null : meets(y.ret, y.part === null ? annual : (1 + annual) ** (y.days / YEAR_DAYS) - 1, true);

const signed = (v: number) => { const s = (+(v * 100).toFixed(1) || 0).toFixed(1); return `${+s > 0 ? "+" : ""}${s}%`.replace(/^-/, "−"); };

/** A line of a year's scorecard: its name and its figure, each a text and its colour. */
export type Line = { name: [string, string]; figure: [string, string] };

/** A year's lines: the year and its return, then the buy and hold's (when `hold`). */
export function linesOf(y: Year, annual: number | null, look: YearLook, hold = false): Line[] {
  const ok = yearMeets(y, annual), ret: Line = { name: [`${y.year}`, look.label], figure: [signed(y.ret), ok === null ? look.label : ok ? look.meets : look.misses] };
  return [ret, ...(hold && y.hold !== null ? [{ name: ["hold", look.quiet], figure: [signed(y.hold), look.quiet] } as Line] : [])];
}

/** Each year's edges (device px): half way to the next year's first point, the first's and last's at their points. */
export const edgesOf = ({ x }: Frame, years: readonly Year[]) =>
  years.map((y, k) => [k ? (x(years[k - 1]!.last) + x(y.first)) / 2 : x(y.first), k < years.length - 1 ? (x(y.last) + x(years[k + 1]!.first)) / 2 : x(y.last)] as const);

/** The years' scorecards, each at the left of the part of its year in view; where each year's bars go (device
 *  px), null where they have no room. */
export function yearText(f: Frame, years: readonly Year[], annual: number | null, hold: boolean, look: YearLook): ([number, number] | null)[] {
  const { c, hr, vr, w } = f, edges = edgesOf(f, years);
  c.save();
  c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
  Object.assign(c, { textBaseline: "middle", lineJoin: "round", lineWidth: 3 * hr, strokeStyle: look.halo });
  const out = years.map((y, k) => {
    const [a, b] = edges[k]!, lo = Math.max(a, 0) + INSET * hr, hi = Math.min(b, w) - INSET * hr, lines = linesOf(y, annual, look, hold);
    const most = (part: "name" | "figure") => Math.max(...lines.map((l) => c.measureText(l[part][0]).width)), figures = most("figure");
    // With their names, if the bars keep their room or there are none to keep; else the figures alone.
    const named = most("name") + SPACE * hr + figures, wide = [named, figures].find((n) => n + (PAD + BARS) * hr <= hi - lo) ?? (named <= hi - lo ? named : figures);
    if (wide > hi - lo) return null;
    lines.forEach(({ name, figure }, row) => {
      const middle = Math.round((UNIT.top + (UNIT.high - LINE * lines.length) / 2 + LINE * (row + 0.5)) * vr);
      const runs: [string, string, number][] = [...(wide > figures ? [[...name, Math.round(lo)] as [string, string, number]] : []), [...figure, Math.round(lo + wide - c.measureText(figure[0]).width)]];
      // The halo under all the words first, so none cuts into another.
      for (const [text, , x] of runs) c.strokeText(text, x, middle);
      for (const [text, colour, x] of runs) { c.fillStyle = colour; c.fillText(text, x, middle); }
    });
    const from = lo + wide + PAD * hr;
    return hi - from >= BARS * hr ? [from, hi] as [number, number] : null;
  });
  c.restore();
  return out;
}

