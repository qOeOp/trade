import { Tabs } from "../../components/Tabs";
import { LiveEvents } from "../../components/LiveEvents";
import { atom, useAtom } from "../../state/atom";
import { useShown } from "../../state/shown";

const tab = atom<"orders" | "positions">("orders");
export function LiveTradesTools() {
  const selected = useAtom(tab);
  return <><Tabs label="Live native events" value={selected} onChange={tab.set} items={[
    { id: "orders", label: "Order events" }, { id: "positions", label: "Position events" },
  ]} /><span className="ml-auto text-small text-fg-faint">Live · retained native observations</span></>;
}

export function LiveTrades() {
  const selected = useAtom(tab), { liveRun: run } = useShown();
  if (!run) return <p className="p-4 text-dense text-fg-faint">Select a live run to inspect its native events.</p>;
  return <div className="p-3"><LiveEvents embedded kind={selected === "orders" ? "Order" : "Position"} rows={selected === "orders" ? run.orders : run.positions} /></div>;
}
