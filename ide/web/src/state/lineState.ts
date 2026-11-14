// A line's gates and review readings (`research state`, from the page's own server under /api/state at the commit the
// graph was drawn at): the graph leaves out the market-day gate and the due change of approach, whose
// reading compares the line's latest runs, so they are read only when the line menu opens. A failure is shown and
// asked again the next time the menu opens.
import { useEffect } from "react";
import { getJson } from "../lib/transport";
import { useView } from "../model/view";
import { atom, useAtom } from "./atom";

export type LineState = {
  ledger_commit: string;
  gates: { code: string; message: string }[];
  review_every: number;
  /** The line's latest research runs read back for a due change of approach; null without a line. */
  undistinguished_runs: { trials: number[]; uncompared: number[]; distinguished: number | null } | null;
  /** The line's research runs since its latest recommendation, of its execution identity. */
  unreviewed_trials: number[];
};
export type StateRead = { kind: "reading" } | { kind: "ready"; state: LineState } | { kind: "failed"; message: string };

const reads = atom<ReadonlyMap<string, StateRead>>(new Map());
const put = (key: string, value: StateRead) => reads.set(new Map(reads.get()).set(key, value));

async function read(key: string, line: string, at: string): Promise<void> {
  const had = reads.get().get(key);
  if (had && had.kind !== "failed") return;
  put(key, { kind: "reading" });
  const found = await getJson<LineState>(`/api/state?${new URLSearchParams({ line, at })}`);
  put(key, found.kind === "ready" ? { kind: "ready", state: found.body } : { kind: "failed", message: found.message });
}

/** The line's state at the drawn commit, read when the calling component mounts (the line menu opening). */
export function useLineState(line: string): StateRead | null {
  const scope = useView().scope, at = scope?.drawn_commit ?? scope?.ledger_commit ?? null, all = useAtom(reads);
  const key = line && at ? `${line} ${at}` : null;
  useEffect(() => { if (key && at) void read(key, line, at); }, [key]);
  return key ? all.get(key) ?? { kind: "reading" } : null;
}
