// The equity chart's pane in bands, top to bottom, so no layer runs into another's: the stretches' names
// (stretchCaptions' BELOW) with the drawdown dots hanging from them down to CEILING of the pane; the plot,
// which the value axis fits and in which every priced layer is drawn, clipped to it (the line and its
// fills, the pace, the buy and hold, the floor, the drawdowns and the closes' arrows); the day bars, BARS of
// the pane at most, standing on the exposure's band at the foot (equityExtras). GAP px part the plot from
// the bands either side. Only what marks time runs the pane's height: the offline washes, the seams, the
// held stretches, the hovered day's column, and the gridlines across it.
import { BARS, CEILING } from "./equityBands";
import { BELOW } from "./stretchCaptions";

/** The plot's top and bottom, px from the pane's top. */
export type Plot = { top: number; bottom: number };
const GAP = 8;  // px

/** The plot of a pane `h` px high whose foot holds the exposure's band (`foot` px) and, when `days`, the day bars. */
export const plotOf = (h: number, foot: number, days: boolean): Plot => ({ top: BELOW + h * CEILING + GAP, bottom: h - foot - (days ? h * BARS : 0) - GAP });

/** `draw` clipped to the plot, on a bitmap `w` device px wide at `vr` device px a px. */
export function inPlot(c: CanvasRenderingContext2D, plot: Plot, w: number, vr: number, draw: () => void): void {
  const top = Math.round(plot.top * vr);
  c.save();
  c.beginPath(); c.rect(0, top, w, Math.max(0, Math.round(plot.bottom * vr) - top)); c.clip();
  draw();
  c.restore();
}
