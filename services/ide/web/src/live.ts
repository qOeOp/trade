// A served page (ide.py serve): the view comes from /api/view and follows /api/events, so the page
// changes in place when the ledger does. A page rendered to a file carries its view and never asks.
import type { View } from "./model/types";
import { update } from "./state/update";

type Failure = { code?: string; message?: string; missing?: string[] };
/** A way out of a failure: a link with a label. */
export type Choice = { label: string; href: string };
type State = { state: "fetching" | "pulling" | "queued" | "computing" | "ready" | "error"; ledger_commit?: string | null; error?: Failure };

const WAITING: Record<string, string> = {
  fetching: "Reading the ledger…",
  pulling: "Pulling the market data…",
  queued: "Queued to be drawn…",
  computing: "Drawing the research graph (comparisons take a few seconds)…",
};
const waiting = (state: string) => WAITING[state] ?? "Reading the ledger…";

/** The open lines a LINE_AMBIGUOUS refusal names, each as this page with `line` set. */
function lines(error?: Failure): Choice[] | undefined {
  if (error?.code !== "LINE_AMBIGUOUS" || !Array.isArray(error.missing)) return undefined;
  return error.missing.map((line) => {
    const url = new URL(window.location.href);
    url.searchParams.set("line", line);
    return { label: line, href: `${url.pathname}${url.search}` };
  });
}

/** Calls `show` with every new view and `status` with a line to show while there is none yet (`busy`
 *  while one is on its way, not when it failed, then with the lines to choose from when several are
 *  open); once one is shown, the way to a newer one (or a failed refresh) goes to the `update` atom instead. */
export function follow(show: (view: View) => void, status: (text: string, busy?: boolean, choices?: Choice[]) => void): void {
  const query = window.location.search;
  let shown: string | null = null;
  let latest: State | null = null;  // the last event, applied again once a view is shown
  let loading = false;
  const failed = (error?: Failure) => {
    const choices = lines(error);
    if (choices) status("Several research lines are open. Choose one to draw:", false, choices);
    else status(`The graph could not be drawn: ${error?.code ?? "ERROR"}: ${error?.message ?? ""}`);
  };

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(`/api/view${query}`, { cache: "no-store" });
      const body = await response.json();
      if (response.status === 200) {
        shown = (body as View).scope?.ledger_commit ?? null;
        show(body as View);
        if (latest) window.setTimeout(apply, 0, latest);  // after `loading` is cleared
        else update.set(null);
      } else if (shown === null) {
        if (response.status === 202) status(waiting((body as State).state), true);
        else failed(body as Failure);
      }
    } catch (error) {
      if (shown === null) status(`The trade IDE service did not answer: ${String(error)}`);
    } finally {
      loading = false;
    }
  }

  function apply(message: State): void {
    const commit = message.ledger_commit ?? null;
    if (message.state === "ready") {
      if (commit !== shown) void load();
      else update.set(null);
    }
    // A copy that no longer follows its public copy replaces the page; other failures keep the last view.
    else if (message.state === "error" && (shown === null || message.error?.code === "REMOTE_REWRITTEN")) {
      shown = null;
      update.set(null);
      failed(message.error);
    }
    else if (shown === null) status(waiting(message.state), true);
    else if (message.state === "error") update.set({ stage: "failed", commit, shown, error: message.error });
    else if (message.state !== "fetching") update.set({ stage: message.state, commit, shown });
  }

  const events = new EventSource(`/api/events${query}`);
  events.onmessage = (event) => apply(latest = JSON.parse(event.data) as State);
  void load();
}
