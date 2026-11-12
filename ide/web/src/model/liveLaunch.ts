// The Live launch page as rows (widgets/live/LiveLaunch.tsx draws them): three columns, each row a value, where it
// comes from, whether the user may change it here, and whether it passes, with a plain reason when it does not.
// Start opens only when every required row has a value and passes. The server still checks everything again and
// refuses as before; these rows only show its conditions earlier. Opening a setting is EDITABLE plus the server
// accepting a value other than its default.
import type { LiveCredential, LiveRun, LiveSource, LiveTradingView } from "./liveTrading";
import { spanText, unavailableReason } from "./liveLaunchText";

export { refusalText, spanText, unavailableReason } from "./liveLaunchText";
/** pass / fail: a condition and its answer; wait: a condition not answered yet; shown: a value with no condition. */
export type Mark = "pass" | "fail" | "wait" | "shown";
export type LaunchRow = {
  id: string; label: string; value: string | null; unit?: string | null; mono?: boolean;
  /** Where the value comes from, as the page says it. */
  source: string;
  editable: boolean; mark: Mark;
  /** Whether starting needs this row to have a value and pass; a row that is not (the targets) is shown only. */
  required: boolean;
  /** Why it fails or waits, and who can change that; or a note on a passing or shown value. */
  reason: string | null;
};
export type LaunchColumn = { id: "strategy" | "account" | "limits"; title: string; rows: LaunchRow[] };

/** The run settings the server takes (live/configuration.py CONFIG_KEYS). Editable only where the run needs the
 *  user's own choice: the duration of this run. Budget, loss limit and leverage are the Live settings' values (the
 *  leverage must equal the contract's on Binance); R5 derives budget and loss limit from the wallet. */
export const EDITABLE: Readonly<Record<string, boolean>> = { budget_usdt: false, max_loss_usdt: false, duration_seconds: true, leverage: false };

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
  return config["Budget (USDT)"] === values.budget_usdt && config["Loss threshold (USDT)"] === values.max_loss_usdt
    && config["Duration (seconds)"] === values.duration_seconds && config["Leverage"] === values.leverage;
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
    { id: "contracts", label: "Contracts", value: view.symbols?.join(", ") ?? null, source: SETTINGS, editable: false, required: false, mark: "shown",
      reason: view.symbols ? null : closed ?? "This Live service does not report them; the run's review shows them once prepared." },
    { id: "leverage", label: "Leverage", value: leverage, unit: leverage === null ? null : "×", source: SETTINGS, editable: EDITABLE.leverage ?? false,
      required: true, mark: leverage === null ? "fail" : "shown",
      reason: leverage === null ? closed ?? missing : "Must equal this contract's leverage at Binance, with cross margin; the account check compares them." },
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

function account({ view, source, edits, checked }: LaunchInput, closed: string | null, credential: LiveCredential | undefined): LaunchRow[] {
  const check = checked?.accountCheck ?? null, venue = checked?.venue ?? null, passed = check?.state === "passed";
  const notYet = !checked ? "Shown after the account check." : check?.state === "running" ? "The account check is running." : null;
  const flag = (id: string, label: string, got: boolean | null | undefined, want: boolean, failing: string): LaunchRow => ({
    id, label, source: CHECK, editable: false, required: true,
    value: got == null ? null : got ? "On" : "Off",
    mark: got == null ? check?.state === "failed" ? "fail" : "wait" : got === want ? "pass" : "fail",
    reason: got == null ? notYet ?? (check?.state === "failed" ? "The last check did not observe it." : "Not observed.") : got === want ? null : failing,
  });
  const budget = value(view, edits, "budget_usdt"), wallet = venue?.wallet ?? null, available = venue?.available ?? null;
  const funds = wallet !== null && available !== null ? Math.min(Number(wallet), Number(available)) : null;
  const evidence = source?.evidence, tolerance = Number(evidence?.tolerance ?? "0.1");
  const nearest = wallet !== null && evidence?.replays.length
    ? evidence.replays.reduce((best, row) => Math.abs(Number(row.balance) - Number(wallet)) < Math.abs(Number(best.balance) - Number(wallet)) ? row : best) : null;
  return [
    { id: "key", label: "API key", value: credential ? `Binance Futures · ${credential.ref.slice(0, 8)}` : null, source: "Saved in Settings", editable: false,
      required: true, mark: credential ? credential.available === false ? "fail" : "pass" : "fail",
      reason: credential ? credential.available === false ? "Its copy on the server is gone. Save the key again in Settings." : null
        : closed ?? "Save a Binance Futures API key (no withdrawals) in Settings." },
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
      reason: passed ? null : notYet ?? "Not confirmed by the last check. A key that allows withdrawals is refused; turn that off at Binance." },
    { id: "wallet", label: "Futures wallet", value: wallet, unit: wallet === null ? null : "USDT", source: CHECK, editable: false, required: true,
      mark: wallet === null ? "wait" : "pass", reason: wallet === null ? notYet ?? "Not observed." : available === null ? null : `${available} USDT available` },
    { id: "budget_usdt", label: "Budget", value: budget, unit: budget === null ? null : "USDT", source: EDITABLE.budget_usdt ? "Your choice" : SETTINGS,
      editable: EDITABLE.budget_usdt ?? false, required: true,
      mark: budget === null || !(Number(budget) > 0) ? "fail" : funds === null ? "wait" : Number(budget) <= funds ? "pass" : "fail",
      reason: budget === null ? closed ?? "Not set." : funds === null ? "Compared with the wallet after the account check."
        : Number(budget) <= funds ? null : "More than the USDT the wallet has available. Add USDT at Binance." },
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
  const loss = value(view, edits, "max_loss_usdt"), budget = value(view, edits, "budget_usdt"), duration = value(view, edits, "duration_seconds");
  const span = duration === null ? null : spanText(duration);
  const others = holding(view.runs, checked?.id ?? null);
  const notify = view.notify;
  return [
    { id: "max_loss_usdt", label: "Loss limit", value: loss, unit: loss === null ? null : "USDT", source: EDITABLE.max_loss_usdt ? "Your choice" : SETTINGS,
      editable: EDITABLE.max_loss_usdt ?? false, required: true,
      mark: loss === null || !(Number(loss) > 0) ? "fail" : budget !== null && Number(loss) > Number(budget) ? "fail" : "pass",
      reason: loss === null ? closed ?? "Not set." : budget !== null && Number(loss) > Number(budget) ? "Above the budget; Live refuses it."
        : "The run stops once its loss reaches this." },
    { id: "duration_seconds", label: "Duration", value: duration, unit: duration === null ? null : "s", source: EDITABLE.duration_seconds ? "Your choice" : SETTINGS,
      editable: EDITABLE.duration_seconds ?? false, required: true, mark: span === null ? "fail" : "pass",
      reason: duration === null ? closed ?? "Not set." : span === null ? "A whole number of seconds, 1 or more." : `${span}, then the run stops on its own.` },
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
