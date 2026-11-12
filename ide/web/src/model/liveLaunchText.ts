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
    LIVE_FUNDS: "The futures wallet does not cover the budget. Add USDT at Binance.",
    LIVE_KEY_WITHDRAWAL: "This API key allows withdrawals. Turn that off at Binance, or save a key without it.",
    LIVE_KEY_UNVERIFIED: "Binance did not confirm the key's permissions. Try the account check again.",
    LIVE_RELEASE_UNAVAILABLE: "Live is switching to a new release. Wait, then try again.",
    LIVE_CONFIG: "Live did not take these settings. The duration must be a whole number of seconds.",
  }[code]) || "Live refused this step. Requests shows what it recorded.";
}

/** A whole, positive number of seconds as hours and minutes ("2 h 15 min"), or null. */
export function spanText(seconds: string): string | null {
  if (!/^[1-9][0-9]*$/.test(seconds.trim())) return null;
  const total = Number(seconds), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return [h && `${h} h`, m && `${m} min`, s && !h && `${s} s`].filter(Boolean).join(" ") || null;
}
