import type { Prediction, Role } from "../model/types";
import { PREDICTION, ROLE } from "../model/semantics";
import { v } from "../theme/roles";
import { Icon } from "./Icon";

/** A version's role by shape first, colour second: filled ring = recommended, ring = kept reference,
 *  small dot = superseded, struck ring = masked, dashed ring = unrun, cross = failed review. */
export function RoleMark({ role, size = 14 }: { role: Role | null | undefined; size?: number }) {
  const c = size / 2;
  const shape = (() => {
    switch (role) {
      case "recommended": return <>
        <circle cx={c} cy={c} r={c - 1} fill="none" stroke={v("recommended")} strokeWidth={1.5} />
        <circle cx={c} cy={c} r={c - 4} fill={v("recommended")} />
      </>;
      case "kept_reference": return <circle cx={c} cy={c} r={c - 3} fill={v("island")} stroke={v("fg")} strokeWidth={1.75} />;
      case "masked": return <>
        <circle cx={c} cy={c} r={c - 3} fill="none" stroke={v("masked")} strokeWidth={1.25} />
        <line x1={3} y1={size - 3} x2={size - 3} y2={3} stroke={v("masked")} strokeWidth={1.25} />
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
