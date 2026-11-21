import { useEffect, useState } from "react";
import { fixed } from "../lib/paperApi";
import type { LiveRun, LiveTradingActions } from "../model/liveTrading";
import { liveHeld, liveWorking, marked, protects, type Held, type Working } from "../model/phoneRuns";
import { useSnapshot } from "../state/market";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";
import { Side } from "./PhoneParts";
import { TextButton } from "./TextButton";

/** How long a desktop stop stays armed after its first click: the second click within it sends the stop. */
const CONFIRM_MS = 10_000;
/** A Confirm stop click this soon after arming is the rest of a double click on Request stop…, not a decision. */
const SETTLE_MS = 500;

/** What a stop does to a run as its working orders and positions stand now (engine/README.md, the STOP path). The
 *  phone's sheet also says where a new run starts; the desktop is where it starts, so it does not. */
export function StopEffects({ held, working, phone = false }: { held: readonly Held[]; working: readonly Working[]; phone?: boolean }) {
  const entries = working.filter((o) => !protects(o, held)), stops = working.filter((o) => protects(o, held));
  return (
    <ul className="list-disc space-y-2 pl-6 text-dense">
      <li>Stops new entries and cancels its entry orders. {entries.length ? `${entries.length} open now.` : "It has none open now."}</li>
      {held.map((h) => <li key={h.key}>Closes {h.symbol} <Side long={h.long} word={h.long ? "long" : "short"} /> {fixed(h.qty)} at market{h.mark !== null ? ` (now ≈ ${fixed(h.mark)})` : ""}, one attempt.</li>)}
      {stops.map((o) => <li key={o.key}>Keeps the protective stop at {fixed(o.trigger)} until the position is flat.</li>)}
      <li>The run ends once Binance shows the account flat. It cannot be resumed{phone ? "; a new run starts from the desktop" : ""}.
        If the close is refused, the run is left unresolved and Telegram tells you.</li>
    </ul>
  );
}

export type StopRequest = ReturnType<typeof useStopRequest>;

/** A desktop stop in two clicks, inline (no dialog): the first arms it and shows what stopping does, the second
 *  within CONFIRM_MS sends it, but not within SETTLE_MS of the first; otherwise it disarms. Switching runs disarms it
 *  too. */
export function useStopRequest(run: LiveRun | null, actions: LiveTradingActions) {
  const action = useLiveAction(), [armed, setArmed] = useState<{ id: string; at: number } | null>(null);
  const on = run !== null && armed?.id === run.id;
  useEffect(() => {
    if (!on) return;
    const timer = window.setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [on]);
  const disabled = !run || !actions.stop || run.ended || action.busy;
  return {
    run, armed: on && !disabled, busy: action.busy, failed: action.failed, disabled,
    arm: () => setArmed(run ? { id: run.id, at: Date.now() } : null), cancel: () => setArmed(null),
    confirm: () => {
      if (!run || !on || Date.now() - armed!.at < SETTLE_MS) return;
      setArmed(null); void action.submit(() => actions.stop?.(run.id));
    },
  };
}

/** Request stop…, or, once armed, Confirm stop and then Cancel, so the button under the pointer after the first click
 *  is Cancel; `form` draws Request stop… as a dialog footer's button. */
export function StopButtons({ stop, form = false, className = "" }: { stop: StopRequest; form?: boolean; className?: string }) {
  const label = stop.busy ? "Submitting stop…" : "Request stop…";
  if (!stop.armed) return form ? <FormButton icon="stop" className={className} disabled={stop.disabled} onClick={stop.arm}>{label}</FormButton>
    : <TextButton size="form" className={className} disabled={stop.disabled} onClick={stop.arm}>{label}</TextButton>;
  return <span className={`inline-flex items-center gap-2 ${className}`}>
    <FormButton icon="stop" className="text-fail-fg" onClick={stop.confirm}>Confirm stop</FormButton>
    <TextButton size="form" onClick={stop.cancel}>Cancel</TextButton>
  </span>;
}

/** While armed, what stopping the run does now, from its native events as they last stand. */
export function StopPanel({ stop }: { stop: StopRequest }) {
  const coins = useSnapshot()?.coins;
  if (!stop.armed || !stop.run) return null;
  const held = marked(liveHeld(stop.run), coins), working = liveWorking(stop.run);
  return <section role="alert" aria-label="Stop this Live run?" className="space-y-2 border-l-2 border-fail pl-2">
    <h3 className="text-dense font-semibold text-fail-fg">Stop this Live run?</h3>
    <StopEffects held={held} working={working} />
    <p className="text-small text-fg-faint">Confirm stop within {CONFIRM_MS / 1000} seconds sends it; otherwise nothing is sent.</p>
  </section>;
}
