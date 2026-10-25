// A served page (graph.py serve): the view comes from /api/view and follows /api/events, so the page
// changes in place when the ledger does. A page rendered to a file carries its view and never asks.
import type { View } from "./model/types";

type Failure = { code?: string; message?: string };
type State = { state: "fetching" | "queued" | "computing" | "ready" | "error"; ledger_commit?: string | null; error?: Failure };

const WAITING: Record<string, string> = {
  fetching: "Reading the ledger…",
  queued: "Queued to be drawn…",
  computing: "Drawing the research graph (comparisons take a few seconds)…",
};
const waiting = (state: string) => WAITING[state] ?? "Reading the ledger…";

/** Calls `show` with every new view and `status` with a line to show while there is none yet. */
export function follow(show: (view: View) => void, status: (text: string) => void): void {
  const query = window.location.search;
  let shown: string | null = null;
  let loading = false;
  const failed = (error?: Failure) => `The graph could not be drawn: ${error?.code ?? "ERROR"}: ${error?.message ?? ""}`;

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(`/api/view${query}`, { cache: "no-store" });
      const body = await response.json();
      if (response.status === 200) {
        shown = (body as View).scope?.ledger_commit ?? null;
        show(body as View);
      } else if (shown === null) {
        status(response.status === 202 ? waiting((body as State).state) : failed(body as Failure));
      }
    } catch (error) {
      if (shown === null) status(`The graph service did not answer: ${String(error)}`);
    } finally {
      loading = false;
    }
  }

  const events = new EventSource(`/api/events${query}`);
  events.onmessage = (event) => {
    const message = JSON.parse(event.data) as State;
    if (message.state === "ready" && message.ledger_commit !== shown) void load();
    // A copy that no longer follows its public copy replaces the page; other failures keep the last view.
    else if (message.state === "error" && (shown === null || message.error?.code === "REMOTE_REWRITTEN")) {
      shown = null;
      status(failed(message.error));
    }
    else if (shown === null && message.state !== "ready") status(waiting(message.state));
  };
  void load();
}
