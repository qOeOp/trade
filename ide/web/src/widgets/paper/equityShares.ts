// The equity chart's yearly P&L bars (equityZones' top row): over each year of the shown backtest, right of
// its scorecard (equityYears), two bars, the year's gains over its losses, each cut into the contracts' shares
// of the P&L their cycles made that year, largest first from the left, filled in the contract's colour. A cycle
// held across a year's end is marked to its contract's last close of that year (`piecesOf`), so a year's
// shares are what its equity moved by, not what happened to close in it; what its fees and funding took falls
// in the year it closed. The longer of the two runs the room it is given, the other to the same scale, both
// over a faint track of that length. A contract keeps its colour across the years: up to SLOTS contracts have
// one each (those that moved the most P&L over the run); the rest share Other, in grey, its gains and its
// losses apart. The island shows GAP px between two shares. A share wide enough carries its name, in
// whichever of the text and island colours stands out more on it; the tooltip (`tipOf`) names every share.
import { baseAsset } from "../../lib/paperApi";
import type { Tip } from "./candleEvents";
import { span, type Frame } from "./equityBands";

/** A year's P&L of one contract (or of Other's, `slot` null, with its `members`) over the cycles it held then. */
export type Share = { symbol: string; pnl: number; trades: number; slot: number | null; members: readonly [string, number][] };
export type ShareLook = { series: readonly string[]; other: string; ink: string; paper: string; track: string; font: string };
/** Where a share is drawn (px from the pane's left and top) and of which year. */
export type Hit = { x0: number; x1: number; y0: number; y1: number; year: number; share: Share; of: number };

export const SLOTS = 5;
const GAP = 2, PAD = 3, SPLIT = 2;  // px: between shares, around a name, between the two bars
const OTHER = "Other";

type Cycle = { symbol: string; opened: number; closed: number; pnl: number | null; gross: number };
/** A contract's daily closes, oldest first: each day's start (s) and its close. */
export type Closes = Readonly<Record<string, readonly (readonly [number, number])[]>>;
const DAY_S = 86_400, MOVE = 0.1;  // the least price move (a share of the price) a cycle is marked over

/** A cycle's P&L by UTC year (its open and close in ms). Its price move (`gross`) is marked at each year's end
 *  it was held across by how far its contract's close had got from the close before it opened to the close
 *  before it closed (no entry price or size is stored for a cycle); the rest falls in the year it closed. All
 *  of it there without the closes or where the price moved less than MOVE, which leaves the mark unsteady. */
export function piecesOf(c: Cycle, closes: Closes | null): [number, number][] {
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
export function sharesOf(cycles: readonly Cycle[], closes: Closes | null = null, slots = SLOTS): Map<number, Share[]> {
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
  const places = placesOf(shares), gap = Math.round(GAP * hr), width = b - a, tall = (high - SPLIT) / 2;
  const of = [0, 1].map((row) => places.reduce((n, p) => n + (p.row === row ? Math.abs(p.share.pnl) : 0), 0));
  if (!places.length || width < 4 * gap) return [];
  const longest = places.reduce((n, p) => Math.max(n, p.at + p.len), 0);
  c.fillStyle = look.track;
  for (const row of [0, 1]) { const s = span(a, a + longest * width); c.fillRect(s.at, Math.round((top + row * (tall + SPLIT)) * vr), s.len, Math.round(tall * vr)); }
  return places.flatMap(({ share, row, at, len }) => {
    const y0 = top + row * (tall + SPLIT), y = Math.round(y0 * vr), h = Math.round(tall * vr), end = at + len >= longest - 1e-9;
    const x0 = a + at * width + (at ? gap / 2 : 0), x1 = a + (at + len) * width - (end ? 0 : gap / 2);
    if (x1 < 0 || x0 > w || x1 - x0 < 1) return [];
    const s = span(x0, x1), colour = share.slot === null ? look.other : look.series[share.slot]!;
    c.fillStyle = colour; c.fillRect(s.at, y, s.len, h);
    const name = nameOf(share), lo = Math.max(s.at, 0), hi = Math.min(s.at + s.len, w), tw = c.measureText(name).width;
    if (hi - lo >= tw + 2 * PAD * hr) { c.fillStyle = inkOn(colour, look); c.fillText(name, Math.round((lo + hi) / 2 - tw / 2), y + h / 2); }
    return [{ x0: s.at / hr, x1: (s.at + s.len) / hr, y0, y1: y0 + tall, year, share, of: of[row]! }];
  });
}

/** The text or the island colour, whichever stands out more on `fill` (all `#rrggbb…`, as canvasColor gives them). */
function inkOn(fill: string, { ink, paper }: ShareLook): string {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (x: string) => { const [p, q] = [lum(x), lum(fill)].sort((m, n) => n - m); return (p! + 0.05) / (q! + 0.05); };
  return ratio(ink) >= ratio(paper) ? ink : paper;
}
