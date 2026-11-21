import { Tabs } from "../../ui/Tabs";
import { eventNotes, LiveEvents } from "./LiveEvents";
import { InfoTip } from "../../ui/InfoTip";
import type { LiveRun } from "../../model/liveTrading";
import { atom, useAtom } from "../../state/atom";
import { useLiveRunView } from "../../state/liveRun";
import { Exceptions, exceptionsText, raised } from "../paper/Exceptions";

const tab = atom<"orders" | "positions" | "exceptions">("orders");

/** The tab open: Exceptions only once the strategy raised, as on a paper run. */
function useTab(run: LiveRun | null) {
  const selected = useAtom(tab), failures = run?.failures ?? [];
  return { selected: selected === "exceptions" && !failures.length ? "orders" as const : selected, failures };
}

export function LiveTradesTools() {
  const { run } = useLiveRunView(), { selected, failures } = useTab(run);
  // Pulled left by a tab's own padding, so its text sits on the island's inset as a title's does.
  return <><div className="-ml-2 min-w-0"><Tabs label="Live native events" value={selected} onChange={tab.set} items={[
    { id: "orders", label: "Order events" }, { id: "positions", label: "Position events" },
    ...(failures.length ? [{ id: "exceptions" as const, label: "Exceptions", dot: "fail" as const }] : []),
  ]} /></div>{selected === "exceptions"
    ? <span className="ml-auto whitespace-nowrap text-dense tabular-nums text-fg-faint">Live · All contracts · {exceptionsText(raised(failures), false)}</span>
    : <span className="ml-auto flex items-center gap-1.5 text-small text-fg-faint">Live · retained native observations
      <InfoTip text={eventNotes(selected === "orders" ? "Order" : "Position")} label={`About ${selected === "orders" ? "order" : "position"} events`} /></span>}</>;
}

export function LiveTrades() {
  const { run } = useLiveRunView(), { selected, failures } = useTab(run);
  if (!run) return <p className="p-4 text-dense text-fg-faint">Select a live run to inspect its native events.</p>;
  if (selected === "exceptions") {
    return <div className="@container/page"><Exceptions live failures={failures} sealed={false} only={null} candidate={run.candidate.includes("@") ? run.candidate : null} /></div>;
  }
  return <div className="p-3"><LiveEvents embedded kind={selected === "orders" ? "Order" : "Position"} rows={selected === "orders" ? run.orders : run.positions} /></div>;
}
