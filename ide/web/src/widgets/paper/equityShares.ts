// The equity chart's yearly P&L bars (equityZones' top row): over each year of the shown backtest, right of
// its scorecard (equityYears), two bars, the year's gains over its losses, each cut into the contracts' shares
// of the P&L their cycles made that year, largest first from the left, each outlined in the contract's colour
// and hatched in it at 45°, as the drawdowns are. A cycle held across a year's end is marked to its contract's
// last close of that year (`piecesOf`), so a year's shares are what its equity moved by, not what happened to
// close in it; what its fees and funding took falls in the year it closed. The longer of the two runs the room
// it is given, the other to the same scale, both over a faint track of that length, TALL px each, GAP px
// between two shares. A contract keeps its colour across the years: up to SLOTS contracts have one each (those
// that moved the most P&L over the run); the rest share Other, in grey, its gains and its losses apart. A
// share wide enough carries its name, in the text colour on a patch of the island's; the tooltip (`tipOf`)
// names every share.
import { baseAsset } from "../../lib/paperApi";
import { DAY_S } from "../../lib/time";
import type { DailyCloses } from "../../model/equityReadings";
import type { Tip } from "./candleEvents";
import { span, type Frame } from "./equityBands";

/** A year's P&L of one contract (or of Other's, `slot` null, with its `members`) over the cycles it held then. */
export type Share = { symbol: string; pnl: number; trades: number; slot: number | null; members: readonly [string, number][] };
export type ShareLook = { series: readonly string[]; other: string; ink: string; paper: string; track: string; font: string };
/** Where a share is drawn (px from the pane's left and top) and of which year. */
export type Hit = { x0: number; x1: number; y0: number; y1: number; year: number; share: Share; of: number };

const SLOTS = 5;
const GAP = 4, PAD = 3, TALL = 9, NAME = 9, LEAN = 4;  // px: between shares, around a name, a bar's height, its names' font size, the stripes' pitch
const OTHER = "Other";

type Cycle = { symbol: string; opened: number; closed: number; pnl: number | null; gross: number };
const MOVE = 0.1;  // the least price move (a share of the price) a cycle is marked over

/** A cycle's P&L by UTC year (its open and close in ms). Its price move (`gross`) is marked at each year's end
 *  it was held across by how far its contract's close had got from the close before it opened to the close
 *  before it closed (no entry price or size is stored for a cycle); the rest falls in the year it closed. All
 *  of it there without the closes or where the price moved less than MOVE, which leaves the mark unsteady. */
export function piecesOf(c: Cycle, closes: DailyCloses | null): [number, number][] {
  const pnl = c.pnl ?? 0, first = new Date(c.opened).getUTCFullYear(), last = new Date(c.closed).getUTCFullYear(), days = closes?.[c.symbol] ?? [];
  const at = (s: number) => days.filter(([t]) => t + DAY_S <= s).at(-1)?.[1] ?? null;
  const from = at(c.opened / 1000), to = at(c.closed / 1000);
  if (first === last || from === null || to === null || Math.abs(to - from) < MOVE * from) return [[last, pnl]];
  const out: [number, number][] = [];
  let marked = 0;
  for (let year = first; year < last; year++) {
    const end = at(Date.UTC(year + 1, 0, 1) / 1000);
    if (end === null) continue;
    const mark = (c.gross * (end - from)) / (to - from);
    out.push([year, mark - marked]); marked = mark;
  }
  return [...out, [last, pnl - marked]];
}

/** Each year's shares (the cycles' P&L by year, piecesOf), in the bar's order. */
export function sharesOf(cycles: readonly Cycle[], closes: DailyCloses | null = null, slots = SLOTS): Map<number, Share[]> {
  const moved = new Map<string, number>(), years = new Map<number, Map<string, [number, number]>>();
  for (const c of cycles) {
    moved.set(c.symbol, (moved.get(c.symbol) ?? 0) + Math.abs(c.pnl ?? 0));
    for (const [year, pnl] of piecesOf(c, closes)) {
      const own = years.get(year) ?? new Map<string, [number, number]>(), [sum, n] = own.get(c.symbol) ?? [0, 0];
      own.set(c.symbol, [sum + pnl, n + 1]);
      years.set(year, own);
    }
  }
  const kept = [...moved].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, slots).map(([s]) => s).sort();
  const slot = new Map(kept.map((s, k) => [s, k]));
  return new Map([...years].map(([year, own]) => {
    const all = [...own].filter(([, [pnl]]) => pnl !== 0), rest = all.filter(([s]) => !slot.has(s));
    const other = (gain: boolean): Share[] => {
      const part = rest.filter(([, [pnl]]) => pnl > 0 === gain);
      return part.length ? [{ symbol: OTHER, slot: null, pnl: part.reduce((n, [, [p]]) => n + p, 0), trades: part.reduce((n, [, [, t]]) => n + t, 0),
                              members: part.map(([s, [p]]) => [s, p] as [string, number]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) }] : [];
    };
    const named: Share[] = all.filter(([s]) => slot.has(s)).map(([symbol, [pnl, trades]]) => ({ symbol, pnl, trades, slot: slot.get(symbol)!, members: [] }));
    const shares = [...named, ...other(true), ...other(false)];
    return [year, [...shares.filter((s) => s.pnl > 0).sort((a, b) => b.pnl - a.pnl), ...shares.filter((s) => s.pnl < 0).sort((a, b) => a.pnl - b.pnl)]];
  }));
}

/** Each share's place along its bar, the gains' (`row` 0) or the losses' (1), as fractions of the longer bar. */
export function placesOf(shares: readonly Share[]): { share: Share; row: 0 | 1; at: number; len: number }[] {
  const sum = (gain: boolean) => shares.reduce((n, s) => n + (s.pnl > 0 === gain ? Math.abs(s.pnl) : 0), 0), most = Math.max(sum(true), sum(false));
  const at = [0, 0];
  return most > 0 ? shares.map((share) => { const row = share.pnl > 0 ? 0 : 1, len = Math.abs(share.pnl) / most, p = { share, row: row as 0 | 1, at: at[row]!, len }; at[row]! += len; return p; }) : [];
}

const nameOf = (s: Share) => (s.slot === null ? `${OTHER} (${s.members.length})` : baseAsset(s.symbol));
const usdt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")} USDT`;

/** What the tooltip says of a share of `of` (the year's gains or losses, by its sign). */
export function tipOf({ share: s, year, of }: Hit, x: number, y: number): Tip {
  const part = `${Math.round((Math.abs(s.pnl) / of) * 100)}% of ${year}'s ${s.pnl > 0 ? "gains" : "losses"}`;
  const members = s.members.slice(0, 6).map(([m, p]) => ({ text: `${baseAsset(m)} ${usdt(p)}` }));
  return { x, y, title: `${nameOf(s)} · ${year}`, rows: [{ text: usdt(s.pnl) }, { text: part, faint: true }, ...members,
    ...(s.members.length > 6 ? [{ text: `${s.members.length - 6} more`, faint: true }] : []), { text: `${s.trades} ${s.trades === 1 ? "cycle" : "cycles"} held`, faint: true }] };
}

/** The year's two bars between `a` and `b` (device px), from `top` (px) down `high` px; where each share is drawn. */
export function shareBars({ c, hr, vr, w }: Frame, year: number, shares: readonly Share[], a: number, b: number, top: number, high: number, look: ShareLook): Hit[] {
  const places = placesOf(shares), gap = Math.round(GAP * hr), width = b - a, split = high / 2 - TALL;
  const of = [0, 1].map((row) => places.reduce((n, p) => n + (p.row === row ? Math.abs(p.share.pnl) : 0), 0));
  if (!places.length || width < 4 * gap) return [];
  const longest = places.reduce((n, p) => Math.max(n, p.at + p.len), 0), rowTop = (row: number) => top + split / 2 + row * (TALL + split);
  c.save();
  Object.assign(c, { font: look.font.replace(/(\d+)px/, `${NAME * vr}px`), textBaseline: "alphabetic", fillStyle: look.track });
  for (const row of [0, 1]) { const s = span(a, a + longest * width); c.fillRect(s.at, Math.round(rowTop(row) * vr), s.len, Math.round(TALL * vr)); }
  const hits = places.flatMap(({ share, row, at, len }): Hit[] => {
    const y0 = rowTop(row), y = Math.round(y0 * vr), h = Math.round(TALL * vr), end = at + len >= longest - 1e-9;
    const x0 = a + at * width + (at ? gap / 2 : 0), x1 = a + (at + len) * width - (end ? 0 : gap / 2);
    if (x1 < 0 || x0 > w || x1 - x0 < 1) return [];
    const s = span(x0, x1), colour = share.slot === null ? look.other : look.series[share.slot]!;
    const line = Math.max(1, Math.floor(hr));
    c.fillStyle = hatch(c, colour, Math.max(3, Math.round(LEAN * hr))); c.fillRect(s.at, y, s.len, h);
    Object.assign(c, { strokeStyle: colour, lineWidth: line }); c.strokeRect(s.at + line / 2, y + line / 2, s.len - line, h - line);
    // The name centred on its glyphs, not its em box, so its capitals sit square in the thin bar; on a patch
    // of the island's colour inside the outline, so no stripe cuts into it.
    const name = nameOf(share), lo = Math.max(s.at, 0), hi = Math.min(s.at + s.len, w), m = c.measureText(name), tw = m.width;
    if (hi - lo >= tw + 2 * PAD * hr) {
      const x = Math.round((lo + hi) / 2 - tw / 2), base = Math.round(y + h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
      c.fillStyle = look.paper; c.fillRect(x - Math.round(PAD * hr), y + line, tw + 2 * Math.round(PAD * hr), h - 2 * line);
      c.fillStyle = look.ink; c.fillText(name, x, base);
    }
    // The pointer finds a share over its row's half of the unit, not only the bar's thin strip.
    return [{ x0: s.at / hr, x1: (s.at + s.len) / hr, y0: top + row * (high / 2), y1: top + (row + 1) * (high / 2), year, share, of: of[row]! }];
  });
  c.restore();
  return hits;
}

/** 45° stripes of `colour` a `pitch` px apart, kept per pitch and colour. */
const hatches = new Map<string, CanvasPattern | string>();
function hatch(c: CanvasRenderingContext2D, colour: string, pitch: number): CanvasPattern | string {
  const key = `${colour}:${pitch}`;
  if (!hatches.has(key)) {
    const cell = document.createElement("canvas"), g = cell.getContext("2d");
    Object.assign(cell, { width: pitch, height: pitch });
    if (g) {
      Object.assign(g, { strokeStyle: colour, lineWidth: Math.max(1, pitch / 4) });
      for (const d of [-pitch, 0, pitch]) { g.beginPath(); g.moveTo(d, pitch); g.lineTo(d + pitch, 0); g.stroke(); }
    }
    hatches.set(key, (g && c.createPattern(cell, "repeat")) ?? colour);
  }
  return hatches.get(key)!;
}
