import { useState } from "react";
import type { LiveRequest, LiveRun, LiveTradingActions } from "../model/liveTrading";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveFacts } from "./LiveFacts";
import { TextButton } from "./TextButton";

// The refusals a switch request can meet (live/runs.py request_switch_locked), in the page's words.
const REFUSED: Record<string, string> = {
  LIVE_SWITCH: "This run cannot take a new runtime now: it is not running, a stop was asked for, or a switch already waits.",
  LIVE_EVIDENCE_MISSING: "The replay this run started on does not run on the new image's replay code. The Agent replays it on a matching image.",
  LIVE_IDENTITY_CHANGED: "The new image is not built for this run's runtime contract.",
  LIVE_SWITCH_CHECK: "The new image or the replay record could not be checked. Nothing changed; try again later.",
};
const refusal = (request: LiveRequest | null | undefined) =>
  request?.outcome === "refused" ? REFUSED[request.code ?? ""] ?? `Refused (${request.code ?? "unknown"}).` : null;

/** A runtime image the release offers a running run (design §3.8): its build, replay evidence and paired replay, and
 *  "Switch at next flat", armed by the first click and sent by the second. While a confirmed switch waits for the
 *  strategy to hold nothing: since when, and Cancel. */
export function LiveRuntimeSwitch({ run, actions }: { run: LiveRun; actions: LiveTradingActions }) {
  const [armed, setArmed] = useState(false), [refused, setRefused] = useState<string | null>(null), action = useLiveAction();
  const runtime = run.runtime;
  if (!runtime) return null;
  if (runtime.pending) {
    return <LiveFacts title="New runtime" facts={[{ label: "Switching to", value: runtime.pending.build },
      { label: "Waiting for flat", value: runtime.pending.sinceNs, format: "since" }]}>
      <div className="mt-2 space-y-2">
        <FormButton disabled={!actions.cancelSwitch || action.busy}
          onClick={() => { if (actions.cancelSwitch) void action.submit(async () => setRefused(refusal(await actions.cancelSwitch!(run.id)))); }}>
          {action.busy ? "Canceling…" : "Cancel switch"}</FormButton>
        <p className="text-small text-fg-faint">Switches when the strategy next holds no position or order. Nothing is closed or canceled for it.</p>
        {refused && <p role="alert" className="text-small text-fail">{refused}</p>}
        <LiveActionFailure failed={action.failed} />
      </div>
    </LiveFacts>;
  }
  const offered = runtime.offered;
  if (!offered) return null;
  const send = () => { if (actions.switchRuntime) void action.submit(async () => { setRefused(refusal(await actions.switchRuntime!(run.id))); setArmed(false); }); };
  const line = refused ?? (!offered.ready ? REFUSED.LIVE_EVIDENCE_MISSING! : armed
    ? `When the strategy next holds no position or order, the run restarts on ${offered.build ?? "the new build"}. Nothing is closed or canceled for it; its drawdown brake, highest equity and history carry over.`
    : "Switches only when the strategy holds no position or order.");
  return <LiveFacts title="New runtime" facts={offered.facts}>
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {action.busy ? <FormButton primary disabled>Confirming…</FormButton>
          : armed ? <>
            <FormButton primary onClick={send} aria-describedby={`live-switch-${run.id}`}>Confirm switch · <span className="tabular-nums">{offered.build}</span></FormButton>
            <TextButton size="form" onClick={() => setArmed(false)}>Cancel</TextButton>
          </> : <FormButton disabled={!actions.switchRuntime || !offered.ready} onClick={() => { setRefused(null); setArmed(true); }}>Switch at next flat</FormButton>}
      </div>
      <p id={`live-switch-${run.id}`} role={refused ? "alert" : undefined}
        className={`text-small ${refused || !offered.ready ? "text-fail" : armed ? "text-fg-muted" : "text-fg-faint"}`}>{line}</p>
      <LiveActionFailure failed={action.failed} />
    </div>
  </LiveFacts>;
}
