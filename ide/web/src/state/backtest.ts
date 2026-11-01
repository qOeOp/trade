// The backtest the Runs page shows (state/shown.ts's trial) as its report gives it (model/backtest.ts),
// read once per trial and ledger commit for the session: the view's commit, so the report is the one the
// rest of the page reads. Where it is not to be had, what the page says instead.
import { useEffect } from "react";
import { fetchTrial } from "../lib/trialApi";
import { backtest, type Backtest } from "../model/backtest";
import { useView } from "../model/view";
import { atom, useAtom } from "./atom";
import { useShown } from "./shown";

/** Being read; read; refused by the product (its code and words); or not served by this page's server. */
export type Loaded = { kind: "reading" } | { kind: "ready"; b: Backtest } | { kind: "refused"; code: string; message: string } | { kind: "absent"; message: string };
const loaded = atom<ReadonlyMap<string, Loaded>>(new Map());
const put = (key: string, value: Loaded) => loaded.set(new Map(loaded.get()).set(key, value));

/** The shown version's backtest, null when it has no research run to show. */
export function useBacktest(): Loaded | null {
  const { trial } = useShown(), at = useView().scope?.ledger_commit ?? null, all = useAtom(loaded);
  const key = trial && at ? `${trial.trial_id}@${at}` : null;
  useEffect(() => {
    if (!key || loaded.get().has(key)) return;
    put(key, { kind: "reading" });
    void fetchTrial(trial!.trial_id, at!).then((r) => put(key, r.kind === "report" ? { kind: "ready", b: backtest(r.report) } : r));
  }, [key]);
  if (!trial) return null;
  return key ? all.get(key) ?? { kind: "reading" } : { kind: "absent", message: "the view names no ledger commit" };
}

/** What the chart says of a backtest it does not draw: being read, refused, not served, or no equity. */
export function backtestNote(l: Loaded | null, trial: number): string | null {
  if (!l) return null;
  if (l.kind === "reading") return `Reading trial ${trial}…`;
  if (l.kind === "absent") return "Backtest data not served by this IDE";
  if (l.kind === "refused") return `Backtest · ${l.code}: ${l.message}`;
  return l.b.starting === null ? `Backtest · trial ${trial} · starting balance not recorded` : null;
}
