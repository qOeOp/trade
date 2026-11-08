import type { LiveHomeDto, LiveRunDto, LiveSourceDto } from "../lib/liveTradingDto";
import type { LiveAccountCheck, LiveFact, LiveRun, LiveTradingView } from "./liveTrading";

const yesNo = (value: boolean | null | undefined) => value == null ? null : value ? "Yes" : "No";
const fact = (label: string, value: string | null): LiveFact => ({ label, value });
// The host states of an ended run (live/runs.py ENDED; engine/README.md): no runner is left to stop. An
// unresolved run is not one, since its recovery begins with a stop.
const ENDED = new Set(["clean_stopped", "reconciled_flat", "venue_flat", "not_armed", "preflight_complete", "preflight_failed"]);

function accountCheck(run: LiveRunDto): LiveAccountCheck | null {
  if (run.host.mode !== "preflight") return null;
  const readNs = run.evidence.find((item) => item.source === "host")?.read_ns;
  const date = new Date(readNs ? Number(readNs) / 1_000_000 : NaN);
  return {
    state: run.host.state === "preflight_complete" && run.host.exit_code === 0 ? "passed"
      : run.host.state === "preflight_failed" ? "failed" : run.host.state === "running" ? "running" : "unknown",
    readAt: Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

/** The run's budget and its minute results as the account the chart draws (budget plus result), by time in seconds. */
function equityOf(run: LiveRunDto): LiveRun["equity"] {
  const budget = Number(run.config.budget_usdt);
  if (!run.minute_results || !(budget > 0)) return null;
  return { budget, minutes: run.minute_results.map(([ns, result]) => [Math.floor(Number(ns) / 1e9), result === null ? null : budget + Number(result)] as const) };
}

/** Preserve source distinctions and unknowns; no fill aggregation or account-state inference. */
export function liveRunPresentation(run: LiveRunDto, sources: readonly LiveSourceDto[], review?: LiveRunDto): LiveRun {
  const source = sources.find((item) => item.source_sha256 === run.source.source_sha256 && item.entry_class === run.source.entry_class);
  const origin = run.origin_candidate, account = run.account;
  return {
    id: run.run_id, candidate: origin.strategy_id ? `${origin.strategy_id}${origin.revision === null ? "" : `@${origin.revision}`}` : "Origin candidate unknown",
    purpose: source?.purpose ?? "unknown", sourceHash: run.source.source_sha256, entryClass: run.source.entry_class,
    runtimeDigest: run.runtime.digest, symbols: run.symbols, accountCheck: accountCheck(run),
    observedNs: { account: account?.observed_ns ?? null, terminal: run.terminal?.observed_ns ?? null }, running: run.host.state === "running", ended: ENDED.has(run.host.state ?? ""),
    config: [fact("Budget (USDT)", run.config.budget_usdt), fact("Entry limit (USDT)", run.config.max_notional_per_order),
      fact("Loss threshold (USDT)", run.config.max_loss_usdt), fact("Duration (seconds)", run.config.duration_seconds)],
    host: [fact("State", run.host.state), fact("Mode", run.host.mode), fact("Account custody held", yesNo(run.host.account_owned)), fact("Exit code", run.host.exit_code === null ? null : String(run.host.exit_code))],
    execution: [fact("Native terminal", run.terminal?.event ?? null), fact("Source failed", yesNo(run.terminal?.source_failed)), fact("Terminal observed (ns)", run.terminal?.observed_ns ?? null)],
    account: account ? [fact("Observed (ns)", account.observed_ns), fact("Trading enabled", yesNo(account.can_trade)), fact("Hedge mode", yesNo(account.hedge_mode)),
      fact("Multi-asset mode", yesNo(account.multi_assets)), fact("USDT wallet", account.usdt_wallet), fact("USDT available", account.usdt_available),
      fact("Recorded venue-flat check", account.venue_flat === true ? "Flat at this observation" : null)] : [],
    ending: [fact("Stop requested", yesNo(run.stop_requested)), fact("Custody released", yesNo(run.custody.released)), fact("Release reason", run.custody.release_reason), fact("Archived", yesNo(run.custody.archived))],
    evidence: run.evidence.map((item) => ({ source: item.source, cursor: item.cursor, observedNs: item.observed_ns, readNs: item.read_ns, complete: item.complete, state: item.state })),
    orders: run.orders, positions: run.positions, equity: equityOf(run), review: review?.review ?? run.review ?? null, reviewError: review?.review_error?.code ?? run.review_error?.code ?? null,
  };
}

export function liveHomePresentation(home: LiveHomeDto, reviews: ReadonlyMap<string, LiveRunDto>): LiveTradingView {
  const unavailable = home.write_reason === "LIVE_RELEASE_UNAVAILABLE"
    ? "The Live service cannot currently confirm that it is ready to accept new actions. Wait, then refresh observations. (LIVE_RELEASE_UNAVAILABLE)"
    : home.write_reason ?? "Live actions are unavailable in this deployment.";
  return {
    availability: "ready", preview: false, notice: home.write_enabled ? null : unavailable,
    credentials: home.credentials.map((item) => ({ ref: item.credential_ref, savedAt: item.observed_ns, selected: item.selected, available: item.available, removed: item.removed, runIds: item.referenced_runs })),
    sources: home.sources.map((item) => ({ id: item.source_id, candidate: item.origin_candidate, sourceHash: item.source_sha256, entryClass: item.entry_class, purpose: item.purpose,
      availability: item.available ? "Available" : `Unavailable${item.code ? ` · ${item.code}` : ""}` })),
    planFields: [
      { id: "budget_usdt", label: "Budget (USDT)", value: home.defaults.budget_usdt },
      { id: "max_notional_per_order", label: "Entry limit (USDT)", value: home.defaults.max_notional_per_order },
      { id: "max_loss_usdt", label: "Loss threshold (USDT)", value: home.defaults.max_loss_usdt },
      { id: "duration_seconds", label: "Duration (seconds)", value: String(home.defaults.duration_seconds) },
    ],
    runs: home.runs.map((run) => liveRunPresentation(run, home.sources, reviews.get(run.run_id))), request: null,
  };
}
