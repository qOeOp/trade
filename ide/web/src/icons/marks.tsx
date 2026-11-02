import type { SVGProps } from "react";
import type { Prediction, Role } from "../model/types";
import { PREDICTION, ROLE } from "../model/semantics";
import { v } from "../theme/roles";
import { Icon } from "./Icon";

/** A version's role by shape first, colour second: filled ring = recommended, small dot = superseded,
 *  struck ring = masked, dashed ring = unrun, cross = failed review. */
export function RoleMark({ role, size = 14 }: { role: Role | null | undefined; size?: number }) {
  const c = size / 2;
  const shape = (() => {
    switch (role) {
      case "recommended": return <>
        <circle cx={c} cy={c} r={c - 1} fill="none" stroke={v("recommended")} strokeWidth={1.5} />
        <circle cx={c} cy={c} r={c - 4} fill={v("recommended")} />
      </>;
      case "masked": return <>
        <circle cx={c} cy={c} r={c - 3} fill="none" stroke={v("fail")} strokeWidth={1.25} />
        <line x1={3} y1={size - 3} x2={size - 3} y2={3} stroke={v("fail")} strokeWidth={1.25} />
      </>;
      case "precheck_failed":
        return <path d={`M4 4 L${size - 4} ${size - 4} M${size - 4} 4 L4 ${size - 4}`} stroke={v("fail")} strokeWidth={1.75} strokeLinecap="square" />;
      case "unrun": return <circle cx={c} cy={c} r={c - 3} fill="none" stroke={v("fg-faint")} strokeWidth={1.25} strokeDasharray="2 2" />;
      default: return <circle cx={c} cy={c} r={c - 4.5} fill={v("fg-faint")} />;
    }
  })();
  return <svg width={size} height={size} className="shrink-0" aria-label={role ? ROLE[role].label : undefined}>{shape}</svg>;
}

const PREDICTION_ICON = { held: "check", failed: "close", mixed: "minus" } as const;

/** Whether a version's predictions held; nothing when none was judged. */
export function PredictionMark({ prediction, size = 12 }: { prediction: Prediction; size?: 12 | 16 }) {
  if (prediction === "none") return null;
  return <Icon name={PREDICTION_ICON[prediction]} size={size} tone={PREDICTION[prediction].tone} />;
}

/** A tooltip's arrow, Element Plus's: the border colour under the fill, the fill a pixel higher, so it
 *  covers the box's border where they meet. Takes Radix's arrow props (its ref and position) as they are. */
export function TipArrow(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} width={13} height={7} viewBox="0 0 13 7" aria-hidden className="block">
      <path className="fill-tooltip-border" d="M5.09457 6.03187C5.87357 6.80128 7.12643 6.80128 7.90543 6.03187L13 1H0L5.09457 6.03187Z" />
      <path className="fill-tooltip" d="M5.43934 4.93934C6.02513 5.52513 6.97487 5.52513 7.56066 4.93934L12.5 0H0.5L5.43934 4.93934Z" />
    </svg>
  );
}
