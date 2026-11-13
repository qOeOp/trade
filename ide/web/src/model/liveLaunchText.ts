// The launch page's plain words for why Live takes no run, or refused a step: what happened and who can change it,
// never a refusal code.
import type { LiveTradingView } from "./liveTrading";

/** Why Live cannot take a run at all, said plainly with who can change it; null when it can. */
export function unavailableReason(view: LiveTradingView): string | null {
  const code = view.reason ?? (view.availability === "unavailable" ? "LIVE_UNAVAILABLE" : null);
  if (code === null) return null;
  return {
    LIVE_UNAVAILABLE: "Live is not set up for this IDE, or not answering. You set it up on the server (deploy/remote/README.md).",
    AUTH_REQUIRED: "Your sign-in has expired. Sign in again; runs on the server continue.",
    LIVE_RELEASE_UNAVAILABLE: "Live is switching to a new release and takes no new runs for now. Wait, then refresh.",
    LIVE_RESPONSE_UNKNOWN: "Live did not answer clearly. Refresh in a moment.",
  }[code] ?? "Live takes no new runs right now. You can check its service on the server.";
}

/** A refused launch step's code in plain words, with who can change it. */
export function refusalText(code: string | undefined): string {
  return (code && {
    LIVE_EVIDENCE_MISSING: "No replay backs this candidate yet. The Agent runs a replay of it at your wallet's balance on Live's contracts.",
    LIVE_EVIDENCE_BALANCE: "No replay started near your wallet's balance. The Agent replays the candidate at the wallet.",
    LIVE_CREDENTIAL_UNAVAILABLE: "The saved API key is no longer on the server. Save it again in Settings.",
    LIVE_CREDENTIAL_CHANGED: "The API key changed since the account was checked. Check the account again.",
    LIVE_ACCOUNT_OWNED: "Another Live run still holds the account. Stop or reconcile it first.",
    LIVE_ACCOUNT_NOT_FLAT: "The account holds positions or orders. Close them at Binance first.",
    LIVE_ACCOUNT_MODE: "The account's modes do not match what Live needs. Change them at Binance.",
    LIVE_FUNDS: "The futures wallet does not cover the cash floor (85% of the wallet at the start). Add USDT at Binance.",
    LIVE_KEY_WITHDRAWAL: "This API key allows withdrawals. Turn that off at Binance, or save a key without it.",
    LIVE_KEY_UNVERIFIED: "Binance did not confirm the key's permissions. Try the account check again.",
    LIVE_KEY_IP_UNRESTRICTED: "A Live run needs an API key restricted to this server's IP. Set one at Binance.",
    LIVE_BUDGET: "The first Live trial takes a cash floor of at most 100 USDT, a wallet up to about 117 USDT.",
    LIVE_RELEASE_UNAVAILABLE: "Live is switching to a new release. Wait, then try again.",
    LIVE_CONFIG: "Live did not take these settings. The brake must be above 0 and at most 15 %; the duration whole seconds or empty.",
  }[code]) || "Live refused this step. Requests shows what it recorded.";
}

/** The units a duration is typed in, largest first: a month is 30 days and a year 365; `max` is the largest the part
 *  holds before the next unit up takes it. */
export const SPAN_UNITS = [{ label: "y", name: "years", seconds: 31_536_000, max: 99 }, { label: "mo", name: "months", seconds: 2_592_000, max: 11 },
  { label: "d", name: "days", seconds: 86_400, max: 29 }, { label: "h", name: "hours", seconds: 3600, max: 23 }] as const;

/** Seconds below an hour, as minutes and seconds ("30 min", "15 min 5 s"); empty for none. */
export const restText = (seconds: number) => [Math.floor(seconds / 60) && `${Math.floor(seconds / 60)} min`, seconds % 60 && `${seconds % 60} s`].filter(Boolean).join(" ");

/** A whole, positive number of seconds in those units, largest first, then what is left below an hour ("1 mo 2 d",
 *  "2 h 15 min"): exactly the value sent. Null for anything else. */
export function spanText(seconds: string): string | null {
  if (!/^[1-9][0-9]*$/.test(seconds.trim())) return null;
  let rest = Number(seconds);
  const parts = SPAN_UNITS.map((unit) => { const n = Math.floor(rest / unit.seconds); rest -= n * unit.seconds; return n ? `${n} ${unit.label}` : ""; });
  return [...parts, restText(rest)].filter(Boolean).join(" ");
}
