// The equity chart's yearly scorecards (equityZones' top row): over each calendar year (UTC, as the backtest's
// days) of the shown backtest, at the left of its own stretch of the row, two lines: the year's return, in the
// meets colour when it meets the return target and the misses colour when not, as Details marks it, and, while
// the buy and hold is shown, the buy and hold's return. To their right, its P&L bars (equityShares). A year the
// backtest covers only part of says which months (`2021 Oct–Dec`); its return is that part's, not annualised,
// and meets the pace's share of the annual target over those days (as the dashed pace line asks for). Each
// year is a unit of its own, INSET px in from its edges; its lines are written in the richest form that leaves
// its bars BARS px.
import { meets } from "../../model/semantics";
import { DAY_S, type Frame } from "./equityBands";
import type { Share } from "./equityShares";
import { LINE, UNIT } from "./equityZones";

/** A year of daily points: its year, first and last point (s), the months when only part of it is covered
 *  (`Oct–Dec`; null when whole), the days covered, its return, the buy and hold's return (null without one)
 *  and its P&L by contract. */
export type Year = { year: number; first: number; last: number; part: string | null; days: number; ret: number; hold: number | null; shares: readonly Share[] };
export type YearLook = { font: string; label: string; quiet: string; meets: string; misses: string; halo: string; grid: string };

const YEAR_DAYS = 365, PAD = 6, INSET = 4, BARS = 32;  // the pace's year (equityStretches' YEAR_S); px: from the words to the bars, from a year's edges, the bars' least
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

type Words = [string, string][];  // runs of text and their colours

/** A year's lines, each in its forms richest first: the year (and its months) and return, then the buy and
 *  hold's return (when `hold`), each giving way to its figure alone. */
export function linesOf(y: Year, annual: number | null, look: YearLook, hold = false): Words[][] {
  const ok = yearMeets(y, annual), ret: Words = [[signed(y.ret), ok === null ? look.label : ok ? look.meets : look.misses]];
  const year: Words[] = [...(y.part ? [[[`${y.year} ${y.part} `, look.label], ...ret] as Words] : []), [[`${y.year} `, look.label], ...ret], ret];
  return [year, ...(hold && y.hold !== null ? [[[["hold ", look.quiet], [signed(y.hold), look.quiet]], [[signed(y.hold), look.quiet]]] as Words[]] : [])];
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
    const at = (level: number) => lines.map((forms) => forms[Math.min(level, forms.length - 1)]!), wide = (ls: Words[]) => Math.max(...ls.map((ws) => width(c, ws)));
    const levels = [0, 1, 2].map(at), room = (PAD + BARS) * hr;
    const fits = levels.find((ls) => wide(ls) + room <= hi - lo) ?? levels.find((ls) => wide(ls) <= hi - lo);
    if (!fits) return null;
    fits.forEach((words, row) => {
      const middle = Math.round((UNIT.top + (UNIT.high - LINE * fits.length) / 2 + LINE * (row + 0.5)) * vr);
      // The halo under all the words first, so none cuts into the one before it.
      for (const fill of [false, true]) {
        let x = Math.round(lo);
        for (const [text, colour] of words) {
          if (fill) { c.fillStyle = colour; c.fillText(text, x, middle); } else c.strokeText(text, x, middle);
          x += c.measureText(text).width;
        }
      }
    });
    const from = lo + wide(fits) + PAD * hr;
    return hi - from >= BARS * hr ? [from, hi] as [number, number] : null;
  });
  c.restore();
  return out;
}

const width = (c: CanvasRenderingContext2D, words: Words) => words.reduce((n, [text]) => n + c.measureText(text).width, 0);
