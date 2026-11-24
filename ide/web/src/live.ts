// The served page (ide.py serve): the view comes from /api/view and follows /api/events, so the page
// changes in place when the ledger does.
import type { SummaryWidget, View } from "./model/types";
import { forgetKept, keep, readKept } from "./lib/storage";
import { update, type Choice } from "./state/update";
import { lineHref } from "./lib/lines";
import { pageFetch, SIGN_IN, signedOut } from "./lib/transport";
import { readResearchLines, researchLines } from "./state/researchLines";

type Failure = { code?: string; message?: string; missing?: string[]; next_actions?: string[] };
type State = { state: "fetching" | "checking" | "queued" | "computing" | "ready" | "unchanged" | "error"; trial_counts?: SummaryWidget["trial_counts"]; ledger_commit?: string | null; available_commit?: string; error?: Failure };

const WAITING: Record<string, string> = {
  fetching: "Reading the ledger…",
  queued: "Queued to be drawn…",
  computing: "Drawing the research graph…",
};
const waiting = (state: string) => WAITING[state] ?? "Reading the ledger…";
const NO_LINE_CHOSEN = ["LINE_AMBIGUOUS", "RESEARCH_LINE_REQUIRED"];
const VIEW_FORMAT = "research-graph-view";
const KEPT_VIEWS = 32;
const RECONNECT_MS = 5000;

/** The open lines a LINE_AMBIGUOUS refusal names, each as this page with `line` set. */
function lines(error?: Failure): Choice[] | undefined {
  if (error?.code !== "LINE_AMBIGUOUS" || !Array.isArray(error.missing)) return undefined;
  return error.missing.map((line) => ({ label: line, href: lineHref(window.location.href, line) }));
}

/** Calls `show` with every new view (null: the one on the page is dropped) and `status` with a line to show while there is none yet (`busy`
 *  while one is on its way, not when it failed, then with what the product says to do next, or the lines to
 *  choose from when several are open, which stay while the ledger moves: a new head draws nothing until one
 *  is chosen); once one is
 *  shown, the way to a newer one (or a failed refresh) goes to the `update` atom instead. */
export function follow(show: (view: View | null) => void, status: (text: string, busy?: boolean, choices?: Choice[], next?: string[]) => void): void {
  const query = window.location.search;
  const asked = new URLSearchParams(query);
  const pinned = asked.get("at");
  // Only a page following one named line's head has a graph to keep: any other answers a different question.
  const line = pinned === null && asked.get("since") === null ? asked.get("line") : null;
  void readResearchLines(pinned);
  let shown: string | null = null;
  let latest: State | null = null;  // the last event, applied again once a view is shown
  let events: EventSource | null = null;  // null while the page is hidden or the stream closed
  let loading = false;
  let loadedFor: string | null = null;  // which availability notification the last HTTP read consumed
  let choosing: string | null = null;  // the refusal whose choices are on the page
  let held: View | null = null;  // the graph on the page of a line that has one to keep
  let have = "";  // tells the service which graph that is
  let unconfirmed = false;  // the browser's own graph is on the page and the service has said nothing of it yet
  const hold = (view: View) => {
    held = line && !view.scope?.market_unread ? view : null;  // a graph drawn without the market is drawn again
    have = held ? `&have=${view.scope?.ledger_commit}&build=${encodeURIComponent(view.scope?.build ?? "")}` : "";
  };
  const wait = (state: string) => { if (choosing === null) status(waiting(state), true); };
  /** When the ledger has no such line (its history replaced), the graph on the page is another ledger's: it is
   *  dropped, kept copy included, and the page goes on as one that never had it. */
  const forget = (error?: Failure): boolean => {
    if (line === null || shown === null || error?.code !== "LINE_UNKNOWN") return false;
    shown = held = null;
    have = "";
    unconfirmed = false;
    void forgetKept("view", line);
    show(null);
    update.set(null);
    return true;
  };
  const failed = (error?: Failure) => {
    const refusal = NO_LINE_CHOSEN.includes(error?.code ?? "") ? error!.code! : null;
    if (refusal !== null && refusal === choosing) return;
    choosing = refusal;
    const choices = lines(error);
    if (choices) status("Several research lines are open. Choose one to draw:", false, choices);
    else if (refusal === "RESEARCH_LINE_REQUIRED") status("No research line is open. To start one, open your Agent at the repository root and say “start research”.");
    else status(`The graph could not be drawn. ${error?.code ?? "ERROR"}: ${error?.message ?? ""}`, false, undefined, error?.next_actions);
    // With no chosen graph (including an all-closed ledger), history must still be reachable.
    if (refusal !== null) {
      void readResearchLines(pinned ?? latest?.ledger_commit ?? null)
        .then(() => {
          const entries = researchLines.get().lines;
          if (shown === null && entries.length) status("Choose a research line to draw:", false,
            [...entries].reverse().map((line) => ({
              label: `${line.name} · ${line.closed ? "Closed" : "Open"}`,
              href: lineHref(window.location.href, line.name),
            })));
        }).catch(() => { /* Keep the product's refusal and any open-line choices. */ });
    }
  };

  async function load(available: string | null = null): Promise<void> {
    if (loading) return;
    loading = true;
    let received = false;
    try {
      const response = await pageFetch(`/api/view${query}${have}`, { cache: "no-store" });
      if (response.status === 401) {  // the sign-in expired: the session notice says so, the last view stays
        if (shown === null) status(SIGN_IN);
        return;
      }
      const body = await response.json();
      if (response.status === 200) {
        shown = (body as View).scope?.ledger_commit ?? null;
        loadedFor = available ?? shown;
        received = true;
        unconfirmed = false;
        hold(body as View);
        show(body as View);
        if (line) void keep("view", line, body, KEPT_VIEWS);
        if (!latest && events) update.set(null);  // with the stream closed, its first event says whether this is current
      } else if (shown !== null && response.status !== 202 && !forget(body as Failure)) {
        update.set({ stage: "failed", commit: null, shown, error: body as Failure });
      } else if (shown === null) {
        if (response.status === 202) {
          loadedFor = available;
          received = true;
          wait((body as State).state);
        }
        else failed(body as Failure);
      }
    } catch (error) {
      choosing = null;  // the line below replaces any choices, so the next refusal shows them again
      if (shown === null) status(`The trade IDE service did not answer: ${String(error)}`);
      else update.set({ stage: "failed", commit: null, shown, error: { code: "UNAVAILABLE", message: `The trade IDE service did not answer: ${String(error)}` } });
    } finally {
      loading = false;
      // A completed graph may have been announced while the initial 202 read was still in flight.
      if (received) window.setTimeout(() => { if (latest) apply(latest); }, 0);
    }
  }

  function apply(message: State): void {
    const commit = message.ledger_commit ?? null;
    const available = message.available_commit ?? (message.state === "ready" ? commit : null);
    if (available && (available !== shown || unconfirmed) && available !== loadedFor) void load(available);
    if (message.state === "unchanged") {
      // The service checked: this commit gives the graph on the page.
      unconfirmed = false;
      if (held !== null && commit !== null && commit !== shown) {
        const scope = held.scope!;
        // The counts are the one thing on it that moves with the ledger.
        const widgets = held.widgets.map((w) => (w.type === "summary" && "trial_counts" in message ? { ...w, trial_counts: message.trial_counts } : w));
        const stamped = { ...held, widgets, scope: { ...scope, ledger_commit: commit, drawn_commit: scope.drawn_commit ?? scope.ledger_commit } };
        shown = commit;
        hold(stamped);
        show(stamped);
        if (line) void keep("view", line, stamped, KEPT_VIEWS);
      }
      update.set(null);
    }
    else if (message.state === "ready") {
      if (commit === shown) update.set(null);
    }
    // A failure before any view replaces the waiting line; later failures keep the last view.
    else if (message.state === "error" && (shown === null || forget(message.error))) {
      update.set(null);
      failed(message.error);
    }
    else if (shown === null) wait(message.state);
    else if (message.state === "error") update.set({ stage: "failed", commit, shown, error: message.error });
    else if (message.state !== "fetching") update.set({ stage: message.state, commit, shown });
  }

  // An open stream is what keeps the server reading the head and drawing for this page, so a hidden page holds
  // none; shown again it reads what it missed, as when it first opened.
  const listen = () => {
    const opened = events = new EventSource(`/api/events${query}${have}`);
    // The browser reconnects a dropped stream itself, but closes one answered with anything but 200 (a proxy's 502
    // while the service restarts) for good.
    events.onerror = () => {
      if (events !== opened || opened.readyState !== EventSource.CLOSED) return;
      events = latest = null;  // what it last said is of the service before it closed
      if (shown !== null && !signedOut()) update.set({ stage: "failed", commit: null, shown, error: { code: "UNAVAILABLE", message: "The trade IDE service did not answer: the event stream closed." } });
      window.setTimeout(() => void reopen(), RECONNECT_MS);
    };
    events.onmessage = (event) => {
      latest = JSON.parse(event.data) as State;
      if (!pinned && latest.ledger_commit) void readResearchLines(latest.ledger_commit);
      apply(latest);
    };
  };
  const follows = () => !document.hidden && !events && !signedOut();
  // The read comes first: it finds an expired sign-in, and the stream's first event settles whatever it left.
  const reopen = async () => {
    if (!follows()) return;
    await load();
    if (follows()) listen();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      events?.close();
      events = null;
    } else if (follows()) {
      listen();
      void load();
    }
  });

  /** Show the graph this browser kept for the line, if any, then ask the service as a page without one would. */
  async function start(): Promise<void> {
    const found = line ? await readKept<View>("view", line) : null;
    if (found?.format === VIEW_FORMAT && found.scope?.ledger_commit) {
      shown = found.scope.ledger_commit;
      unconfirmed = true;
      hold(found);
      show(found);
    }
    if (!document.hidden && !events) listen();
    void load();
  }
  void start();
}
