// The Live launch page as rows (widgets/live/LiveLaunch.tsx draws them): three columns, each row a value, where it
// comes from, whether the user may change it here, and whether it passes, with a plain reason when it does not.
// Start opens only when every required row has a value and passes. The server still checks everything again and
// refuses as before; these rows only show its conditions earlier. Opening a setting is EDITABLE plus the server
// accepting a value other than its default.
import type { LiveCredential, LiveRun, LiveSource, LiveTradingView } from "./liveTrading";
import { unavailableReason } from "./liveLaunchText";
export { refusalText, restText, SPAN_UNITS, spanText, unavailableReason } from "./liveLaunchText";
/** pass / fail: a condition and its answer; wait: a condition not answered yet; shown: a value with no condition. */
export type Mark = "pass" | "fail" | "wait" | "shown";
export type LaunchRow = {
  id: string; label: string; value: string | null; unit?: string | null; mono?: boolean;
  span?: boolean; // the value is whole seconds, drawn in SPAN_UNITS
  source: string; // where the value comes from, as the page says it; empty for a value the user types here
  editable: boolean; mark: Mark;
  required: boolean; // whether starting needs this row to have a value and pass; one that is not (the targets) is shown only
  reason: string | null; // why it fails or waits, and who can change that; or a note on a passing or shown value
};
export type LaunchColumn = { id: "strategy" | "account" | "limits"; title: string; rows: LaunchRow[] };

/** The run settings the server takes (live/configuration.py CONFIG_KEYS). Editable where the run needs the user's own
 *  choice: its duration (none: until stopped) and a drawdown brake tighter than the target. Leverage is the Live
 *  settings' value (it must equal the contract's on Binance). The cash floor is no setting: 85% of the wallet. */
export const EDITABLE: Readonly<Record<string, boolean>> = { drawdown_brake: true, duration_seconds: true, leverage: false };
/** engine/live_brake.py: the loosest brake (the drawdown target), and the cash floor from a wallet (85%, to the cent). */
export const BRAKE_MAX_PERCENT = 15, cashFloor = (wallet: string) => (Math.floor(Number(wallet) * 85 + 1e-9) / 100).toFixed(2);
export type LaunchInput = {
  view: LiveTradingView; source: LiveSource | null; edits: Readonly<Record<string, string>>;
  /** The run this page prepared to check the account; its check and observation fill the account rows. */
  checked: LiveRun | null;
  /** The candidate's research reading and its line's targets, when the drawn research graph has them. */
  reading: { annual_return: number | null; max_drawdown: number | null } | null;
  targets: { max_drawdown?: number | null; annual_return?: number | null } | null;
};
const SETTINGS = "Live settings on the server", CHECK = "Account check";
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const value = (view: LiveTradingView, edits: LaunchInput["edits"], id: string) =>
  edits[id] ?? view.planFields.find((field) => field.id === id)?.value ?? null;
/** The value of each run setting as this page would prepare it. */
export function launchValues(view: LiveTradingView, edits: LaunchInput["edits"]): Record<string, string> {
  return Object.fromEntries(view.planFields.map((field) => [field.id, value(view, edits, field.id) ?? field.value]));
}

/** Whether `run` was prepared with exactly these settings, so it can be started as it is. */
export function preparedWith(run: LiveRun, values: Readonly<Record<string, string>>): boolean {
  const config = Object.fromEntries(run.config.map((fact) => [fact.label, fact.value]));
  const brake = config["Drawdown brake"], seconds = Number(values.duration_seconds || 0);
  return brake != null && Math.abs(Number(brake) * 100 - Number(values.drawdown_brake)) < 1e-9
    && (config["Duration (seconds)"] ?? null) === (seconds >= 1 ? String(seconds) : null) && config["Leverage"] === values.leverage;
}

/** Runs other than `self` that still hold the account or may: running, unresolved, or holding its slot. */
export function holding(runs: readonly LiveRun[], self: string | null): LiveRun[] {
  return runs.filter((run) => run.id !== self && (run.running || run.hostState === "unresolved" || run.accountOwned === true));
}

function strategy({ view, source, reading, targets }: LaunchInput, closed: string | null): LaunchRow[] {
  const missing = closed ?? "No candidate is named in the Live settings on the server.";
  const evidence = source?.evidence;
  const replays = evidence?.replays.map((row) => row.balance).join(" · ");
  const leverage = value(view, {}, "leverage");
  const ret = reading?.annual_return ?? null, dd = reading?.max_drawdown ?? null;
  const target = (label: string, got: number | null, want: number | null | undefined, higher: boolean): LaunchRow => ({
    id: label, label, value: got === null ? null : percent(got), source: "Research reading of this candidate", editable: false, required: false,
    mark: got === null || want == null ? "shown" : (higher ? got >= want : got <= want) ? "pass" : "fail",
    reason: !source ? "Shown once Live names a candidate." : want == null ? "Your line has no target set. Shown only; it does not block starting."
      : got === null ? `Target ${higher ? "at least" : "at most"} ${percent(want)}. No research reading of this candidate in the graph drawn.`
      : `Target ${higher ? "at least" : "at most"} ${percent(want)}. Shown only; it does not block starting.`,
  });
  return [
    { id: "candidate", label: "Candidate", value: source?.candidate ?? null, source: "Candidate named in the Live settings", editable: false,
      required: true, mark: source ? "shown" : "fail", reason: source ? source.purpose === "controlled" ? "Controlled execution test: it tests order execution, not returns." : null : missing },
    { id: "source", label: "Source", value: source ? source.sourceHash.slice(0, 12) : null, mono: true, source: "The candidate's registered source in the ledger",
      editable: false, required: true, mark: source ? "shown" : "fail", reason: source ? `Entry class ${source.entryClass}` : missing },
    { id: "contracts", label: "Contracts", value: source?.symbols.join(", ") ?? null, source: SETTINGS, editable: false, required: false,
      mark: "shown", reason: !source ? missing : source.symbols.length > 1 ? "One strategy instance on each contract." : null },
    { id: "leverage", label: "Leverage", value: leverage, unit: leverage === null ? null : "×", source: SETTINGS, editable: EDITABLE.leverage ?? false,
      required: true, mark: leverage === null ? "fail" : "shown",
      reason: leverage === null ? closed ?? missing : `Must equal ${source && source.symbols.length > 1 ? "each contract's" : "this contract's"} leverage at Binance, with cross margin; the account check compares them.` },
    !source || !evidence ? { id: "evidence", label: "Replay evidence", value: source ? "Checked when the account is checked" : null,
      source: "Research ledger", editable: false, required: !source, mark: source ? "shown" : "fail",
      reason: source ? "This Live service reads it only when a run is prepared." : missing }
      : { id: "evidence", label: "Replay evidence", source: "Research ledger, read by the Live service", editable: false, required: true,
        value: evidence.state === "found" ? `${evidence.replays.length} replay${evidence.replays.length === 1 ? "" : "s"}` : evidence.state === "missing" ? "None" : null,
        unit: evidence.state === "found" ? `at ${replays} USDT` : null,
        mark: evidence.state === "found" ? "pass" : evidence.state === "missing" ? "fail" : "wait",
        reason: evidence.state === "found" ? "Passed replays of this source on Live's contracts, on the execution image's replay code."
          : evidence.state === "missing" ? "No passed replay of this candidate on Live's contracts runs the execution image's replay code. The Agent runs one at your wallet's balance (replay explore); the Live settings then read the ledger commit that holds it."
          : evidence.state === "checking" ? "The Live service is reading the ledger and the execution image."
          : "The Live service could not read it just now and tries again within a few minutes." },
    target("Max drawdown", dd, targets?.max_drawdown, false),
    target("Annual return", ret, targets?.annual_return, true),
  ];
}

function account({ source, checked }: LaunchInput, closed: string | null, credential: LiveCredential | undefined): LaunchRow[] {
  const check = checked?.accountCheck ?? null, venue = checked?.venue ?? null, passed = check?.state === "passed";
  const notYet = !checked ? "Shown after the account check." : check?.state === "running" ? "The account check is running." : null;
  const flag = (id: string, label: string, got: boolean | null | undefined, want: boolean, failing: string): LaunchRow => ({
    id, label, source: CHECK, editable: false, required: true,
    value: got == null ? null : got ? "On" : "Off",
    mark: got == null ? check?.state === "failed" ? "fail" : "wait" : got === want ? "pass" : "fail",
    reason: got == null ? notYet ?? (check?.state === "failed" ? "The last check did not observe it." : "Not observed.") : got === want ? null : failing,
  });
  const wallet = venue?.wallet ?? null, available = venue?.available ?? null, budget = wallet === null ? null : cashFloor(wallet);
  const funds = wallet !== null && available !== null ? Math.min(Number(wallet), Number(available)) : null;
  const evidence = source?.evidence, tolerance = Number(evidence?.tolerance ?? "0.1");
  const nearest = wallet !== null && evidence?.replays.length
    ? evidence.replays.reduce((best, row) => Math.abs(Number(row.balance) - Number(wallet)) < Math.abs(Number(best.balance) - Number(wallet)) ? row : best) : null;
  return [
    { id: "key", label: "API key", value: credential ? `Binance Futures · ${credential.ref.slice(0, 8)}` : null, source: "Saved in Settings", editable: false,
      required: true, mark: credential ? credential.available === false ? "fail" : "pass" : "fail",
      reason: credential ? credential.available === false ? "Its copy on the server is gone. Save the key again in Settings." : null
        : closed ?? "Save a Binance Futures API key (no withdrawals, restricted to this server's IP) in Settings." },
    { id: "check", label: "Account check", source: "Read-only, by the Live service", editable: false, required: true,
      value: check ? { passed: "Passed", failed: "Failed", running: "Running", unknown: "Unknown" }[check.state] : null,
      mark: passed ? "pass" : check?.state === "failed" ? "fail" : "wait",
      reason: passed ? "Live checks the account again when it starts." : check?.state === "failed"
        ? "Live refused the account: a mode, the margin type or leverage, the key's permissions or the funds. The rows here show what it observed; Requests has the rest."
        : check?.state === "running" ? "Reading the account at Binance. This page refreshes on its own." : "Not checked yet. It reads the account; it places no order." },
    flag("trading", "Trading enabled", venue?.canTrade, true, "Binance reports trading disabled for this account."),
    flag("hedge", "Hedge mode", venue?.hedgeMode, true, "Live needs hedge mode. Turn it on in Binance Futures preferences."),
    flag("multi", "Multi-assets mode", venue?.multiAssets, true, "Live needs multi-assets margin mode. Turn it on in Binance Futures preferences."),
    { id: "withdraw", label: "Key cannot withdraw", source: CHECK, editable: false, required: true, value: passed ? "Confirmed" : null,
      mark: passed ? "pass" : check?.state === "failed" ? "fail" : "wait",
      reason: passed ? null : notYet ?? "Not confirmed by the last check. A key that allows withdrawals or has no IP restriction is refused; change that at Binance." },
    { id: "wallet", label: "Futures wallet", value: wallet, unit: wallet === null ? null : "USDT", source: CHECK, editable: false, required: true,
      mark: wallet === null ? "wait" : "pass", reason: wallet === null ? notYet ?? "Not observed." : available === null ? null : `${available} USDT available` },
    { id: "budget", label: "Cash floor", value: budget, unit: budget === null ? "Wallet × 85 %" : "USDT", source: "Wallet × 85 % at the start",
      editable: false, required: true,
      mark: budget === null ? check?.state === "failed" ? "fail" : "wait" : !(Number(budget) > 0) || Number(budget) > 100 || funds === null || Number(budget) > funds ? "fail" : "pass",
      reason: budget === null ? notYet ?? closed ?? "Set from the wallet the account check reads."
        : Number(budget) > 100 ? "The first Live trial takes a cash floor of at most 100 USDT, a wallet up to about 117 USDT."
        : funds === null || Number(budget) > funds ? "More than the USDT the wallet has available. Add USDT at Binance."
        : "Each entry needs this much USDT in the wallet and available, a last line should the drawdown brake fail." },
    { id: "near", label: "Replay at wallet", source: "Replay evidence and the wallet", editable: false, required: Boolean(evidence),
      value: nearest ? nearest.balance : null, unit: nearest ? "USDT" : null,
      mark: !evidence ? "shown" : wallet === null ? "wait" : nearest && Math.abs(Number(nearest.balance) - Number(wallet)) <= tolerance * Number(wallet) ? "pass" : "fail",
      reason: !evidence ? "This Live service compares them when it starts."
        : wallet === null ? `A replay must start within ${percent(tolerance)} of the wallet; compared after the account check.`
        : nearest && Math.abs(Number(nearest.balance) - Number(wallet)) <= tolerance * Number(wallet) ? `Within ${percent(tolerance)} of the wallet.`
        : `No replay started within ${percent(tolerance)} of the ${wallet} USDT wallet. The Agent replays the candidate at the wallet.` },
  ];
}

function limits({ view, edits, checked }: LaunchInput, closed: string | null): LaunchRow[] {
  const brake = value(view, edits, "drawdown_brake"), duration = value(view, edits, "duration_seconds");
  const seconds = duration !== null && /^\d+$/.test(duration) ? Number(duration) : 0;
  const percentage = brake !== null && /^\d+(\.\d+)?$/.test(brake.trim()) ? Number(brake) : null;
  const others = holding(view.runs, checked?.id ?? null);
  const notify = view.notify;
  return [
    { id: "drawdown_brake", label: "Drawdown brake", value: brake, unit: "%", source: "Your maximum-drawdown target, or tighter",
      editable: EDITABLE.drawdown_brake ?? false, required: true,
      mark: percentage !== null && percentage > 0 && percentage <= BRAKE_MAX_PERCENT ? "pass" : "fail",
      reason: brake === null ? closed ?? "Not set."
        : percentage === null || !(percentage > 0) ? "A percentage above 0." : percentage > BRAKE_MAX_PERCENT ? `At most ${BRAKE_MAX_PERCENT} %; only tighter.`
        : "Once equity (wallet plus open result, fees and funding counted) falls this far below its highest, the run closes, stops and is not started again." },
    { id: "duration_seconds", label: "Stop after", value: duration, span: true, source: EDITABLE.duration_seconds ? "" : SETTINGS,
      editable: EDITABLE.duration_seconds ?? false, required: false, mark: "shown",
      reason: duration === null ? closed : seconds < 1 ? "Empty: runs until you stop it." : null },
    { id: "notify", label: "Notifications", source: "Settings", editable: false, required: false, mark: "shown",
      value: notify ? notify.configured ? "Telegram on" : "Off" : null,
      reason: notify ? notify.configured ? null : "Set up Telegram in Settings to hear about fills and stops." : closed ?? "This Live service does not report them." },
    { id: "alone", label: "No other run on the account", source: "Live runs on this server", editable: false, required: true,
      value: view.availability === "ready" ? others.length ? `${others.length} holding it` : "None" : null,
      mark: view.availability !== "ready" ? "fail" : others.length ? "fail" : "pass",
      reason: view.availability !== "ready" ? closed : others.length ? `${others.map((run) => run.id).join(", ")} still holds the account. Stop or reconcile it first.` : null },
  ];
}

// While Live takes no run the page says why once, above the columns; each row it holds back says only this.
const WAITS = "Waits for Live (see above).";
export function launchColumns(input: LaunchInput): LaunchColumn[] {
  const closed = unavailableReason(input.view) === null ? null : WAITS;
  const credential = input.view.credentials.find((item) => item.selected && !item.removed);
  return [
    { id: "strategy", title: "Strategy", rows: strategy(input, closed) },
    { id: "account", title: "Account", rows: account(input, closed, credential) },
    { id: "limits", title: "Limits & start", rows: limits(input, closed) },
  ];
}

/** Every required row has a value and passes (a shown value counts as passing). */
export function ready(columns: readonly LaunchColumn[]): boolean {
  return columns.every((column) => column.rows.every((row) => !row.required || (row.value !== null && (row.mark === "pass" || row.mark === "shown"))));
}

/** What the account check needs before it can run: Live taking actions, a candidate, a key, and evidence not known missing. */
export function checkBlocker(input: LaunchInput, canPrepare: boolean): string | null {
  const closed = unavailableReason(input.view);
  if (closed) return closed;
  if (!canPrepare) return "Live takes no new runs right now.";
  if (!input.source) return "No candidate is named in the Live settings on the server.";
  if (!input.view.credentials.some((item) => item.selected && !item.removed)) return "Save an API key in Settings first.";
  if (input.source.evidence?.state === "missing") return "Needs replay evidence first (Strategy).";
  if (input.source.evidence && input.source.evidence.state !== "found") return "Waiting for the replay evidence.";
  return null;
}
