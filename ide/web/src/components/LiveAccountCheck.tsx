import type { ReactNode } from "react";
import { dateTime, utcInstant } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import { Icon } from "../icons/Icon";
import type { LiveAccountCheck as AccountCheck } from "../model/liveTrading";

const TEXT = {
  running: ["Account check in progress", "Refresh observations to read its result. Checking the account does not start trading."],
  passed: ["Last account check passed", "The account is checked again at startup."],
  failed: ["Last account check failed", "Review the run observations before trying again."],
  unknown: ["Account check result unavailable", "Refresh observations for an update."],
} satisfies Record<AccountCheck["state"], readonly [string, string]>;

/** The result's mark before its line, so the outcome reads before the words: a green check, a red cross, a
 *  turning ring while it runs (a dashed one under reduced motion), a dashed ring while unknown. */
const MARK: Record<AccountCheck["state"], ReactNode> = {
  passed: <Icon name="passed" size={16} className="text-meets" />,
  failed: <Icon name="failed" size={16} className="text-fail" />,
  running: <><Icon name="loading" size={16} className="text-icon motion-safe:animate-spin motion-reduce:hidden" /><Icon name="untested" size={16} className="text-icon motion-safe:hidden" /></>,
  unknown: <Icon name="untested" size={16} className="text-fg-faint" />,
};

export function LiveAccountCheck({ check, compact = false, startAvailable = false }: {
  check: AccountCheck | null; compact?: boolean; startAvailable?: boolean;
}) {
  const zone = useTimeZone();
  if (!check) return null;
  const [title, detail] = TEXT[check.state];
  return <div role={compact ? undefined : "status"} className="space-y-1 text-small">
    <p className={`flex items-center gap-1.5 text-dense font-semibold ${check.state === "failed" ? "text-fail" : "text-fg"}`}>
      <span aria-hidden="true" className="flex shrink-0">{MARK[check.state]}</span>{title}
    </p>
    {!compact && <p className="text-fg-muted">{check.state === "passed" && !startAvailable
      ? "Starting is currently unavailable. Wait, then refresh observations for the latest service status." : detail}</p>}
    <p className="text-fg-faint">{check.readAt ? <>Last read · <time dateTime={check.readAt}>{dateTime(utcInstant(check.readAt), zone)}</time></> : "Read time unknown"}</p>
  </div>;
}
