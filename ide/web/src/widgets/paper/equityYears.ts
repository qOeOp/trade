// The equity chart's yearly scorecards (equityZones' top row): over each calendar year (UTC, as the backtest's
// days) of the shown backtest, at the left of its own stretch of the row, two lines: the year's return, in the
// meets colour when it meets the return target and the misses colour when not, as Details marks it, and, while
// shown, the buy and hold's and the equal-weight basket's returns; each line's name (the year, `hold`, `basket`) at the left and
// its figure at the right of the column, SPACE px apart at least. To their right, its P&L bars (equityShares).
// A year the backtest covers only part of is named as any other; its return is that part's, not annualised,
// and meets the pace's share of the annual target over those days (as the dashed pace line asks for). Each
// year is a unit of its own, INSET px in from its edges; its names give way first where they would leave its
// bars less than BARS px.
import { signedPct } from "../../lib/format";
import { meets } from "../../model/semantics";
import { DAY_S, YEAR_S } from "../../lib/time";
import type { Frame } from "./equityBands";
import type { Share } from "./equityShares";
import { LINE, UNIT_TOP, unitHigh } from "./equityZones";

/** A year of daily points: its year, first and last point (s), the months when only part of it is covered
 *  (`Oct–Dec`; null when whole), the days covered, its return, the buy and hold's and the basket's returns
 *  (null without one) and its P&L by contract. */
export type Year = { year: number; first: number; last: number; part: string | null; days: number; ret: number; hold: number | null; basket: number | null; shares: readonly Share[] };
/** Which benchmarks' lines a scorecard shows. */
export type Shown = { hold: boolean; basket: boolean };
const NONE: Shown = { hold: false, basket: false };
/** The lines a scorecard of `shown` holds at most. */
export const linesShown = (shown: Shown) => 1 + Number(shown.hold) + Number(shown.basket);
export type YearLook = { font: string; label: string; quiet: string; meets: string; misses: string; halo: string };

const PAD = 6, INSET = 4, BARS = 32, SPACE = 8;  // px: from the words to the bars, from a year's edges, the bars' least, a name's from its figure
const month = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

/** A benchmark's value at a point's time (null where it has none). */
type Bench = ((t: number) => number | null) | null;
/** The years of `points` (a point a day, at the day's start holding its close), oldest first: each opens at
 *  the year before's last equity, the first at `opening`; `hold` and `basket` the buy and hold's and the
 *  basket's equity at a point's time, each of which opens at `opening` too. */
export function yearsOf(points: readonly { time: number; value: number }[], opening: number, hold: Bench = null, basket: Bench = null): Year[] {
  const out: Year[] = [];
  let open = opening, held: number | null = opening, based: number | null = opening;
  const change = (now: number | null, before: number | null) => (now === null || before === null ? null : now / before - 1);
  for (let i = 0; i < points.length;) {
    const year = yearOf(points[i]!.time);
    let j = i;
    while (j < points.length && yearOf(points[j]!.time) === year) j++;
    const first = points[i]!.time, last = points[j - 1]!.time, close = points[j - 1]!.value, h = hold?.(last) ?? null, b = basket?.(last) ?? null;
    const whole = first <= Date.UTC(year, 0, 1) / 1000 && last + DAY_S >= Date.UTC(year + 1, 0, 1) / 1000;
    const part = whole ? null : month(first) === month(last) ? month(first) : `${month(first)}–${month(last)}`;
    out.push({ year, first, last, part, days: Math.round((last + DAY_S - first) / DAY_S), ret: close / open - 1, hold: change(h, held), basket: change(b, based), shares: [] });
    open = close; held = h; based = b;
    i = j;
  }
  return out;
}

/** Whether a year's return meets `annual` (a whole year's), a part of a year its share over the days it
 *  covers; null without a target. */
export const yearMeets = (y: Year, annual: number | null): boolean | null =>
  annual === null ? null : meets(y.ret, y.part === null ? annual : (1 + annual) ** ((y.days * DAY_S) / YEAR_S) - 1, true);

/** A line of a year's scorecard: its name and its figure, each a text and its colour. */
type Line = { name: [string, string]; figure: [string, string] };

/** A year's lines: the year and its return, then the buy and hold's and the basket's (each when shown and known). */
export function linesOf(y: Year, annual: number | null, look: YearLook, shown: Shown = NONE): Line[] {
  const ok = yearMeets(y, annual), ret: Line = { name: [`${y.year}`, look.label], figure: [signedPct(y.ret, 1), ok === null ? look.label : ok ? look.meets : look.misses] };
  const bench = (name: string, value: number | null, on: boolean): Line[] => (on && value !== null ? [{ name: [name, look.quiet], figure: [signedPct(value, 1), look.quiet] }] : []);
  return [ret, ...bench("hold", y.hold, shown.hold), ...bench("basket", y.basket, shown.basket)];
}

/** Each year's edges (device px): half way to the next year's first point, the first's and last's at their points. */
const edgesOf = ({ x }: Frame, years: readonly Year[]) =>
  years.map((y, k) => [k ? (x(years[k - 1]!.last) + x(y.first)) / 2 : x(y.first), k < years.length - 1 ? (x(y.last) + x(years[k + 1]!.first)) / 2 : x(y.last)] as const);

/** The years' scorecards, each at the left of the part of its year in view; where each year's bars go (device
 *  px), null where they have no room. */
export function yearText(f: Frame, years: readonly Year[], annual: number | null, shown: Shown, look: YearLook): ([number, number] | null)[] {
  const { c, hr, vr, w } = f, edges = edgesOf(f, years), high = unitHigh(linesShown(shown));
  c.save();
  c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
  Object.assign(c, { textBaseline: "middle", lineJoin: "round", lineWidth: 3 * hr, strokeStyle: look.halo });
  const out = years.map((y, k) => {
    const [a, b] = edges[k]!, lo = Math.max(a, 0) + INSET * hr, hi = Math.min(b, w) - INSET * hr, lines = linesOf(y, annual, look, shown);
    const most = (part: "name" | "figure") => Math.max(...lines.map((l) => c.measureText(l[part][0]).width)), figures = most("figure");
    // With their names, if the bars keep their room or there are none to keep; else the figures alone.
    const named = most("name") + SPACE * hr + figures, wide = [named, figures].find((n) => n + (PAD + BARS) * hr <= hi - lo) ?? (named <= hi - lo ? named : figures);
    if (wide > hi - lo) return null;
    lines.forEach(({ name, figure }, row) => {
      const middle = Math.round((UNIT_TOP + (high - LINE * lines.length) / 2 + LINE * (row + 0.5)) * vr);
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

