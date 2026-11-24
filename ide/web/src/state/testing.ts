// The drawn line's multiple-testing reading and its runs' deflated Sharpe ranges (`research multiple-testing`, from the
// page's own server under /api/testing), read at the view's ledger commit while a backtest's reliability shows: they move
// with every overlapping trial, so the sealed report leaves them out. While a newer commit is read the line's last
// answer stays.
import { useEffect } from "react";
import { getJson, type Unread } from "../lib/transport";
import { useView } from "../model/view";
import { atom, useAtom } from "./atom";

export type Testing = {
  multiple_testing: { effective_trials: number | null; trials_with_sweeps: number } | null;
  /** By trial ID: the probability that the run's Sharpe is above the best of that many trials, at each count. */
  deflated_sharpe: Record<string, { effective_trials: number | null; trials_with_sweeps: number | null } | null>;
};
export type TestingRead = { kind: "reading" } | { kind: "ready"; testing: Testing } | Unread;

type Held = { at: string; read: TestingRead };
const reads = atom<ReadonlyMap<string, Held>>(new Map());
const put = (line: string, held: Held) => reads.set(new Map(reads.get()).set(line, held));

async function read(line: string, at: string): Promise<void> {
  const had = reads.get().get(line);
  if (had?.at === at) return;
  put(line, { at, read: had?.read.kind === "ready" ? had.read : { kind: "reading" } });
  const found = await getJson<Testing>(`/api/testing?${new URLSearchParams({ line, at })}`);
  if (reads.get().get(line)?.at === at) put(line, { at, read: found.kind === "ready" ? { kind: "ready", testing: found.body } : found });
}

/** The drawn line's reading, read while the calling component is mounted. */
export function useTesting(): TestingRead {
  const { line, scope } = useView(), at = scope?.ledger_commit ?? null, all = useAtom(reads);
  useEffect(() => { if (line.name && at) void read(line.name, at); }, [line.name, at]);
  return all.get(line.name)?.read ?? { kind: "reading" };
}
