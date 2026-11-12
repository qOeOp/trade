// The equity chart's rows at its top (equityZones): the shown backtest's years against the targets on the
// stretches' names' line (equityYears); under it which way the contracts held: up to MOST a lane each
// (equityBands' lane), named at the pane's left in the names' font on a patch of the island's colour, which
// parts the name from its lane's bars; more than that, one band of how many were held at once (equityBands'
// breadth), standing on the line the drawdown dots hang from, named by how many contracts it counts.
import { baseAsset } from "../../lib/paperApi";
import { breadthOf, type Lane } from "../../model/held";
import { breadth, lane, type Frame } from "./equityBands";
import type { EquityLook, EquityPoint } from "./equityLayers";
import { BREADTH, headOf, LANE, LANES, MOST } from "./equityZones";
import { yearRows, type Year, type YearLook } from "./equityYears";

/** The years and the targets they are read against, whether the buy and hold is shown, and the lanes. */
export type Rows = { years: readonly Year[]; annual: number | null; limit: number | null; hold: boolean; lanes: readonly Lane[] };
export const NO_ROWS: Rows = { years: [], annual: null, limit: null, hold: false, lanes: [] };
const NAME = 4;  // px: a row's name from the pane's left

/** Where the drawdown dots start under the rows (px from the pane's top). */
export const rowsHead = (r: Rows): number => headOf(r.lanes.length);

/** Each name and its middle (px from the pane's top). */
const names = ({ lanes }: Rows): [string, number][] => (lanes.length > MOST ? [[`${lanes.length} coins`, LANES + BREADTH / 2]]
  : lanes.map((l, k) => [baseAsset(l.symbol), LANES + k * LANE + LANE / 2]));

/** Under the series: the hairlines between the years and the lanes' bars, or the one band's columns. */
export function rowsUnder(f: Frame, points: readonly EquityPoint[], r: Rows, look: EquityLook): void {
  yearRows(f, r.years, r.annual, r.limit, r.hold, look.rows, true);
  if (r.lanes.length <= MOST) { r.lanes.forEach((l, k) => lane(f, points, l.held, look, LANES + k * LANE + LANE / 2)); return; }
  const held = breadthOf(r.lanes), most = held.reduce((n, [, , longs, shorts]) => Math.max(n, longs + shorts), 0);
  breadth(f, points, held, most, look, LANES + BREADTH, BREADTH);
}

/** Over everything: the years' cells and the rows' names. */
export function rowsOver(f: Frame, r: Rows, look: YearLook): void {
  yearRows(f, r.years, r.annual, r.limit, r.hold, look, false);
  const { c, hr, vr } = f;
  c.save();
  c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
  c.textBaseline = "middle";
  // On a clear patch from the pane's left, so no bar or hairline shows either side of the name.
  for (const [text, middle] of names(r)) {
    const x = Math.round(NAME * hr), y = Math.round(middle * vr), high = Math.round(LANE * vr) - 2;
    c.fillStyle = look.halo; c.fillRect(0, y - high / 2, x + c.measureText(text).width + Math.round(3 * hr), high);
    c.fillStyle = look.quiet; c.fillText(text, x, y);
  }
  c.restore();
}
