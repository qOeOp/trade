import { useEffect } from "react";
import { PhoneTabs, type PhoneTabItem } from "../../components/PhoneTabs";
import { runsDot } from "../../model/phoneRuns";
import { useAtom } from "../../state/atom";
import { useLiveTrading } from "../../state/liveTrading";
import { pricesWanted, useOverviewService } from "../../state/market";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { follow } from "../../state/paperStream";
import { phoneTab, usePhoneRoot, type PhoneTab } from "../../state/phone";
import { MarketTab } from "./MarketTab";
import { ResearchTab } from "./ResearchTab";
import { RunsTab } from "./RunsTab";

/** The phone's window (docs/plans/ide-phone-scope-20261111.zh.md): three tabs, a page at a time to the screen's
 *  edges. Runs: the Live and paper runs going now, each opening its page, and Live's one action, a stop that asks
 *  first. Market: a glance at prices. Research: each line's readings. No stream is followed: the listings carry what
 *  a phone shows. The settings menu at the end of each page's bar has the way to the desktop. */
export function PhoneShell() {
  usePhoneRoot();
  const tab = useAtom(phoneTab), overview = useOverviewService(), market = overview === "present" || overview === "offline";
  const dot = runsDot(useLiveTrading().view.runs, usePaperRuns(), usePaperService());
  useEffect(() => { follow(null, null); pricesWanted.set(true); return () => pricesWanted.set(false); }, []);
  const items: PhoneTabItem<PhoneTab>[] = [
    { id: "runs", icon: "tool.runs", label: "Runs", dot },
    ...(market ? [{ id: "market" as const, icon: "tool.market" as const, label: "Market", dot: overview === "offline" ? "fail" as const : undefined }] : []),
    { id: "research", icon: "tool.versions", label: "Research" },
  ];
  return (
    <div className="fixed inset-x-0 top-(--page-top) flex h-(--page-h) min-h-0 flex-col overflow-hidden bg-island pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === "market" ? <MarketTab /> : tab === "research" ? <ResearchTab /> : <RunsTab />}
      </main>
      <PhoneTabs items={items} value={tab} onChange={phoneTab.set} />
    </div>
  );
}
