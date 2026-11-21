import type { LiveEnvironment } from "../../model/liveTrading";

/** A demo run's capsule beside its name or status: it trades Binance Demo Trading, never the real account. */
export function DemoBadge({ environment }: { environment: LiveEnvironment | null }) {
  return environment === "demo" ? <span title="Binance Demo Trading: not the real account"
    className="inline-flex shrink-0 items-center rounded-badge border border-misses px-1.5 text-small leading-4 text-misses-fg">Demo</span> : null;
}
