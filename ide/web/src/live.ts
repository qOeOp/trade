// A served page (ide.py serve): the view comes from /api/view and follows /api/events, so the page
// changes in place when the ledger does. A page rendered to a file carries its view and never asks.
import type { View } from "./model/types";
import { update } from "./state/update";
import { lineHref } from "./lib/lines";
import { readResearchLines, researchLines } from "./state/researchLines";

type Failure = { code?: string; message?: string; missing?: string[] };
/** A way out of a failure: a link with a label. */
export type Choice = { label: string; href: string };
type State = { state: "fetching" | "queued" | "computing" | "ready" | "error"; ledger_commit?: string | null; available_commit?: string; error?: Failure };

const WAITING: Record<string, string> = {
  fetching: "Reading the ledger…",
  queued: "Queued to be drawn…",
  computing: "Drawing the research graph (comparisons take a few seconds)…",
};
const waiting = (state: string) => WAITING[state] ?? "Reading the ledger…";

/** The open lines a LINE_AMBIGUOUS refusal names, each as this page with `line` set. */
function lines(error?: Failure): Choice[] | undefined {
  if (error?.code !== "LINE_AMBIGUOUS" || !Array.isArray(error.missing)) return undefined;
  return error.missing.map((line) => ({ label: line, href: lineHref(window.location.href, line) }));
}

/** Calls `show` with every new view and `status` with a line to show while there is none yet (`busy`
 *  while one is on its way, not when it failed, then with the lines to choose from when several are
 *  open); once one is shown, the way to a newer one (or a failed refresh) goes to the `update` atom instead. */
export function follow(show: (view: View) => void, status: (text: string, busy?: boolean, choices?: Choice[]) => void): void {
  const query = window.location.search;
  const pinned = new URLSearchParams(query).get("at");
  void readResearchLines(pinned);
  let shown: string | null = null;
  let latest: State | null = null;  // the last event, applied again once a view is shown
  let loading = false;
  let loadedFor: string | null = null;  // which availability notification the last HTTP read consumed
  const failed = (error?: Failure) => {
    const choices = lines(error);
    if (choices) status("Several research lines are open. Choose one to draw:", false, choices);
    else status(`The graph could not be drawn: ${error?.code ?? "ERROR"}: ${error?.message ?? ""}`);
    // With no chosen graph (including an all-closed ledger), history must still be reachable.
    if (error?.code === "LINE_AMBIGUOUS" || error?.code === "RESEARCH_LINE_REQUIRED") {
      void readResearchLines(pinned ?? latest?.ledger_commit ?? null)
        .then(() => {
          const entries = researchLines.get().lines;
          if (shown === null && entries.length) status("Choose a research line to draw:", false,
            [...entries].reverse().map((line) => ({
              label: `${line.bundle.replace(/^research-line-/, "")} · ${line.closed ? "Closed" : "Open"}`,
              href: lineHref(window.location.href, line.bundle),
            })));
        }).catch(() => { /* Keep the product's refusal and any open-line choices. */ });
    }
  };

  async function load(available: string | null = null): Promise<void> {
    if (loading) return;
    loading = true;
    let received = false;
    try {
      const response = await fetch(`/api/view${query}`, { cache: "no-store" });
      const body = await response.json();
      if (response.status === 200) {
        shown = (body as View).scope?.ledger_commit ?? null;
        loadedFor = available ?? shown;
        received = true;
        show(body as View);
        if (!latest) update.set(null);
      } else if (shown === null) {
        if (response.status === 202) {
          loadedFor = available;
          received = true;
          status(waiting((body as State).state), true);
        }
        else failed(body as Failure);
      }
    } catch (error) {
      if (shown === null) status(`The trade IDE service did not answer: ${String(error)}`);
    } finally {
      loading = false;
      // A completed graph may have been announced while the initial 202 read was still in flight.
      if (received) window.setTimeout(() => { if (latest) apply(latest); }, 0);
    }
  }

  function apply(message: State): void {
    const commit = message.ledger_commit ?? null;
    const available = message.available_commit ?? (message.state === "ready" ? commit : null);
    if (available && available !== shown && available !== loadedFor) void load(available);
    if (message.state === "ready") {
      if (commit === shown) update.set(null);
    }
    // A failure before any view replaces the waiting line; later failures keep the last view.
    else if (message.state === "error" && shown === null) {
      update.set(null);
      failed(message.error);
    }
    else if (shown === null) status(waiting(message.state), true);
    else if (message.state === "error") update.set({ stage: "failed", commit, shown, error: message.error });
    else if (message.state !== "fetching") update.set({ stage: message.state, commit, shown });
  }

  const events = new EventSource(`/api/events${query}`);
  events.onmessage = (event) => {
    latest = JSON.parse(event.data) as State;
    if (!pinned && latest.ledger_commit) void readResearchLines(latest.ledger_commit);
    apply(latest);
  };
  void load();
}
