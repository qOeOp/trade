// One version's comparison (`research comparison`), from the page's own server under /api/comparison at a
// full ledger commit (ide/research_graph/serve.py): the graph leaves it out, since only the version a page
// opens shows it. Null when the version has none.
export type Fetched<Comparison> = { kind: "ready"; comparison: Comparison | null } | { kind: "failed"; message: string };

export async function fetchComparison<Comparison>(registration: string, trialId: number, at: string): Promise<Fetched<Comparison>> {
  const query = new URLSearchParams({ registration, trial_id: String(trialId), at });
  try {
    const response = await fetch(`/api/comparison?${query}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as { comparison?: Comparison | null; code?: string; message?: string } | null;
    if (response.ok && body) return { kind: "ready", comparison: body.comparison ?? null };
    return { kind: "failed", message: body?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "failed", message: String(error) };
  }
}
