// The comparison of the version a page opens, read once per version, commit and build (the commit its graph was drawn
// at, so a graph kept across a head that does not reach it keeps its answers): the bootstrap behind it
// runs only for a version somebody looks at, and an answer stays in the browser. A failure is shown but kept by
// neither, so the next time the version is opened it is asked again (CF-30). A version
// compares its registration's last research run when that run passed, as the graph does; any other has nothing to ask for.
import { useEffect } from "react";
import { fetchComparison, type Fetched } from "../lib/comparisonApi";
import { keep, readKept } from "../lib/storage";
import type { Candidate } from "../model/types";
import { useView } from "../model/view";
import { atom, useAtom } from "./atom";

type Comparison = NonNullable<Candidate["comparison"]>;
type Compared = { kind: "reading" } | Fetched<Comparison>;
const KIND = "comparison", KEPT = 512;
const NONE: Compared = { kind: "ready", comparison: null };
const reads = atom<ReadonlyMap<string, Compared>>(new Map());
const put = (key: string, value: Compared) => reads.set(new Map(reads.get()).set(key, value));

async function read(key: string, registration: string, trial: number, at: string): Promise<void> {
  const had = reads.get().get(key);
  if (had && had.kind !== "failed") return;
  put(key, { kind: "reading" });
  const kept = await readKept<{ comparison: Comparison | null }>(KIND, key);
  if (kept) { put(key, { kind: "ready", comparison: kept.comparison }); return; }
  const found = await fetchComparison<Comparison>(registration, trial, at);
  put(key, found);
  if (found.kind === "ready") void keep(KIND, key, { comparison: found.comparison }, KEPT);
}

/** What the graph would have compared for this version: its registration and last research run, if that passed. */
function job(c: Candidate): { registration: string; trial: number } | null {
  const research = (c.trials ?? []).filter((t) => t.purpose === "research");
  const last = research[research.length - 1];
  return c.registration && last?.status === "passed" ? { registration: c.registration, trial: last.trial_id } : null;
}

export function useComparison(c: Candidate): Compared {
  const scope = useView().scope, at = scope?.drawn_commit ?? scope?.ledger_commit ?? null, all = useAtom(reads), wanted = job(c);
  const key = wanted && at ? `${scope?.build ?? ""} ${wanted.registration} ${wanted.trial} ${at}` : null;
  useEffect(() => { if (wanted && at && key) void read(key, wanted.registration, wanted.trial, at); }, [key]);
  return key ? all.get(key) ?? { kind: "reading" } : NONE;
}
