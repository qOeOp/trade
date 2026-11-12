import type { LiveEventRow, LiveRequest, LiveReviewDto } from "../lib/liveTradingDto";
export type { LiveRequest } from "../lib/liveTradingDto";

/** Non-persistent presentation values. The transport maps the frozen API DTOs into these;
 * this is not a backend schema and contains no venue credential or private path. */
export type LiveFact = { label: string; value: string | null; format?: "nanoseconds" };
export type LiveEvidence = { source: string; cursor: string | null; observedNs: string | null; complete: boolean | null; readNs?: string; state?: string };
export type LiveSource = {
  id: string; candidate: string; sourceHash: string; entryClass: string;
  purpose: "natural" | "controlled";
};
export type LiveCredential = {
  ref: string; savedAt: string | null; selected: boolean; available: boolean | null; runIds: readonly string[]; removed?: boolean;
};
/** Telegram notifications: whether a bot token and its chat are saved, the last delivery and the last failure. */
export type LiveNotify = { configured: boolean; lastSentNs: string | null; lastError: { code: string; atNs: string | null } | null; dropped: number };
export type LivePlanField = { id: string; label: string; value: string; hint?: string };
export type LiveAccountCheck = { state: "running" | "passed" | "failed" | "unknown"; readAt: string | null };
export type LiveRun = {
  id: string; candidate: string; purpose: "natural" | "controlled" | "unknown"; sourceHash: string | null; entryClass: string | null;
  runtimeDigest: string | null; symbols: readonly string[] | null; config: readonly LiveFact[];
  host: readonly LiveFact[]; execution: readonly LiveFact[]; account: readonly LiveFact[];
  ending: readonly LiveFact[]; evidence: readonly LiveEvidence[];
  accountCheck: LiveAccountCheck | null;
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
export type LiveTradingView = {
  availability: "unavailable" | "ready"; preview: boolean; notice: string | null;
  credentials: readonly LiveCredential[]; sources: readonly LiveSource[]; planFields: readonly LivePlanField[];
  runs: readonly LiveRun[]; request: LiveRequest | null; requests?: readonly LiveRequest[];
  notify?: LiveNotify | null;
};
/** Only explicit user interactions call these functions. No callbacks run on mount or refresh. */
export type LiveTradingActions = {
  saveCredentials?: (input: { api_key: string; api_secret: string }) => void | Promise<void>;
  removeCredential?: (ref: string) => void | Promise<void>;
  prepare?: (input: { sourceId: string; values: Readonly<Record<string, string>> }) => Promise<LiveRequest | null>;
  preflight?: (runId: string) => void | Promise<void>;
  start?: (runId: string, confirmRealOrders: string) => void | Promise<void>;
  stop?: (runId: string) => void | Promise<void>;
  reconcile?: (runId: string) => void | Promise<void>;
  maintain?: (runId: string) => void | Promise<void>;
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
  availability: "unavailable", preview: false,
  notice: "The Live service is not connected to this IDE. No request will be sent.",
  credentials: [], sources: [], planFields: [], runs: [], request: null,
};
