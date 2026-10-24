import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import { v } from "../../theme/roles";
import { ROW } from "./geometry";

// TradingView's crosshair in its magnet mode: faint dashed lines through a reticle, the vertical one on
// the trial and the horizontal one on the version row nearest the pointer. Near the reticle the dashes
// thin out, and they stop short of it, so the point itself stays clear.
const NEAR = 40, CLEAR = 7, DENSE = "3 3", SPARSE = "1 5";

/** One line from `from` to `to` along an axis, broken around `at` (null: unbroken). */
function runs(from: number, to: number, at: number | null): [number, number, string][] {
  if (at == null) return [[from, to, DENSE]];
  const parts: [number, number, string][] = [
    [from, at - NEAR, DENSE], [at - NEAR, at - CLEAR, SPARSE], [at + CLEAR, at + NEAR, SPARSE], [at + NEAR, to, DENSE]];
  return parts.map(([a, b, d]): [number, number, string] => [Math.max(from, a), Math.min(to, b), d]).filter(([a, b]) => b > a);
}

/** On a canvas of `width` × `height` (screen pixels): the vertical line at `x` (a snapped trial), the
 *  horizontal one on the row nearest `y` and the reticle where they meet when the pointer is here (`y` null: only the
 *  vertical line). Portalled into the viewport above the backdrop and under the versions and edges, so
 *  the lines never strike through a version's text. */
export function Crosshair({ x, y, width, height, reticle = true }: { x: number; y: number | null; width: number; height: number; reticle?: boolean }) {
  const viewport = useStore((s) => s.domNode?.querySelector(".react-flow__viewport") ?? null);
  const [tx, ty] = useStore((s) => s.transform);
  const X = Math.round(x) + 0.5, Y = y == null ? null : Math.round(Math.round((y - ty) / ROW) * ROW + ty) + 0.5;
  const stroke = { stroke: v("crosshair"), strokeOpacity: 0.75 };
  if (!viewport) return null;
  return createPortal(
    <svg data-crosshair-lines width={width} height={height} className="pointer-events-none absolute -z-5" style={{ left: -tx, top: -ty }}>
      {runs(0, height, Y).map(([a, b, d]) => <line key={`v${a}`} x1={X} x2={X} y1={a} y2={b} strokeDasharray={d} {...stroke} />)}
      {Y != null && runs(0, width, X).map(([a, b, d]) => <line key={`h${a}`} x1={a} x2={b} y1={Y} y2={Y} strokeDasharray={d} {...stroke} />)}
      {Y != null && reticle && <>
        <circle cx={X} cy={Y} r={3.5} fill="none" stroke={v("fg-muted")} />
        <circle cx={X} cy={Y} r={0.75} fill={v("fg-muted")} />
      </>}
    </svg>,
    viewport,
  );
}
