import { useId, useMemo } from "react";
import type { LineageWidget } from "../../model/types";
import { PURPOSE } from "../../model/semantics";
import { runs, steps } from "../../lib/range";
import { v, wash } from "../../theme/roles";
import { hoverProps, requestFocus, useAxisView, useCrosshair } from "../../state/linking";
import { useSize } from "../../components/hooks/useSize";
import { Tip } from "../../components/Tip";
import { RULER, UNIT } from "./geometry";

const BLOCK_Y = 4, BLOCK_H = RULER - 8, NUM_Y = RULER / 2 + 3.5;

/** The trial axis: every trial's number over its column, the trial where a version sits on the canvas
 *  in the text colour and the rest faint; the trials that ran one version on a rounded tinted block
 *  (brand blue for the current recommendation); the trial under the pointer inverted. */
export function Ruler({ lineage, inset }: { lineage: LineageWidget; inset: number }) {
  const clip = useId();
  const [ref, { width }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const sx = (t: number) => x0 + t * unit + 0.5;
  const visible = steps(Math.max(0, Math.floor(-x0 / unit)), Math.ceil((width - x0) / unit), 1);
  const { groups, anchors } = useMemo(() => ({
    groups: runs(lineage.trials, (t) => t.candidate, (a, b) => b.trial_id === a.trial_id + 1),
    anchors: new Set(lineage.nodes.flatMap((n) => (n.x != null && Number.isInteger(n.x) ? [n.x] : []))),
  }), [lineage]);
  const recommended = lineage.trail.at(-1)?.candidate;
  return (
    <div ref={ref} className="relative select-none bg-island" style={{ height: RULER }}>
      <svg width={width} height={RULER} className="absolute inset-0">
        <defs><clipPath id={clip}><rect x={inset - UNIT / 2} y={0} width={Math.max(0, width - inset + UNIT / 2)} height={RULER} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>
        {groups.map((g) => {
          const first = g[0], last = g.at(-1);
          if (!first || !last) return null;
          const x1 = sx(first.trial_id) - unit / 2 + 2, x2 = sx(last.trial_id) + unit / 2 - 2;
          if (x2 < 0 || x1 > width) return null;
          const current = first.candidate === recommended;
          return (
            <Tip key={first.trial_id} content={
              <div className="space-y-0.5"><div className="font-mono font-semibold">{first.candidate}</div>
                <div className="text-fg-muted">{g.map((t) => `${t.trial_id} ${PURPOSE[t.purpose] ?? t.purpose}`).join(" · ")}</div></div>}>
              <rect {...hoverProps(first.candidate)} className="cursor-pointer" onClick={() => requestFocus(first.candidate)}
                    x={x1} y={BLOCK_Y} width={x2 - x1} height={BLOCK_H} rx={5}
                    fill={current ? wash("recommended", 22) : v("hover")} />
            </Tip>
          );
        })}
        {visible.map((t) => {
          const here = t === at;
          return (
            <g key={t} data-ruler-trial={t} pointerEvents="none">
              {here && <rect x={sx(t) - unit / 2 + 3} y={BLOCK_Y + 1} width={unit - 6} height={BLOCK_H - 2} rx={4} fill={v("fg")} />}
              <text x={sx(t)} y={NUM_Y} textAnchor="middle" fontSize={9.5}
                    fill={v(here ? "island" : anchors.has(t) ? "fg" : "fg-ghost")}>{t}</text>
            </g>
          );
        })}
        </g>
      </svg>
    </div>
  );
}
