import { useRef, useState } from "react";
import { dateTime, nsMilliseconds } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import type { LiveNotify, LiveTradingActions } from "../model/liveTrading";
import { FormButton, TextField } from "./chat/Field";
import { KeyValues } from "./KeyValues";

/** Telegram notifications of run starts and ends, fills, runs needing attention and a daily summary. The token
 *  lives only in this field until Save; the service never returns it. */
export function LiveNotifications({ notify, actions }: { notify: LiveNotify | null | undefined; actions: LiveTradingActions }) {
  const zone = useTimeZone(), pending = useRef(false);
  const [token, setToken] = useState(""), [busy, setBusy] = useState(false), [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);
  const run = async (work: (() => Promise<string | null>) | undefined, success: string) => {
    if (!work || pending.current) return;
    pending.current = true; setBusy(true); setResult(null);
    try { const refused = await work(); setResult(refused ? { text: refused, failed: true } : { text: success, failed: false }); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = () => { const value = token.trim(); setToken(""); void run(actions.saveNotify && (() => actions.saveNotify!(value)), "Saved. Notifications go to the chat that messaged your bot."); };
  const at = (ns: string | null) => dateTime(nsMilliseconds(ns), zone, "second");
  const status = !notify ? "Unavailable from this Live service" : notify.configured ? "On · bound to your private chat" : "Off";
  return <section aria-label="Notifications" className="space-y-3 border-t border-line pt-4">
    <p className="font-semibold">Notifications</p>
    <KeyValues items={[["Telegram", status], ...notify?.configured ? [["Last sent", notify.lastSentNs ? at(notify.lastSentNs) : "Nothing yet"] as const] : [],
      ...notify?.lastError ? [["Last error", `${notify.lastError.code}${notify.lastError.atNs ? ` · ${at(notify.lastError.atNs)}` : ""}`] as const] : [],
      ...notify?.dropped ? [["Not delivered", `${notify.dropped} message${notify.dropped === 1 ? "" : "s"}`] as const] : []]} />
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <TextField label="Telegram bot token" type="password" autoComplete="off" spellCheck={false} value={token} onValue={setToken} disabled={!actions.saveNotify || busy} />
      <p className="text-small text-fg-muted">Create a bot with @BotFather, send it any message from your Telegram account, then save its token here. The token is kept privately on the Live host and never shown again.</p>
      {result && <p role={result.failed ? "alert" : "status"} className={`text-dense ${result.failed ? "text-fail" : "text-fg-muted"}`}>{result.text}</p>}
      <div className="flex flex-wrap gap-2">
        <FormButton type="submit" disabled={!actions.saveNotify || busy || !token.trim()}>{busy ? "Submitting…" : "Save"}</FormButton>
        <FormButton disabled={!actions.testNotify || !notify?.configured || busy} onClick={() => void run(actions.testNotify, "Test message sent.")}>Send test</FormButton>
        <FormButton disabled={!actions.removeNotify || !notify?.configured || busy} onClick={() => void run(actions.removeNotify, "Removed. Nothing more will be sent.")}>Remove</FormButton>
      </div>
    </form>
  </section>;
}
