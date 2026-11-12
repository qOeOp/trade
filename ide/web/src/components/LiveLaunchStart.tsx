import { FormButton } from "./chat/Field";
import { TextButton } from "./TextButton";

/** The start control at the foot of the launch page. Greyed until every condition passes, naming what it waits
 *  on. The first click only arms it: it then reads "Confirm: real orders, source <hash>", in place, and the
 *  second click starts the run. Cancel, or any change on the page, disarms it. */
export function LiveLaunchStart({ ready, waiting, armed, busy, sourceHash, arm, disarm, start }: {
  ready: boolean; waiting: readonly string[]; armed: boolean; busy: boolean; sourceHash: string | null;
  arm: () => void; disarm: () => void; start: () => void;
}) {
  const short = sourceHash?.slice(0, 8) ?? "";
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {armed && ready ? <>
        {/* Short enough for a narrow column: the full source is in the note under it. */}
        <FormButton primary disabled={busy} onClick={start} aria-describedby="live-launch-confirm"
          title={sourceHash ?? undefined}>{busy ? "Starting…" : <>Confirm: real orders, source {short}</>}</FormButton>
        <TextButton size="form" disabled={busy} onClick={disarm}>Cancel</TextButton>
      </> : <FormButton primary icon="run" disabled={!ready || busy} onClick={arm}>Start live run</FormButton>}
    </div>
    {armed && ready ? <p id="live-launch-confirm" className="text-small text-fg-muted">
      The strategy will place real orders on your Binance account. Live checks the account again first. Closing this page does not stop the run.
      <span className="mt-1 block break-all text-fg-faint">Source {sourceHash}</span>
    </p> : !ready && <p className="text-small text-fg-faint">{waiting.length ? `Waiting on: ${waiting.join(", ")}.` : "Live takes no new runs right now."}</p>}
  </div>;
}
