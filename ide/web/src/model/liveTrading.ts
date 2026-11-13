import type { LiveEventRow, LiveRequest, LiveReviewDto } from "../lib/liveTradingDto";
export type { LiveRequest } from "../lib/liveTradingDto";

/** Non-persistent presentation values. The transport maps the frozen API DTOs into these;
 * this is not a backend schema and contains no venue credential or private path. */
/** `since`: a time in ns shown as how long ago and when; `attention`: shown in the misses colour. */
export type LiveFact = { label: string; value: string | null; format?: "nanoseconds" | "since"; attention?: boolean };
export type LiveEvidence = { source: string; cursor: string | null; observedNs: string | null; complete: boolean | null; readNs?: string; state?: string };
export type LiveSource = {
  id: string; candidate: string; sourceHash: string; entryClass: string;
  purpose: "natural" | "controlled";
  /** The contracts it trades, one strategy instance each. */
  symbols: readonly string[];
  /** Replay evidence read ahead of preparation; undefined when this Live service does not report it. */
  evidence?: { state: "checking" | "found" | "missing" | "unknown"; replays: readonly { trialId: number; balance: string }[]; tolerance: string };
};
export type LiveCredential = {
  ref: string; savedAt: string | null; selected: boolean; available: boolean | null; runIds: readonly string[]; removed?: boolean;
};
/** Telegram notifications: whether a bot token and its chat are saved, the last delivery and the last failure. */
export type LiveNotify = { configured: boolean; lastSentNs: string | null; lastError: { code: string; atNs: string | null } | null; dropped: number };
export type LivePlanField = { id: string; label: string; value: string };
export type LiveAccountCheck = { state: "running" | "passed" | "failed" | "unknown"; readAt: string | null };
export type LiveRun = {
  id: string; candidate: string; purpose: "natural" | "controlled" | "unknown"; sourceHash: string | null; entryClass: string | null;
  runtimeDigest: string | null; symbols: readonly string[] | null; config: readonly LiveFact[];
  host: readonly LiveFact[]; execution: readonly LiveFact[]; account: readonly LiveFact[];
  ending: readonly LiveFact[]; evidence: readonly LiveEvidence[];
  accountCheck: LiveAccountCheck | null;
  /** The account as its latest observation reports it (null fields: unknown), for the launch page's account rows. */
  venue?: { canTrade: boolean | null; hedgeMode: boolean | null; multiAssets: boolean | null; wallet: string | null; available: string | null } | null;
  /** The host's own state ("running", "unresolved", …) and whether the run holds the account slot. */
  hostState?: string | null; accountOwned?: boolean | null;
  /** Set while the latest start holds around a position or orders it inherited (model/liveTradingMap.ts HELD_NOTICE). */
  heldNotice?: string | null;
  /** A running run's entries: open, or closed and why (model/liveTradingMap.ts entriesOf); null once it ended. */
  entries?: { open: boolean; text: string } | null;
  /** The control's latest daily comparison with a replay: its day and its result in words; null before the first. */
  compared?: { day: string; text: string; attention: boolean } | null;
  /** How the run has kept running: since when it trades, its warm-up, entries, last reconnect, latest comparison. */
  continuity?: readonly LiveFact[];
  /** A runtime image the release offers this running run, or the switch it waits for (model/liveRuntimeMap.ts
   *  runtimeOf); null when there is neither. */
  runtime?: LiveRuntime | null;
  /** When the account was observed and the run's native terminal event, as ns; whether it executes now. */
  observedNs: { account: string | null; terminal: string | null }; running: boolean;
  /** The host reports the run ended, so Request stop has nothing to stop. */
  ended: boolean;
  orders?: readonly LiveEventRow[] | null; positions?: readonly LiveEventRow[] | null;
  /** The account the run's chart draws: its budget and, a minute apart, budget plus its result at the venue's mark
   *  (null: unknown), by time in seconds; null when the budget or the results are unknown. */
  equity?: { budget: number; minutes: readonly (readonly [number, number | null])[] } | null;
  review?: LiveReviewDto | null; reviewError?: string | null;
};
/** The images by their build (the first 12 characters of the revision, else of the digest). */
export type LiveRuntime = {
  current: string | null;
  offered: { build: string | null; facts: readonly LiveFact[]; ready: boolean } | null;
  /** The confirmed switch waits for a flat moment since this time, ns. */
  pending: { build: string | null; sinceNs: string } | null;
};
export type LiveTradingView = {
  availability: "unavailable" | "ready"; notice: string | null;
  /** Why new actions are refused now, as a code (a failed read, or the service's write reason); null when they are
   *  accepted. The launch page words it plainly. */
  reason?: string | null;
  credentials: readonly LiveCredential[]; sources: readonly LiveSource[]; planFields: readonly LivePlanField[];
  runs: readonly LiveRun[]; requests: readonly LiveRequest[];
  notify?: LiveNotify | null;
};
/** Only explicit user interactions call these functions. No callbacks run on mount or refresh. */
export type LiveTradingActions = {
  saveCredentials?: (input: { api_key: string; api_secret: string }) => void | Promise<void>;
  removeCredential?: (ref: string) => void | Promise<void>;
  prepare?: (input: { sourceId: string; values: Readonly<Record<string, string>> }) => Promise<LiveRequest | null>;
  /** Each resolves to the request's receipt (null: none received), so a refusal can be said where it was asked. */
  preflight?: (runId: string) => void | Promise<LiveRequest | null | void>;
  start?: (runId: string, confirmRealOrders: string) => void | Promise<LiveRequest | null | void>;
  stop?: (runId: string) => void | Promise<void>;
  reconcile?: (runId: string) => void | Promise<void>;
  maintain?: (runId: string) => void | Promise<void>;
  /** Confirm the release's runtime image for a running run, taken at its next flat moment, and cancel that. */
  switchRuntime?: (runId: string) => Promise<LiveRequest | null>;
  cancelSwitch?: (runId: string) => Promise<LiveRequest | null>;
  resolveRequest?: (requestId: string) => void | Promise<void>;
  /** Telegram settings; each resolves to the refusal text, or null when it succeeded. */
  saveNotify?: (botToken: string) => Promise<string | null>;
  testNotify?: () => Promise<string | null>;
  removeNotify?: () => Promise<string | null>;
  refresh?: () => void | Promise<void>;
  inspect?: (runId: string) => void | Promise<void>;
};

export const livePurposeLabel = (purpose: LiveRun["purpose"]) => purpose === "controlled" ? "Controlled execution test" : purpose === "natural" ? "Natural signal" : "Purpose not declared";
/** A plan label's name and its unit ("Budget (USDT)" → "Budget", "USDT"), so the unit can follow the value. */
export const labelUnit = (label: string): readonly [string, string | null] => {
  const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(label);
  return match ? [match[1]!, match[2]!] : [label, null];
};

export const LIVE_UNAVAILABLE: LiveTradingView = {
  availability: "unavailable", reason: "LIVE_UNAVAILABLE",
  notice: "The Live service is not connected to this IDE. No request will be sent.",
  credentials: [], sources: [], planFields: [], runs: [], requests: [],
};
