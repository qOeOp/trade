// The equity chart's yearly scorecard, on the stretches' names' line (equityZones): over each calendar year
// (UTC, as the backtest's days) of the shown backtest, the year's return and its deepest drawdown, each in
// the meets colour when it meets its target and the misses colour when not, as Details marks them, and,
// while the buy and hold is shown, its return that year after them, faint. A year the backtest covers only
// part of says which months (`2021 (Oct–Dec)`); its return is that part's, not annualised, and meets the
// pace's share of the annual target over those days (as the dashed pace line asks for). A year's drawdown is
// from its highest equity to its lowest after it, inside the year, counting from the equity it opened with.
// Each cell is centred over the part of its year in view, written in the richest form that fits: the buy
// and hold, the months, the year and the drawdown give way in turn; hairlines between the years.
import { meets } from "../../model/semantics";
import { DAY_S, span, type Frame } from "./equityBands";
import { ROW } from "./stretchCaptions";

/** A year of daily points: its year, first and last point (s), the months when only part of it is covered
 *  (`Oct–Dec`; null when whole), the days covered, its return and deepest drawdown, and the buy and hold's
 *  return (null without one). */
export type Year = { year: number; first: number; last: number; part: string | null; days: number; ret: number; dd: number; hold: number | null };
export type YearLook = { font: string; label: string; quiet: string; meets: string; misses: string; halo: string; grid: string };

const YEAR_DAYS = 365, PAD = 6, TICK = 12;  // the pace's year (equityStretches' YEAR_S); px either side of a cell's words; a hairline's height
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
    let j = i, peak = open, dd = 0;
    for (; j < points.length && yearOf(points[j]!.time) === year; j++) {
      const v = points[j]!.value;
      peak = Math.max(peak, v);
      dd = Math.max(dd, 1 - v / peak);
    }
    const first = points[i]!.time, last = points[j - 1]!.time, close = points[j - 1]!.value, h = hold?.(last) ?? null;
    const whole = first <= Date.UTC(year, 0, 1) / 1000 && last + DAY_S >= Date.UTC(year + 1, 0, 1) / 1000;
    const part = whole ? null : month(first) === month(last) ? month(first) : `${month(first)}–${month(last)}`;
    out.push({ year, first, last, part, days: Math.round((last + DAY_S - first) / DAY_S), ret: close / open - 1, dd, hold: h === null || held === null ? null : h / held - 1 });
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
const depth = (v: number) => `${(+(v * 100).toFixed(1) || 0).toFixed(1)}%`;

type Words = [string, string][];  // runs of text and their colours

/** A year's cell, richest first: with the buy and hold's return (when `hold`), the months, the year, the
 *  drawdown, giving way in that order. */
export function cellOf(y: Year, annual: number | null, limit: number | null, look: YearLook, hold = false): Words[] {
  const tone = (ok: boolean | null) => (ok === null ? look.label : ok ? look.meets : look.misses);
  const ret: Words = [[signed(y.ret), tone(yearMeets(y, annual))]], dd: Words = [[" · DD ", look.quiet], [depth(y.dd), tone(meets(y.dd, limit, false))]];
  const held: Words = hold && y.hold !== null ? [[" · hold ", look.quiet], [signed(y.hold), look.quiet]] : [];
  const named = (part: boolean): Words => [[`${y.year}${part ? ` (${y.part})` : ""} `, look.label], ...ret, ...dd];
  return [...(y.part ? [named(true)] : []), named(false)].flatMap((ws) => (held.length ? [[...ws, ...held], ws] : [ws])).concat([[...ret, ...dd], ret]);
}

/** The years on the names' line: a hairline between two years (`under`), else each year's cell over the
 *  part of the year in view. */
export function yearRows(f: Frame, years: readonly Year[], annual: number | null, limit: number | null, hold: boolean, look: YearLook, under: boolean): void {
  const { c, hr, vr, w, x } = f;
  // Each year's edges: half way to the next year's first point, the first's and last's at their points.
  const edges = years.map((y, k) => [k ? (x(years[k - 1]!.last) + x(y.first)) / 2 : x(y.first), k < years.length - 1 ? (x(y.last) + x(years[k + 1]!.first)) / 2 : x(y.last)] as const);
  if (under) {
    c.fillStyle = look.grid;
    const top = Math.round((ROW - TICK / 2) * vr), tall = Math.round(TICK * vr);
    for (const [a] of edges.slice(1)) if (a >= 0 && a <= w) c.fillRect(span(a, a).at, top, Math.max(1, Math.floor(hr)), tall);
    return;
  }
  c.save();
  c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
  Object.assign(c, { textBaseline: "middle", lineJoin: "round", lineWidth: 3 * hr, strokeStyle: look.halo });
  const middle = Math.round(ROW * vr);
  years.forEach((y, k) => {
    const [a, b] = edges[k]!, lo = Math.max(a, 0), hi = Math.min(b, w), words = cellOf(y, annual, limit, look, hold).find((ws) => width(c, ws) <= hi - lo - 2 * PAD * hr);
    if (!words) return;
    const from = Math.round((lo + hi) / 2 - width(c, words) / 2);
    // The halo under all the words first, so none cuts into the one before it.
    for (const fill of [false, true]) {
      let at = from;
      for (const [text, colour] of words) {
        if (fill) { c.fillStyle = colour; c.fillText(text, at, middle); } else c.strokeText(text, at, middle);
        at += c.measureText(text).width;
      }
    }
  });
  c.restore();
}

const width = (c: CanvasRenderingContext2D, words: Words) => words.reduce((n, [text]) => n + c.measureText(text).width, 0);
