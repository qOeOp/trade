import { useState, type ReactNode } from "react";
import { FormButton } from "../../ui/chat/Field";
import { HoldButton } from "../../ui/HoldButton";
import { Sheet } from "../../ui/Sheet";
import { useLiveAction, LiveActionFailure } from "../../widgets/live/LiveActionState";
import { StopEffects } from "../../widgets/live/LiveStop";
import { Icon } from "../../icons/Icon";
import { fixed } from "../../lib/paperApi";
import type { LiveRun } from "../../model/liveTrading";
import { liveSnapshot, type LiveSnapshot } from "../../model/runSnapshot";
import { useLiveTrading } from "../../state/liveTrading";
import { useSnapshot } from "../../state/market";
import { Version } from "./RunCards";

type Step = { text: ReactNode; state: "done" | "doing" | "todo" | "failed" };
const ICON = { done: "passed", doing: "loading", todo: "untested", failed: "failed" } as const;
const TONE = { done: "meets", doing: "recommended", todo: "fg-faint", failed: "fail" } as const;

/** Where a requested stop is, from the request and the run as Live reads it again. */
function steps(run: LiveRun, outcome: string | undefined, { held, entries, status }: LiveSnapshot): Step[] {
  const refused = outcome === "refused", ended = run.ended, unresolved = status.word === "Unresolved";
  return [
    { text: refused ? "Stop refused by Live" : outcome === "no_reply" ? "Stop · No reply received" : "Stop requested",
      state: refused || outcome === "no_reply" ? "failed" : outcome === "effect_recorded" ? "done" : "doing" },
    { text: "Entry orders cancelled", state: refused ? "todo" : entries.length ? "doing" : "done" },
    ...held.map((h): Step => ({ text: <>Closing {h.symbol} {h.long ? "long" : "short"} {fixed(h.qty)}</>, state: refused ? "todo" : unresolved ? "failed" : "doing" })),
    { text: unresolved ? "Unresolved: reconcile on the desktop" : "The run ends when the account is flat", state: unresolved ? "failed" : ended ? "done" : "todo" },
  ];
}

/** The sheet Request stop… opens: what stopping does now, held for 1.5 s to send; then where the stop is. */
export function StopSheet({ run, open, onClose }: { run: LiveRun; open: boolean; onClose: () => void }) {
  const { view, actions } = useLiveTrading(), action = useLiveAction(), [sent, setSent] = useState(false);
  const snap = liveSnapshot(run, useSnapshot()?.coins);
  const request = [...view.requests].reverse().find((r) => r.action === "stop" && r.target.run_id === run.id);
  const send = () => { setSent(true); void action.submit(() => actions.stop?.(run.id)); };
  return (
    <Sheet open={open} onClose={onClose} title={sent ? "Stopping the Live run" : "Stop this Live run?"}>
      <div className="space-y-3 px-4 pb-4">
        <div>
          <h2 className="text-h2 font-semibold">{sent ? "Stopping the Live run" : "Stop this Live run?"}</h2>
          <p className="mt-1 text-dense"><Version name={run.candidate} /></p>
        </div>
        {sent ? <>
          <ul className="space-y-2 text-dense">
            {steps(run, request?.outcome, snap).map((s, i) => (
              <li key={i} className="flex gap-2"><span className="mt-0.5 shrink-0"><Icon name={ICON[s.state]} tone={TONE[s.state]} /></span>
                <span className={s.state === "todo" ? "text-fg-muted" : ""}>{s.text}{s.state === "failed" && request?.code ? ` (${request.code})` : ""}</span></li>
            ))}
          </ul>
          <LiveActionFailure failed={action.failed} />
          {request?.outcome === "no_reply" && <FormButton className="w-full" disabled={!actions.resend || action.busy}
            onClick={() => void action.submit(() => actions.resend?.(request.request_id))}>{action.busy ? "Sending…" : "Send again"}</FormButton>}
          <p className="text-small text-fg-faint">You can close this. Telegram tells you when the run has ended.</p>
          <FormButton className="w-full" onClick={onClose}>Close</FormButton>
        </> : <>
          <StopEffects phone snap={snap} />
          <HoldButton onHeld={send} disabled={!actions.stop || run.ended || action.busy}>Hold to stop</HoldButton>
          <FormButton className="w-full" onClick={onClose}>Cancel</FormButton>
        </>}
      </div>
    </Sheet>
  );
}
