// The equity chart's pane in bands, top to bottom, so no layer runs into another's: in the backtest stage,
// which draws one stretch and names it in the legend, each year as a unit unitHigh px (its scorecard's LINE px
// lines, equityYears, beside its P&L bars by contract, equityShares); elsewhere the stretches' names
// (stretchCaptions' BELOW, omitted when a lone stretch is named in the legend); which way the run held
// (equityBands' sideTrack, just over the dots), and the drawdown dots hanging from them down to CEILING of
// the pane; the plot, which the value axis fits and in which every priced layer is drawn, clipped to it (the
// line and its fills, the pace, the buy and hold, the floor, the drawdowns and the closes' arrows); the day
// bars, BARS of the pane at most, standing on the exposure's band at the foot (equityExtras). GAP px part
// the plot from the bands either side. Only what marks time runs the pane's height: the offline washes, the
// seams, the flat stretches, the hovered day's column, and the gridlines across it. A fill the plot can cut
// (the costs' band and its rim, the open profit, the buy and hold, the gap to the pace, the drawdowns'
// hatching) fades out over FADE px into its edges, so where it runs on past the plot it trails off instead
// of ending in a flat edge.
import { CEILING } from "./equityBands";
import { BELOW } from "./stretchCaptions";

/** The plot's top and bottom, px from the pane's top. */
export type Plot = { top: number; bottom: number };
const GAP = 4, FADE = 32, LONE = 11, UNDER = 11;  // px: around the plot, the edges' fade, where the dots start with no names or years, from the years to the dots (the side track between)
export const UNIT_TOP = 4, LINE = 12;  // px: a year's unit's top, a line of its scorecard
/** A year's unit's height (px) for a scorecard of `lines` lines: two lines' at least, for its P&L bars. */
export const unitHigh = (lines: number) => LINE * Math.max(2, lines);

/** Where the drawdown dots start (px from the pane's top): under the years when drawn (`years` lines to a
 *  scorecard, 0 when none), else BELOW the stretch names when drawn, else LONE. */
export const headOf = (captions: boolean, years = 0): number => (years ? UNIT_TOP + unitHigh(years) + UNDER : captions ? BELOW : LONE);

/** The plot of a pane `h` px high whose visible drawdown dots take `dots` px under `head` (headOf) and
 *  whose foot holds `foot` px of exposure and `bars` px of day bars. */
export const plotOf = (h: number, foot: number, bars: number, dots = h * CEILING, head = LONE): Plot =>
  ({ top: head + dots + GAP, bottom: h - foot - bars - GAP });

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
