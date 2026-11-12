// The equity chart's pane in bands, top to bottom, so no layer runs into another's. In the backtest stage,
// which draws one stretch and names it in the legend, each year as a unit UNIT high: its scorecard's LINE px
// lines (equityYears) beside its P&L bars by contract (equityShares); elsewhere the stretches' names
// (stretchCaptions). Under them which
// way the contracts held (equityRows: a lane each for up to MOST, else one band of how many were held at
// once, standing on the line the drawdown dots hang from); the drawdown dots; the plot, which the value
// axis fits and in which every priced layer is drawn, clipped to it (the line and its fills, the pace, the
// floor, the drawdowns and the closes' arrows); the day bars, BARS of the pane at most, standing on the
// exposure's band at the foot (equityExtras). The plot starts where it would with no rows, CEILING of the
// pane under the names: the rows take their room from the dots (scaled to what is left them), down to
// LEAST, and only past that push the plot down. GAP px part the plot from the bands either side. Only what
// marks time runs the pane's height: the offline washes, the seams, the flat stretches, the hovered day's
// column, and the gridlines across it; the buy and hold runs on under the plot to the pane's foot. A fill
// the plot can cut (the costs' band and its rim, the open profit, the gap to the pace, the drawdowns'
// hatching) fades out over FADE px into its edges, so where it runs on past the plot it trails off instead
// of ending in a flat edge.
import { BARS, CEILING } from "./equityBands";
import { BELOW, ROW } from "./stretchCaptions";

/** The plot's top and bottom, px from the pane's top. */
export type Plot = { top: number; bottom: number };
const GAP = 8, FADE = 32, UNDER = 3, LEAST = 9;  // px: around the plot, the edges' fade, under the rows, the dots' least room
export const LANE = 10, BREADTH = 12, MOST = 4;  // px: a lane, the one band; the most contracts given a lane each
export const UNIT = { top: 4, high: 36 }, LINE = 12;  // px: a year's unit, a line of its scorecard

/** Where the lanes start (px from the pane's top): under the years' scorecards, else under the names. */
export const lanesTop = (years: boolean): number => (years ? UNIT.top + UNIT.high + 5 : ROW + 6);

/** The rows' height (px) for `contracts` contracts: a lane each up to MOST, else one band. */
export const rowsHigh = (contracts: number): number => (contracts > MOST ? BREADTH : contracts * LANE);

/** Where the drawdown dots start (px from the pane's top): under the rows, or BELOW the names with none. */
export const headOf = (contracts: number, years: boolean): number =>
  (contracts || years ? lanesTop(years) + rowsHigh(contracts) + (contracts > MOST ? 1 : UNDER) : BELOW);

/** Where the drawdown dots end in a pane `h` px high whose dots start at `head` (px). */
export const dotsEnd = (h: number, head: number): number => Math.max(BELOW + h * CEILING, head + LEAST);

/** The plot of a pane `h` px high whose dots start at `head` (px) and whose foot holds the exposure's band
 *  (`foot` px) and, when `days`, the day bars. */
export const plotOf = (h: number, foot: number, days: boolean, head = BELOW): Plot => ({ top: dotsEnd(h, head) + GAP, bottom: h - foot - (days ? h * BARS : 0) - GAP });

/** `colour` (`#rrggbbaa`, as canvasColor gives it) fading out into the plot's top and bottom edges. */
export function toEdges(c: CanvasRenderingContext2D, plot: Plot, vr: number, colour: string): CanvasGradient {
  const top = plot.top * vr, bottom = plot.bottom * vr, edge = Math.min(0.5, (FADE * vr) / Math.max(1, bottom - top));
  const g = c.createLinearGradient(0, top, 0, bottom), clear = `${colour.slice(0, 7)}00`;
  for (const [at, stop] of [[0, clear], [edge, colour], [1 - edge, colour], [1, clear]] as const) g.addColorStop(at, stop);
  return g;
}

/** `draw` clipped to the plot, on a bitmap `w` device px wide at `vr` device px a px. */
export function inPlot(c: CanvasRenderingContext2D, plot: Plot, w: number, vr: number, draw: () => void): void {
  const top = Math.round(plot.top * vr);
  c.save();
  c.beginPath(); c.rect(0, top, w, Math.max(0, Math.round(plot.bottom * vr) - top)); c.clip();
  draw();
  c.restore();
}
