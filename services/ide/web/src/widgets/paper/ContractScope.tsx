import { Tabs } from "../../components/Tabs";
import { useAtom } from "../../state/atom";
import { allContracts, paperTab } from "../../state/paper";

/** The header control of Events and Positions on a contract tab: the tab's contract alone, or all. */
export function ContractScope() {
  const tab = useAtom(paperTab);
  const all = useAtom(allContracts);
  if (!tab) return null;
  return (
    <span className="ml-auto">
      <Tabs compact label="Contracts shown" items={[{ id: "one", label: tab }, { id: "all", label: "All" }]} value={all ? "all" : "one"}
            onChange={(id) => allContracts.set(id === "all")} />
    </span>
  );
}

/** The contract a tool window narrows to: the open tab's, unless all are asked for. */
export function useScope(): string | null {
  const tab = useAtom(paperTab);
  const all = useAtom(allContracts);
  return tab && !all ? tab : null;
}
