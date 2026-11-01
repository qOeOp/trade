// Paper runs on the page: whether the page's server has a paper daemon and reaches it, the runs it lists
// (read every few seconds while it does), the run and view the Paper page shows, starts and stops in
// flight, the dialogs that ask before one, and the last notice for the status bar.
import { ApiError } from "../lib/agentApi";
import { paperApi, paperToken, type Listing, type PaperRun } from "../lib/paperApi";
import { latestOf } from "../model/chain";
import { atom, useAtom } from "./atom";

const POLL_MS = 3000;
const NOTICE_MS = 6000;
/** States of a run that has not been sealed yet: it still has (or had) containers. */
export const ACTIVE = new Set(["running", "stopping", "ended", "unsealed"]);

/** Whether the page's server has a paper daemon (`--paper`, which puts a token in the page): "absent"
 *  without one; with one, "present" while it answers and "offline" while it does not, asked again every
 *  few seconds, so the Paper page says the daemon is down instead of vanishing. */
export const paperService = atom<"checking" | "absent" | "offline" | "present">("checking");
export const paperRuns = atom<Listing | null>(null);
/** The run the Paper page shows, and what its chart shows: "equity", or a contract (null until the
 *  page picks one). The trades and events follow the chart: a contract's alone, or all on Equity. */
export const selectedRun = atom<number | null>(null);
export const paperTab = atom<string | null>(null);
/** Versions being started from this page, and runs being stopped or deleted. */
export const starting = atom<ReadonlySet<string>>(new Set());
export const stopping = atom<ReadonlySet<number>>(new Set());
export const deleting = atom<ReadonlySet<number>>(new Set());
/** "Run paper with…" open for a version; "Stop paper?" or "Delete run?" open for a run. */
export const startDialog = atom<string | null>(null);
export const stopDialog = atom<PaperRun | null>(null);
export const deleteDialog = atom<PaperRun | null>(null);
export const notice = atom<{ text: string; failed: boolean; n: number } | null>(null);

export const usePaperService = () => useAtom(paperService);
/** The page has a Paper panel: its server has a daemon, answering or not. */
export const usePaperPanel = () => { const service = useAtom(paperService); return service === "present" || service === "offline"; };
export const usePaperRuns = () => useAtom(paperRuns);

let shown = 0;
function say(text: string, failed = false): void {
  const n = ++shown;
  notice.set({ text, failed, n });
  window.setTimeout(() => { if (notice.get()?.n === n) notice.set(null); }, NOTICE_MS);
}
const add = <T,>(set: ReadonlySet<T>, item: T) => new Set([...set, item]);
const drop = <T,>(set: ReadonlySet<T>, item: T) => new Set([...set].filter((x) => x !== item));

// Polls the daemon goes unanswered before the page calls it offline: one may be a blip.
const MISSES = 2;
let missed = 0;

export async function refreshRuns(): Promise<void> {
  try {
    const listing = await paperApi<Listing>("/runs");
    missed = 0;
    paperRuns.set(listing);
    const picked = listing.runs.find((r) => r.paper_id === selectedRun.get());
    if (!picked) {
      const active = listing.runs.filter((r) => ACTIVE.has(r.state));
      selectedRun.set((active[active.length - 1] ?? listing.runs[listing.runs.length - 1])?.paper_id ?? null);
    } else selectedRun.set(latestOf(picked, listing.runs).paper_id);  // a run continued since: its chain's latest
  } catch (error) {
    if (error instanceof ApiError && error.code === "PAPER_UNAVAILABLE") {
      if (++missed >= MISSES) paperService.set("offline");
      return;
    }
    say(`Paper runs could not be read: ${error instanceof ApiError ? `${error.code}: ${error.message}` : String(error)}`, true);
  }
}

async function poll(): Promise<void> {
  if (paperService.get() === "present") return refreshRuns();
  try {
    await paperApi("/health");
  } catch {
    paperService.set("offline");
    return;
  }
  missed = 0;
  paperService.set("present");
  await refreshRuns();
}

/** With a daemon behind the page's server, follows it: its runs while it answers, its health while not. */
export async function detectPaperService(): Promise<void> {
  if (!paperToken()) {
    paperService.set("absent");
    return;
  }
  await poll();
  window.setInterval(() => void poll(), POLL_MS);
}

/** The version's run that has not been sealed yet, if any (one per version at a time). */
export const activeRun = (listing: Listing | null, candidate: string) =>
  listing?.runs.find((r) => r.candidate === candidate && ACTIVE.has(r.state));

const failure = (error: unknown) => (error instanceof ApiError ? `${error.code}: ${error.message}` : String(error));

/** Starts a run of `candidate`: with the contracts of its last research replay, or the ones given. */
export async function startPaper(candidate: string, scope: { symbols?: string[]; universe?: "pool" } = {}): Promise<boolean> {
  if (starting.get().has(candidate)) return false;
  starting.set(add(starting.get(), candidate));
  try {
    const run = await paperApi<{ paper_id: number; symbols: string[] }>("/runs", { method: "POST", body: { candidate, ...scope } });
    const listed = run.symbols.length > 4 ? `${run.symbols.slice(0, 3).join(", ")} and ${run.symbols.length - 3} more` : run.symbols.join(", ");
    say(`Paper started · ${candidate} · ${listed}`);
    selectedRun.set(run.paper_id);
    paperTab.set(null);
    await refreshRuns();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === "NO_LAST_REPLAY") startDialog.set(candidate);
    else say(`Paper did not start · ${candidate} · ${failure(error)}`, true);
    return false;
  } finally {
    starting.set(drop(starting.get(), candidate));
  }
}

/** Stops a run: its working orders are cancelled, open positions are booked at the last price, it is sealed. */
export async function stopPaper(run: PaperRun): Promise<void> {
  stopping.set(add(stopping.get(), run.paper_id));
  try {
    await paperApi(`/runs/${run.paper_id}/stop`, { method: "POST", body: {} });
    say(`Paper stopping · ${run.candidate ?? run.paper_id} · its orders are cancelled, then it is sealed`);
    await refreshRuns();
  } catch (error) {
    say(`Paper did not stop · ${run.candidate ?? run.paper_id} · ${failure(error)}`, true);
  } finally {
    stopping.set(drop(stopping.get(), run.paper_id));
  }
}

/** Deletes a sealed run from the ledger: its declaration and capture leave the research branch (Dolt
 *  history and the public copy keep them). */
export async function deletePaper(run: PaperRun): Promise<void> {
  if (deleting.get().has(run.paper_id)) return;
  deleting.set(add(deleting.get(), run.paper_id));
  try {
    await paperApi(`/runs/${run.paper_id}/delete`, { method: "POST", body: {} });
    say(`Paper run deleted · ${run.candidate ?? run.paper_id} · run ${run.paper_id}`);
    if (selectedRun.get() === run.paper_id) selectedRun.set(null);
    await refreshRuns();
  } catch (error) {
    say(`Paper run not deleted · ${run.candidate ?? run.paper_id} · ${failure(error)}`, true);
  } finally {
    deleting.set(drop(deleting.get(), run.paper_id));
  }
}

/** The contracts of a version's last research replay, or null when it has none. */
export async function lastSymbols(candidate: string): Promise<string[] | null> {
  const found = await paperApi<{ last: { symbols: string[] } | null }>(`/defaults?candidate=${encodeURIComponent(candidate)}`);
  return found.last?.symbols ?? null;
}
