// One version's comparison (`research comparison`), from the page's own server under /api/comparison at a
// full ledger commit (ide/research_graph/serve.py): the graph leaves it out, since only the version a page
// opens shows it. Null when the version has none.
import { getJson } from "./transport";

export type Fetched<Comparison> = { kind: "ready"; comparison: Comparison | null } | { kind: "failed"; message: string };

export async function fetchComparison<Comparison>(registration: string, trialId: number, at: string): Promise<Fetched<Comparison>> {
  const read = await getJson<{ comparison?: Comparison | null }>(`/api/comparison?${new URLSearchParams({ registration, trial_id: String(trialId), at })}`);
  return read.kind === "ready" ? { kind: "ready", comparison: read.body.comparison ?? null } : { kind: "failed", message: read.message };
}
