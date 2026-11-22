import type { Prediction } from "../model/types";
import { measureLabel } from "../model/measures";
import { PREDICTION } from "../model/semantics";
import { Icon } from "../icons/Icon";
import { Tip } from "../ui/Tip";

const PREDICTION_ICON = { held: "check", failed: "close", mixed: "minus" } as const;

/** Whether a version's predictions held, said on hover; a partly held mark also names the measures whose
 *  predictions failed. Nothing when none was judged. */
export function PredictionMark({ prediction, failed = [], size = 12 }: { prediction: Prediction; failed?: string[]; size?: 12 | 16 }) {
  if (prediction === "none") return null;
  const { label, tone } = PREDICTION[prediction];
  const names = prediction === "mixed" ? failed.map((key) => {
    const { measure, slice } = measureLabel(key);
    return slice ? `${measure} · ${slice}` : measure;
  }) : [];
  const failedText = names.length ? `Failed: ${names.join(", ")}` : null;
  return (
    <Tip content={failedText ? <>{label}<br />{failedText}</> : label}>
      <span role="img" aria-label={failedText ? `${label}. ${failedText}` : label} className="inline-grid">
        <Icon name={PREDICTION_ICON[prediction]} size={size} tone={tone} />
      </span>
    </Tip>
  );
}
