// The backtest the Runs page shows (state/shown.ts's trial) as its report gives it (model/backtest.ts), read
// at the view's commit once for the session while the trial's row in the view stays as it is. A sealed
// run's report changes only with that row (a later record masking it), not with each commit the research
// adds, so it stays on the page and the server stays unasked while the ledger moves; when the row does
// change the last answer stays until the new one is in. One that was no report is asked again at the view's
// next commit. Where it is not to be had, what the page says instead.
import { useEffect } from "react";
import { fetchTrial } from "../lib/trialApi";
import { backtest, type Backtest } from "../model/backtest";
import { useView } from "../model/view";
import { atom, useAtom } from "./atom";
import { useShown } from "./shown";

/** Being read; read; refused by the product (its code and words); or not served by this page's server. */
export type Loaded = { kind: "reading" } | { kind: "ready"; b: Backtest } | { kind: "refused"; code: string; message: string } | { kind: "absent"; message: string };
type Read = { row: string; at: string; answer: Loaded };
const reads = atom<ReadonlyMap<number, Read>>(new Map());
const put = (id: number, read: Read) => reads.set(new Map(reads.get()).set(id, read));

function read(id: number, row: string, at: string): void {
  const last = reads.get().get(id);
  if (last?.row === row && (last.answer.kind === "ready" || last.answer.kind === "reading" || last.at === at)) return;
  put(id, { row, at, answer: last?.answer ?? { kind: "reading" } });
  void fetchTrial(id, at).then((r) => {
    if (reads.get().get(id)?.row === row) put(id, { row, at, answer: r.kind === "report" ? { kind: "ready", b: backtest(r.report) } : r });
  });
}

/** The shown version's backtest, null when it has no research run to show. */
export function useBacktest(): Loaded | null {
  const { trial } = useShown(), at = useView().scope?.ledger_commit ?? null, all = useAtom(reads);
  const row = trial && JSON.stringify(trial);
  useEffect(() => { if (trial && row && at) read(trial.trial_id, row, at); }, [row, at]);
  if (!trial) return null;
  return at ? all.get(trial.trial_id)?.answer ?? { kind: "reading" } : { kind: "absent", message: "the view names no ledger commit" };
}

/** What the chart says of a backtest it does not draw: being read, refused, not served, or no equity. */
export function backtestNote(l: Loaded | null, trial: number): string | null {
  if (!l) return null;
  if (l.kind === "reading") return `Reading trial ${trial}…`;
  if (l.kind === "absent") return "Backtest data not served by this IDE";
  if (l.kind === "refused") return `Backtest · ${l.code}: ${l.message}`;
  return l.b.starting === null ? `Backtest · trial ${trial} · starting balance not recorded` : null;
}
