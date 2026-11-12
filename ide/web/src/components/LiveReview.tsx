import type { LiveRun, LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { Section } from "./Section";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";

const known = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Unknown";

export function LiveReview({ run, inspect }: { run: LiveRun; inspect: LiveTradingActions["inspect"] }) {
  const action = useLiveAction(), review = run.review;
  return <Section title="Research review">
    <div className="space-y-3">
      {run.reviewError ? <p className="text-dense text-fail">Review could not be read · {run.reviewError}. Registration status is unknown.</p> : review ? <>
        <KeyValues items={[["Research commit", <span className="break-all">{review.research_at}</span>]]} />
        {review.validations.length === 0 ? <p className="text-dense text-fg-muted">No registrations at this exact research commit.</p>
          : <ul className="space-y-2">{review.validations.map((row, index) => <li key={index} className="rounded-control border border-line p-2 text-small">
            <p>Registration {known(row.registration_id)} · {known(row.status)}</p>
            <p className="text-fg-faint">UTC research window · {known(row.window_start)} → {known(row.window_end)}</p>
          </li>)}</ul>}
        <p className="text-small text-fg-faint">{review.validation_note}</p>
      </> : <p className="text-dense text-fg-faint">Review has not been read. This is different from having no registrations.</p>}
      <FormButton disabled={!inspect || action.busy} onClick={() => { if (inspect) void action.submit(() => inspect(run.id)); }}>{action.busy ? "Reading…" : "Read frozen review"}</FormButton>
    </div>
  </Section>;
}
