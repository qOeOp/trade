import { useEffect, useState } from "react";
import { AlertDialog, Dialog } from "radix-ui";
import { useAtom } from "../state/atom";
import { lastSymbols, startDialog, startPaper, stopDialog, stopPaper } from "../state/paper";
import { FormButton } from "./chat/Field";

const PANEL = "fixed left-1/2 top-[18%] z-50 w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 space-y-3 rounded-popup border border-popup-border bg-popup p-4 text-dense shadow-popup outline-none";
const SCRIM = "fixed inset-0 z-40 bg-scrim";
const SYMBOLS = /^[A-Z0-9]{2,30}$/;

/** "Run paper with…": the contracts (the last research replay's to start with) or the whole universe;
 *  execution is bars and the account the replay's, so neither is a choice. */
function StartDialog({ candidate }: { candidate: string }) {
  const [text, setText] = useState("");
  const [pool, setPool] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    lastSymbols(candidate).then((found) => {
      if (found) setText(found.join(", "));
      setNote(found ? "The contracts of its last research replay." : "It has no research replay: name the contracts.");
    }).catch(() => setNote("The last research replay could not be read: name the contracts."));
  }, [candidate]);
  const symbols = text.toUpperCase().split(/[\s,]+/).filter(Boolean);
  const bad = symbols.filter((s) => !SYMBOLS.test(s));
  const ready = pool || (symbols.length > 0 && bad.length === 0);
  const start = async () => {
    setBusy(true);
    const started = await startPaper(candidate, pool ? { universe: "pool" } : { symbols });
    setBusy(false);
    if (started) startDialog.set(null);
  };
  return (
    <Dialog.Content className={PANEL} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) void start(); }}>
      <Dialog.Title className="text-ui font-semibold">Run paper with…</Dialog.Title>
      <Dialog.Description className="font-mono text-fg-muted">{candidate}</Dialog.Description>
      <label className="block space-y-1">
        <span className="text-fg-muted">Contracts</span>
        <textarea value={text} disabled={pool} onChange={(e) => setText(e.target.value)} rows={3} spellCheck={false}
                  className="block w-full resize-none rounded-control border border-line-strong bg-island px-2 py-1 font-mono outline-none placeholder:text-fg-ghost focus:border-focus disabled:text-fg-ghost"
                  placeholder="BTCUSDT, ETHUSDT" />
        <span className={`block text-small ${bad.length && !pool ? "text-fail" : "text-fg-faint"}`}>
          {bad.length && !pool ? `Not a Binance symbol: ${bad.slice(0, 3).join(", ")}` : note ?? "Reading the last research replay…"}
        </span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} className="accent-(--focus)" />
        Every member of the current month's universe
      </label>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-fg-muted">
        <dt className="text-fg-faint">Execution</dt><dd>One-minute bars, Sandbox fills</dd>
        <dt className="text-fg-faint">Account</dt><dd>The replay's: 100,000 USDT margin, 1× leverage</dd>
        <dt className="text-fg-faint">Data</dt><dd>Binance public market data only, no credential</dd>
      </dl>
      <div className="flex justify-end gap-2 pt-1">
        <Dialog.Close asChild><FormButton>Cancel</FormButton></Dialog.Close>
        <FormButton primary icon="run" disabled={!ready || busy} onClick={() => void start()}>{busy ? "Starting…" : "Start"}</FormButton>
      </div>
    </Dialog.Content>
  );
}

/** The dialogs a paper start or stop asks first; mounted once in the shell. */
export function PaperDialogs() {
  const candidate = useAtom(startDialog);
  const run = useAtom(stopDialog);
  return (
    <>
      <Dialog.Root open={candidate !== null} onOpenChange={(open) => { if (!open) startDialog.set(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className={SCRIM} />
          {candidate && <StartDialog key={candidate} candidate={candidate} />}
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root open={run !== null} onOpenChange={(open) => { if (!open) stopDialog.set(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={SCRIM} />
          <AlertDialog.Content className={PANEL}>
            <AlertDialog.Title className="text-ui font-semibold">Stop paper?</AlertDialog.Title>
            <AlertDialog.Description className="text-fg-muted">
              <span className="font-mono text-fg">{run?.candidate}</span> · run {run?.paper_id}. Its working orders are
              cancelled and open positions are booked at the last price; then the run ends and is sealed into the ledger.
              To go on later, start a new run.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 pt-1">
              <AlertDialog.Cancel asChild><FormButton>Cancel</FormButton></AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <FormButton primary icon="pause" onClick={() => { if (run) void stopPaper(run); }}>Stop</FormButton>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
