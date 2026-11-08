import { Tabs } from "../../components/Tabs";
import { LiveEvents } from "../../components/LiveEvents";
import { atom, useAtom } from "../../state/atom";
import { useLiveRunView } from "../../state/liveRun";
import type { LiveRun } from "../../model/liveTrading";

const tab = atom<"orders" | "positions">("orders");
export function LiveTradesTools() {
  const selected = useAtom(tab);
  // Pulled left by a tab's own padding, so its text sits on the island's inset as a title's does.
  return <><div className="-ml-2 min-w-0"><Tabs label="Live native events" value={selected} onChange={tab.set} items={[
    { id: "orders", label: "Order events" }, { id: "positions", label: "Position events" },
  ]} /></div><span className="ml-auto text-small text-fg-faint">Live · retained native observations</span></>;
}

export function LiveTrades() {
  const selected = useAtom(tab), { run } = useLiveRunView();
  return <LiveTradesView run={run} selected={selected} />;
}

export function LiveTradesView({ run, selected }: { run: LiveRun | null; selected: "orders" | "positions" }) {
  if (!run) return <p className="p-4 text-dense text-fg-faint">Select a live run to inspect its native events.</p>;
  return <div className="p-3"><LiveEvents embedded kind={selected === "orders" ? "Order" : "Position"} rows={selected === "orders" ? run.orders : run.positions} /></div>;
}
