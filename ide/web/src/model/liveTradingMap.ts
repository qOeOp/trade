import type { LiveHomeDto, LiveRunDto, LiveSourceDto } from "../lib/liveTradingDto";
import type { LiveAccountCheck, LiveFact, LiveRun, LiveTradingView } from "./liveTrading";

const yesNo = (value: boolean | null | undefined) => value == null ? null : value ? "Yes" : "No";
const fact = (label: string, value: string | null, format?: "nanoseconds"): LiveFact => ({ label, value, ...format ? { format } : {} });
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

/** The equity the run armed with and its minute results as the account the chart draws (that plus the result), by
 *  time in seconds. */
function equityOf(run: LiveRunDto): LiveRun["equity"] {
  const budget = Number(run.brake?.start ?? NaN);
  if (!run.minute_results || !(budget > 0)) return null;
  return { budget, minutes: run.minute_results.map(([ns, result]) => [Math.floor(Number(ns) / 1e9), result === null ? null : budget + Number(result)] as const) };
}

/** What a start that found a position or open orders it inherited means for the user (engine.live held; the
 *  user's decision of 2026-11-13, docs/plans/live-continuous-step4-resume-20261113.zh.md). Telegram says the same
 *  (live/notify.py HELD_TEXT). */
export const HELD_NOTICE = "This run started again and found a position or open orders it inherited. That position is now "
  + "protected only by its stop at Binance: the strategy no longer manages its exits and opens nothing. The run trades "
  + "again by itself once the account is flat; close the position at Binance if you want to end it sooner.";

/** The notice while the run's latest start holds: no later start, and the account not yet seen flat. */
function heldNotice(run: LiveRunDto): string | null {
  const latest = [...run.restarts ?? []].reverse().find((row) => row.event === "resuming" || row.event === "venue_flat_while_held");
  return latest?.event === "resuming" && latest.held === true && !ENDED.has(run.host.state ?? "") ? HELD_NOTICE : null;
}

/** Preserve source distinctions and unknowns; no fill aggregation or account-state inference. */
export function liveRunPresentation(run: LiveRunDto, sources: readonly LiveSourceDto[], review?: LiveRunDto): LiveRun {
  const source = sources.find((item) => item.source_sha256 === run.source.source_sha256 && item.entry_class === run.source.entry_class);
  const candidate = run.candidate, account = run.account;
  return {
    id: run.run_id, candidate: candidate.strategy_id ? `${candidate.strategy_id}${candidate.revision === null ? "" : `@${candidate.revision}`}` : "Candidate unknown",
    purpose: source?.purpose ?? "unknown", sourceHash: run.source.source_sha256, entryClass: run.source.entry_class,
    runtimeDigest: run.runtime.digest, symbols: run.symbols, accountCheck: accountCheck(run),
    observedNs: { account: account?.observed_ns ?? null, terminal: run.terminal?.observed_ns ?? null }, running: run.host.state === "running", ended: ENDED.has(run.host.state ?? ""),
    config: [fact("Drawdown brake", run.config.drawdown_brake), fact("Equity at start (USDT)", run.brake?.start ?? null),
      fact("Highest equity (USDT)", run.brake?.peak ?? null), fact("Duration (seconds)", run.config.duration_seconds),
      fact("Leverage", run.config.leverage)],
    host: [fact("State", run.host.state), fact("Mode", run.host.mode), fact("Account custody held", yesNo(run.host.account_owned)), fact("Exit code", run.host.exit_code === null ? null : String(run.host.exit_code))],
    execution: [fact("Native terminal", run.terminal?.event ?? null), fact("Source failed", yesNo(run.terminal?.source_failed)), fact("Terminal observed", run.terminal?.observed_ns ?? null, "nanoseconds")],
    account: account ? [fact("Observed", account.observed_ns, "nanoseconds"), fact("Trading enabled", yesNo(account.can_trade)), fact("Hedge mode", yesNo(account.hedge_mode)),
      fact("Multi-asset mode", yesNo(account.multi_assets)), fact("USDT wallet", account.usdt_wallet), fact("USDT available", account.usdt_available),
      fact("Recorded venue-flat check", account.venue_flat === true ? "Flat at this observation" : null)] : [],
    ending: [fact("Stop requested", yesNo(run.stop_requested)), fact("Custody released", yesNo(run.custody.released)), fact("Release reason", run.custody.release_reason), fact("Archived", yesNo(run.custody.archived))],
    evidence: run.evidence.map((item) => ({ source: item.source, cursor: item.cursor, observedNs: item.observed_ns, readNs: item.read_ns, complete: item.complete, state: item.state })),
    venue: account ? { canTrade: account.can_trade, hedgeMode: account.hedge_mode, multiAssets: account.multi_assets,
      wallet: account.usdt_wallet, available: account.usdt_available } : null,
    hostState: run.host.state, accountOwned: run.host.account_owned, heldNotice: heldNotice(run),
    orders: run.orders, positions: run.positions, equity: equityOf(run), review: review?.review ?? run.review ?? null, reviewError: review?.review_error?.code ?? run.review_error?.code ?? null,
  };
}

export function liveHomePresentation(home: LiveHomeDto, reviews: ReadonlyMap<string, LiveRunDto>): LiveTradingView {
  const unavailable = home.write_reason === "LIVE_RELEASE_UNAVAILABLE"
    ? "The Live service cannot currently confirm that it is ready to accept new actions. Wait, then refresh observations. (LIVE_RELEASE_UNAVAILABLE)"
    : home.write_reason ?? "Live actions are unavailable in this deployment.";
  return {
    availability: "ready", preview: false, notice: home.write_enabled ? null : unavailable,
    reason: home.write_enabled ? null : home.write_reason ?? "LIVE_WRITE_DISABLED", symbols: home.symbols ?? null,
    credentials: home.credentials.map((item) => ({ ref: item.credential_ref, savedAt: item.observed_ns, selected: item.selected, available: item.available, removed: item.removed, runIds: item.referenced_runs })),
    sources: home.sources.map((item) => ({ id: item.source_id, candidate: item.candidate, sourceHash: item.source_sha256, entryClass: item.entry_class, purpose: item.purpose,
      ...item.evidence ? { evidence: { state: item.evidence.state, tolerance: item.evidence.tolerance,
        replays: item.evidence.replays.map((row) => ({ trialId: row.trial_id, balance: row.starting_balance_usdt })) } } : {} })),
    planFields: [
      // Shown and typed as a percentage; the server takes a fraction (state/liveTrading.ts).
      { id: "drawdown_brake", label: "Drawdown brake", value: String(Math.round(Number(home.defaults.drawdown_brake) * 1e6) / 1e4) },
      { id: "duration_seconds", label: "Duration (seconds)", value: home.defaults.duration_seconds === null ? "" : String(home.defaults.duration_seconds) },
      { id: "leverage", label: "Leverage", value: home.defaults.leverage },
    ],
    runs: home.runs.map((run) => liveRunPresentation(run, home.sources, reviews.get(run.run_id))), request: null,
    notify: home.notify ? { configured: home.notify.configured, lastSentNs: home.notify.last_sent_ns,
      lastError: home.notify.last_error ? { code: home.notify.last_error.code, atNs: home.notify.last_error.at_ns } : null, dropped: home.notify.dropped } : null,
  };
}
