import { useMemo } from "react";
import type { LineageWidget } from "../../model/types";
import { PURPOSE } from "../../model/semantics";
import { runs, steps } from "../../lib/range";
import { v } from "../../theme/roles";
import { hoverProps, requestFocus, useAxisView, useCrosshair } from "../../state/linking";
import { useSize } from "../../components/hooks/useSize";
import { Tip } from "../../components/Tip";
import { RULER } from "./geometry";

const NUM_Y = 11, BAR_Y = RULER - 6;

/** The trial axis: every trial's number over its column (tens and fives brighter); the trial where a
 *  version sits on the canvas set on a rounded fill; under the numbers, a bar grouping the trials that
 *  ran one version; the trial under the pointer inverted. */
export function Ruler({ lineage }: { lineage: LineageWidget }) {
  const [ref, { width }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const sx = (t: number) => x0 + t * unit + 0.5;
  const visible = steps(Math.floor(-x0 / unit), Math.ceil((width - x0) / unit), 1);
  const { groups, anchors } = useMemo(() => ({
    groups: runs(lineage.trials, (t) => t.candidate, (a, b) => b.trial_id === a.trial_id + 1),
    anchors: new Set(lineage.nodes.flatMap((n) => (n.x != null && Number.isInteger(n.x) ? [n.x] : []))),
  }), [lineage]);
  const recommended = lineage.trail.at(-1)?.candidate;
  return (
    <div ref={ref} className="relative select-none bg-island" style={{ height: RULER }}>
      <svg width={width} height={RULER} className="absolute inset-0">
        {groups.map((g) => {
          const first = g[0], last = g.at(-1);
          if (!first || !last) return null;
          const x1 = sx(first.trial_id) - unit / 2 + 5, x2 = sx(last.trial_id) + unit / 2 - 5;
          if (x2 < 0 || x1 > width) return null;
          return (
            <Tip key={first.trial_id} content={
              <div className="space-y-0.5"><div className="font-mono font-semibold">{first.candidate}</div>
                <div className="font-mono text-fg-muted">{g.map((t) => `${t.trial_id} ${PURPOSE[t.purpose] ?? t.purpose}`).join(" · ")}</div></div>}>
              <g {...hoverProps(first.candidate)} className="cursor-pointer" onClick={() => requestFocus(first.candidate)}>
                <rect x={x1} y={BAR_Y - 4} width={x2 - x1} height={10} fill="transparent" />
                <rect x={x1} y={BAR_Y} width={x2 - x1} height={2} rx={1} fill={v(first.candidate === recommended ? "recommended" : "fg-faint")} />
              </g>
            </Tip>
          );
        })}
        {visible.map((t) => {
          const anchor = anchors.has(t), here = t === at, w = Math.max(16, String(t).length * 6 + 8);
          const fill = here ? v("island") : anchor ? v("fg") : t % 10 === 0 ? v("fg-muted") : t % 5 === 0 ? v("fg-faint") : v("fg-ghost");
          return (
            <g key={t} pointerEvents="none">
              {(anchor || here) && <rect x={sx(t) - w / 2} y={NUM_Y - 8} width={w} height={15} rx={7.5} fill={v(here ? "fg" : "line-strong")} />}
              <text x={sx(t)} y={NUM_Y + 3.5} textAnchor="middle" className="font-mono" fontSize={9.5} fill={fill}>{t}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
