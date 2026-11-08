// Paper runs on the page: whether the page's server has a paper daemon and reaches it, the runs it lists
// (read every few seconds while it does and the page shows), starts and stops in flight, the dialogs that ask before one,
// the last notice for the status bar and the last refused action. The run the Runs page shows is state/stage.ts's.
import { ApiError } from "../lib/agentApi";
import { paperApi, paperToken, type Listing, type PaperRun } from "../lib/paperApi";
import { shared } from "../lib/shared";
import { whileVisible } from "../lib/whileVisible";
import { ACTIVE } from "../model/chain";
import { atom, useAtom } from "./atom";
import { phoneNow } from "./phone";
import { showRunsPage } from "./shell";
import { chooseRun, pickWanted } from "./stage";
import { confirmStart, pendingStart, unconfirmedStarts, type Scope } from "../lib/pendingStarts";
import { sessionRequired } from "./session";

const POLL_MS = 3000, PHONE_POLL_MS = 15_000;
// A failure stays longer: a start can fail minutes after its click, when nobody watches the bar.
const NOTICE_MS = 6000, FAILED_MS = 30_000;

/** Whether the page's server has a paper daemon (`--paper`, which puts a token in the page): "absent"
 *  without one; with one, "present" while it answers and "offline" while it does not, asked again every
 *  few seconds, so the Runs page says the daemon is down instead of vanishing. */
export const paperService = atom<"checking" | "absent" | "offline" | "present">("checking");
export const paperRuns = atom<Listing | null>(null);
/** Versions being started from this page, each with when its start was asked (ms): the server answers only
 *  once it has the runtime image (a pull when the host lacks it) and the run's containers are up. */
export const starting = atom<ReadonlyMap<string, number>>(new Map());
export const stopping = atom<ReadonlySet<number>>(new Set());
export const resuming = atom<ReadonlySet<number>>(new Set());
export const deleting = atom<ReadonlySet<number>>(new Set());
/** "Run paper with…" open for a version; "Stop paper?" or "Delete run?" open for a run. */
export const startDialog = atom<string | null>(null);
export const stopDialog = atom<PaperRun | null>(null);
export const deleteDialog = atom<PaperRun | null>(null);
export const notice = atom<{ text: string; failed: boolean; n: number } | null>(null);
/** The last refused start, stop, resume or delete, shown over the page until it is closed or another
 *  replaces it: a refusal can come seconds after its click, and the phone has no status bar. */
export const refusal = atom<{ title: string; code: string; message: string } | null>(null);

export const usePaperService = () => useAtom(paperService);
/** The page has a paper daemon behind it: its server has a daemon, answering or not. */
export const usePaperPanel = () => { const service = useAtom(paperService); return service === "present" || service === "offline"; };
export const usePaperRuns = () => useAtom(paperRuns);

let shown = 0;
function say(text: string, failed = false): void {
  const n = ++shown;
  notice.set({ text, failed, n });
  window.setTimeout(() => { if (notice.get()?.n === n) notice.set(null); }, failed ? FAILED_MS : NOTICE_MS);
}
function refuse(title: string, error: unknown): void {
  if (error instanceof ApiError && error.code === "AUTH_REQUIRED") sessionRequired.set(true);
  refusal.set(error instanceof ApiError ? { title, code: error.code, message: error.message } : { title, code: "PAPER_FAILED", message: String(error) });
}
const add = <T,>(set: ReadonlySet<T>, item: T) => new Set([...set, item]);
const drop = <T,>(set: ReadonlySet<T>, item: T) => new Set([...set].filter((x) => x !== item));

// Polls the daemon goes unanswered before the page calls it offline: one may be a blip.
const MISSES = 2;
let missed = 0;

export async function refreshRuns(): Promise<void> {
  try {
    const listing = await paperApi<Listing>("/runs");
    // A response can be lost while the server succeeds. Polling acknowledges that
    // original operation too, so a later explicit Run again is a new user command.
    for (const run of listing.runs) if (run.op_id) confirmStart(run.op_id);
    missed = 0;
    paperRuns.set(shared(paperRuns.get(), listing));
    pickWanted(listing.runs);
  } catch (error) {
    if (error instanceof ApiError && error.code === "AUTH_REQUIRED") sessionRequired.set(true);
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
  } catch (error) {
    if (error instanceof ApiError && error.code === "AUTH_REQUIRED") sessionRequired.set(true);
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
  if (paperService.get() === "present") {
    await Promise.all(unconfirmedStarts().map((p) => startPaper(p.candidate, p.scope)));
  }
  whileVisible(() => void poll(), phoneNow() ? PHONE_POLL_MS : POLL_MS);
}

/** The version's run that has not been sealed yet, if any (one per version at a time). */
export const activeRun = (listing: Listing | null, candidate: string) =>
  listing?.runs.find((r) => r.candidate === candidate && ACTIVE.has(r.state));

/** That the server runs as many paper runs as it runs at once (paper/runs.py MAX_RUNNING), as the listing
 *  last said: a start would be refused until one stops. */
export const full = (listing: Listing | null) =>
  listing && listing.running >= listing.limit ? `${listing.running} of ${listing.limit} paper runs are running, the most this server runs at once` : null;

/** Starts a run of `candidate`: with the contracts of its last research replay, or the ones given; the
 *  Runs page then shows it. */
export async function startPaper(candidate: string, scope: Scope = {}): Promise<boolean> {
  if (starting.get().has(candidate)) return false;
  starting.set(new Map([...starting.get(), [candidate, Date.now()]]));
  const pending = pendingStart(candidate, scope);
  try {
    type Started = { paper_id: number; symbols: string[] };
    const prior = await paperApi<{ run: Started | null }>(`/starts?op_id=${encodeURIComponent(pending.op_id)}`);
    // A start this page asked for before may have been accepted already; a new one is not sent while all slots are taken.
    const limit = prior.run ? null : full(paperRuns.get());
    if (limit) throw new ApiError("PAPER_CONCURRENCY_LIMIT", `${limit}. Stop one on the Runs page, then start this again.`);
    const run = prior.run ?? await paperApi<Started>("/runs", { method: "POST", body: { candidate, ...scope, op_id: pending.op_id } });
    confirmStart(pending.op_id);
    const listed = run.symbols.length > 4 ? `${run.symbols.slice(0, 3).join(", ")} and ${run.symbols.length - 3} more` : run.symbols.join(", ");
    say(`Paper start accepted · ${candidate} · ${listed} · checking server status`);
    await refreshRuns();
    const started = paperRuns.get()?.runs.find((r) => r.paper_id === run.paper_id);
    if (started) chooseRun(started);
    showRunsPage();
    return true;
  } catch (error) {
    const uncertain = new Set(["PAPER_UNAVAILABLE", "PAPER_FAILED", "AUTH_REQUIRED", "PAPER_RUN_ACTIVE"]);
    if (error instanceof ApiError && !uncertain.has(error.code)) confirmStart(pending.op_id);
    if (error instanceof ApiError && error.code === "NO_LAST_REPLAY") startDialog.set(candidate);
    else refuse(`Paper run not started · ${candidate}`, error);
    return false;
  } finally {
    starting.set(new Map([...starting.get()].filter(([c]) => c !== candidate)));
  }
}

/** Stops and seals; open positions remain an at-stop observation, not a closing fill. */
export async function stopPaper(run: PaperRun): Promise<void> {
  stopping.set(add(stopping.get(), run.paper_id));
  try {
    await paperApi(`/runs/${run.paper_id}/stop`, { method: "POST", body: {} });
    say(`Paper stopping · ${run.candidate ?? run.paper_id} · its orders are cancelled, then it is sealed`);
    await refreshRuns();
  } catch (error) {
    refuse(`Paper run not stopped · ${run.candidate ?? run.paper_id}`, error);
  } finally {
    stopping.set(drop(stopping.get(), run.paper_id));
  }
}

/** Continue this exact unsealed run; the server validates its native recovery originals. */
export async function resumePaper(run: PaperRun): Promise<void> {
  if (resuming.get().has(run.paper_id)) return;
  resuming.set(add(resuming.get(), run.paper_id));
  try {
    await paperApi(`/runs/${run.paper_id}/resume`, { method: "POST", body: {} });
    say(`Resume requested · run ${run.paper_id} · waiting for server status`);
    await refreshRuns();
  } catch (error) {
    refuse(`Paper run not resumed · run ${run.paper_id}`, error);
  } finally {
    resuming.set(drop(resuming.get(), run.paper_id));
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
    await refreshRuns();
  } catch (error) {
    refuse(`Paper run not deleted · ${run.candidate ?? run.paper_id}`, error);
  } finally {
    deleting.set(drop(deleting.get(), run.paper_id));
  }
}

/** The contracts of a version's last research replay, or null when it has none. */
export async function lastSymbols(candidate: string): Promise<string[] | null> {
  const found = await paperApi<{ last: { symbols: string[] } | null }>(`/defaults?candidate=${encodeURIComponent(candidate)}`);
  return found.last?.symbols ?? null;
}
