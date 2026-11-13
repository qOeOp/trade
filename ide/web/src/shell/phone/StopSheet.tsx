import { useState, type ReactNode } from "react";
import { FormButton } from "../../components/chat/Field";
import { HoldButton } from "../../components/HoldButton";
import { Side } from "../../components/PhoneParts";
import { Sheet } from "../../components/Sheet";
import { useLiveAction, LiveActionFailure } from "../../components/LiveActionState";
import { Icon } from "../../icons/Icon";
import { fixed } from "../../lib/paperApi";
import type { LiveRun } from "../../model/liveTrading";
import { liveHeld, liveStatus, liveWorking, marked, type Held, type Working } from "../../model/phoneRuns";
import { useLiveTrading } from "../../state/liveTrading";
import { useSnapshot } from "../../state/market";
import { Version } from "./RunCards";

/** A working order that protects a held position: a trigger on the other side of its contract. */
const protects = (o: Working, held: readonly Held[]) => o.trigger !== null && held.some((h) => h.symbol === o.symbol && o.buy === !h.long);

type Step = { text: ReactNode; state: "done" | "doing" | "todo" | "failed" };
const ICON = { done: "passed", doing: "loading", todo: "untested", failed: "failed" } as const;
const TONE = { done: "meets", doing: "recommended", todo: "fg-faint", failed: "fail" } as const;

/** What a stop does to `run` as its working orders and positions stand now (engine/README.md, the STOP path). */
function Effects({ held, working }: { held: readonly Held[]; working: readonly Working[] }) {
  const entries = working.filter((o) => !protects(o, held)), stops = working.filter((o) => protects(o, held));
  return (
    <ul className="list-disc space-y-2 pl-6 text-dense">
      <li>Stops new entries and cancels its entry orders. {entries.length ? `${entries.length} open now.` : "It has none open now."}</li>
      {held.map((h) => <li key={h.key}>Closes {h.symbol} <Side long={h.long} word={h.long ? "long" : "short"} /> {fixed(h.qty)} at market{h.mark !== null ? ` (now ≈ ${fixed(h.mark)})` : ""}, one attempt.</li>)}
      {stops.map((o) => <li key={o.key}>Keeps the protective stop at {fixed(o.trigger)} until the position is flat.</li>)}
      <li>The run ends once Binance shows the account flat. It cannot be resumed; a new run starts from the desktop.
        If the close is refused, the run is left unresolved and Telegram tells you.</li>
    </ul>
  );
}

/** Where a requested stop is, from the request and the run as Live reads it again. */
function steps(run: LiveRun, outcome: string | undefined, held: readonly Held[], working: readonly Working[]): Step[] {
  const refused = outcome === "refused", ended = run.ended, unresolved = liveStatus(run).word === "Unresolved";
  const entries = working.filter((o) => !protects(o, held));
  return [
    { text: refused ? "Stop refused by Live" : "Stop requested", state: refused ? "failed" : outcome === "effect_recorded" ? "done" : "doing" },
    { text: "Entry orders cancelled", state: refused ? "todo" : entries.length ? "doing" : "done" },
    ...held.map((h): Step => ({ text: <>Closing {h.symbol} {h.long ? "long" : "short"} {fixed(h.qty)}</>, state: refused ? "todo" : unresolved ? "failed" : "doing" })),
    { text: unresolved ? "Unresolved: reconcile on the desktop" : "The run ends when the account is flat", state: unresolved ? "failed" : ended ? "done" : "todo" },
  ];
}

/** The sheet Request stop… opens: what stopping does now, held for 1.5 s to send; then where the stop is. */
export function StopSheet({ run, open, onClose }: { run: LiveRun; open: boolean; onClose: () => void }) {
  const { view, actions } = useLiveTrading(), action = useLiveAction(), [sent, setSent] = useState(false);
  const held = marked(liveHeld(run), useSnapshot()?.coins), working = liveWorking(run);
  const request = [...(view.requests ?? [])].reverse().find((r) => r.action === "stop" && r.target.run_id === run.id);
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
            {steps(run, request?.outcome, held, working).map((s, i) => (
              <li key={i} className="flex gap-2"><span className="mt-0.5 shrink-0"><Icon name={ICON[s.state]} tone={TONE[s.state]} /></span>
                <span className={s.state === "todo" ? "text-fg-muted" : ""}>{s.text}{s.state === "failed" && request?.code ? ` (${request.code})` : ""}</span></li>
            ))}
          </ul>
          <LiveActionFailure failed={action.failed} />
          <p className="text-small text-fg-faint">You can close this. Telegram tells you when the run has ended.</p>
          <FormButton className="w-full" onClick={onClose}>Close</FormButton>
        </> : <>
          <Effects held={held} working={working} />
          <HoldButton onHeld={send} disabled={!actions.stop || run.ended || action.busy}>Hold to stop</HoldButton>
          <FormButton className="w-full" onClick={onClose}>Cancel</FormButton>
        </>}
      </div>
    </Sheet>
  );
}
