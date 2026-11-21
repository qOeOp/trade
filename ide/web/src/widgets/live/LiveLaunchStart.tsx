import { FormButton } from "../../ui/chat/Field";
import { TextButton } from "../../ui/TextButton";

/** The start control at the foot of the launch page: one row of controls and at most one short line under it.
 *  Greyed until every condition passes, the line naming the columns still waiting (their rows say why; no line
 *  where Live is closed, which the page says above), or `blocker`, what holds it back beyond them. The first
 *  click only arms it ("Confirm start · <source>"), the second starts; Cancel, or any change, disarms it. A refused
 *  start is said here, in place. Reset limits sits beside Start while a value differs from the Live settings. */
export function LiveLaunchStart({ demo, ready, waiting, blocker, armed, busy, sourceHash, refused, reset, arm, disarm, start }: {
  demo: boolean; ready: boolean; waiting: readonly string[] | null; blocker: string | null; armed: boolean; busy: boolean; sourceHash: string | null;
  refused: string | null; reset: (() => void) | null; arm: () => void; disarm: () => void; start: () => void;
}) {
  const confirm = armed && ready;
  const line = busy ? { text: "Checking the account, then starting.", tone: "text-fg-faint" }
    : refused ? { text: refused, tone: "text-fail-fg" }
    : confirm ? { text: demo ? "Places orders on Binance Demo Trading, not the real account." : "Places real orders on Binance.", tone: "text-fg-muted" }
    : ready || waiting === null ? null
    : blocker ? { text: blocker, tone: "text-fg-faint" }
    : { text: waiting.length ? `Waiting on ${listed(waiting)}` : "Live takes no new runs right now.", tone: "text-fg-faint" };
  return <>
    <div className="flex flex-wrap items-center gap-2">
      {busy ? <FormButton primary disabled>Starting…</FormButton>
        : confirm ? <>
          <FormButton primary onClick={start} aria-describedby="live-launch-line" title={sourceHash ?? undefined}>
            Confirm start · <span className="tabular-nums">{sourceHash?.slice(0, 8)}</span></FormButton>
          <TextButton size="form" onClick={disarm}>Cancel</TextButton>
        </> : <>
          <FormButton primary icon="run" disabled={!ready} onClick={arm}>{demo ? "Start demo run" : "Start live run"}</FormButton>
          {reset && <TextButton size="form" onClick={reset}>Reset limits</TextButton>}
        </>}
    </div>
    {line && <p id="live-launch-line" role={refused ? "alert" : undefined} className={`text-small ${line.tone}`}>{line.text}</p>}
  </>;
}

/** "Account", "Strategy and Account", "Strategy, Account and Limits & start". */
const listed = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
