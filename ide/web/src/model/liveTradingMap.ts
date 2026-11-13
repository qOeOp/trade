import type { LiveHomeDto, LiveRunDto, LiveSourceDto } from "../lib/liveTradingDto";
import { refusalText } from "./liveLaunchText";
import { build, lastSwitch, runtimeOf } from "./liveRuntimeMap";
import type { LiveAccountCheck, LiveFact, LiveRun, LiveTradingView } from "./liveTrading";

const yesNo = (value: boolean | null | undefined) => value == null ? null : value ? "Yes" : "No";
const fact = (label: string, value: string | null, format?: LiveFact["format"]): LiveFact => ({ label, value, ...format ? { format } : {} });
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

// Why the entry gate is closed (engine/live_connection.py; live/views.py GATE_REASONS), as Telegram words them.
const GATE_TEXT: Record<string, string> = {
  disconnected: "connection lost", unverified: "checking the account with Binance", unknown_orders: "unknown orders at Binance",
  bars_missing: "a bar is missing", account_mode: "account modes changed", foreign: "another symbol at Binance",
  contract_status: "contract not trading",
};
// A process of the run ends at these, and the next one starts closed until it warms up (engine.live).
const PROCESS_ENDS = new Set(["interrupted", "rewarming", "resuming"]);

type Moment = { ns: bigint; kind: "gate" | "restart"; event: string; reasons: readonly string[]; held: boolean | null; status: string | null };

function moments(run: LiveRunDto): Moment[] {
  return [...(run.gate ?? []).map((row) => ({ ns: BigInt(row.observed_ns), kind: "gate" as const, event: row.event, reasons: row.reasons, held: null, status: row.status ?? null })),
    ...(run.restarts ?? []).map((row) => ({ ns: BigInt(row.observed_ns), kind: "restart" as const, event: row.event, reasons: [], held: row.held, status: null }))]
    .sort((a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0));
}

/** A running run's entry gate now: closed until its latest start warms up (or while it holds an inherited position),
 *  then closed for each reason the gate gave since, until it reopened. */
function entriesOf(run: LiveRunDto): LiveRun["entries"] {
  if (run.host.state !== "running" || run.host.mode !== "run" || !run.restarts) return null;
  let warmed = false, held = false, status: string | null = null;
  const closed = new Set<string>();
  for (const moment of moments(run)) {
    if (moment.kind === "restart" && PROCESS_ENDS.has(moment.event)) { warmed = false; held = moment.event === "resuming" && moment.held === true; closed.clear(); }
    else if (moment.kind === "restart" && moment.event === "warmup") { warmed = true; held = false; }
    else if (moment.event === "entries_closed" || moment.event === "connection_lost") {
      moment.reasons.forEach((reason) => closed.add(reason));
      if (moment.reasons.includes("contract_status")) status = moment.status;
    }
    else if (moment.event === "entries_opened") closed.clear();
  }
  if (held) return { open: false, text: "Closed · inherited position" };
  if (!warmed) return { open: false, text: "Closed · warming up" };
  if (closed.size === 0) return { open: true, text: "Open" };
  // Binance's own status (SETTLING, DELIVERED, ...) tells a pause from a contract that will not trade again.
  const reasonText = (reason: string) => reason === "contract_status" && status ? `${GATE_TEXT[reason]} (${status})`
    : GATE_TEXT[reason] ?? reason.replaceAll("_", " ");
  return { open: false, text: `Closed · ${[...closed].map(reasonText).join(", ")}` };
}

/** The latest entries_opened after a lost connection: when Binance and the run agreed again. */
const reconnectOf = (run: LiveRunDto) => [...run.gate ?? []].reverse().find((row) => row.event === "entries_opened" && row.reasons.includes("disconnected"))?.observed_ns ?? null;

function comparedOf(run: LiveRunDto): LiveRun["compared"] {
  const record = run.compare;
  if (!record) return null;
  const failures = record.failures ?? 0, day = record.day;
  switch (record.state) {
    case "done": {
      const unexplained = record.unexplained_count ?? 0, decisions = record.measures?.groups;
      return { day, text: `${unexplained}${decisions === undefined ? "" : ` of ${decisions}`} unexplained`, attention: unexplained > 0 };
    }
    case "waiting": return { day, text: "waiting for the market", attention: false };
    case "running": return { day, text: "comparing", attention: false };
    case "empty": return { day, text: "nothing traded", attention: false };
    default: return { day, text: `failed (${record.code ?? "unknown"})${failures > 1 ? `, ${failures} days running` : ""}`, attention: failures > 1 };
  }
}

/** The facts of a run that keeps running (design §3.10): how long it has traded, its latest warm-up, its entries,
 *  its last reconnect, its latest comparison with a replay and a failed hourly check of its key that no pass followed
 *  (live/control.py check_key_locked; the run goes on). */
function continuityOf(run: LiveRunDto, entries: LiveRun["entries"], compared: LiveRun["compared"]): LiveFact[] {
  const warmups = (run.restarts ?? []).filter((row) => row.event === "warmup"), key = run.key_checks?.at(-1);
  return [fact("Trading for", warmups[0]?.observed_ns ?? null, "since"), fact("Latest warm-up", warmups.at(-1)?.observed_ns ?? null, "nanoseconds"),
    { ...fact("Entries", entries?.text ?? null), attention: entries?.open === false }, fact("Last reconnect", reconnectOf(run), "nanoseconds"),
    { ...fact("Replay", compared ? `${compared.day} · ${compared.text}` : null), attention: compared?.attention ?? false },
    ...key?.event === "key_check_failed" ? [{ ...fact("API key", refusalText(key.code ?? undefined)), attention: true }] : [],
    ...run.switch ? [fact("Runtime", build(run.switch.current)), ...[lastSwitch(run)].filter((item) => item !== null)] : []];
}

/** Preserve source distinctions and unknowns; no fill aggregation or account-state inference. */
export function liveRunPresentation(run: LiveRunDto, sources: readonly LiveSourceDto[], review?: LiveRunDto): LiveRun {
  const source = sources.find((item) => item.source_sha256 === run.source.source_sha256 && item.entry_class === run.source.entry_class);
  const candidate = run.candidate, account = run.account, entries = entriesOf(run), compared = comparedOf(run);
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
    entries, compared, continuity: run.host.mode === "run" ? continuityOf(run, entries, compared) : [], runtime: runtimeOf(run),
    orders: run.orders, positions: run.positions, equity: equityOf(run), review: review?.review ?? run.review ?? null, reviewError: review?.review_error?.code ?? run.review_error?.code ?? null,
  };
}

export function liveHomePresentation(home: LiveHomeDto, reviews: ReadonlyMap<string, LiveRunDto>): LiveTradingView {
  const unavailable = home.write_reason === "LIVE_RELEASE_UNAVAILABLE"
    ? "The Live service cannot currently confirm that it is ready to accept new actions. Wait, then refresh observations. (LIVE_RELEASE_UNAVAILABLE)"
    : home.write_reason ?? "Live actions are unavailable in this deployment.";
  return {
    availability: "ready", notice: home.write_enabled ? null : unavailable,
    reason: home.write_enabled ? null : home.write_reason ?? "LIVE_WRITE_DISABLED",
    credentials: home.credentials.map((item) => ({ ref: item.credential_ref, savedAt: item.observed_ns, selected: item.selected, available: item.available, removed: item.removed, runIds: item.referenced_runs })),
    sources: home.sources.map((item) => ({ id: item.source_id, candidate: item.candidate, sourceHash: item.source_sha256, entryClass: item.entry_class, purpose: item.purpose, symbols: item.symbols,
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
