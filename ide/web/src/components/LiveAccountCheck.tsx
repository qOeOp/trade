import type { LiveAccountCheck as AccountCheck } from "../model/liveTrading";

const TEXT = {
  running: ["Account check in progress", "Refresh observations to read its result. Checking the account does not start trading."],
  passed: ["Last account check passed", "The account is checked again at startup."],
  failed: ["Last account check failed", "Review the run observations before trying again."],
  unknown: ["Account check result unavailable", "Refresh observations for an update."],
} satisfies Record<AccountCheck["state"], readonly [string, string]>;

export function LiveAccountCheck({ check, compact = false, startAvailable = false }: {
  check: AccountCheck | null; compact?: boolean; startAvailable?: boolean;
}) {
  if (!check) return null;
  const [title, detail] = TEXT[check.state];
  return <div role={compact ? undefined : "status"} className="space-y-1 text-small">
    <p className={check.state === "failed" ? "text-fail" : "text-fg"}>{title}</p>
    {!compact && <p className="text-fg-muted">{check.state === "passed" && !startAvailable
      ? "Starting is currently unavailable. Wait, then refresh observations for the latest service status." : detail}</p>}
    <p className="text-fg-faint">{check.readAt ? <>Last read · <time dateTime={check.readAt}>{check.readAt.replace("T", " ").replace("Z", " UTC")}</time></> : "Read time unknown"}</p>
  </div>;
}
