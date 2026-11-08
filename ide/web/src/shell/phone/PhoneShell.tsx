import { SettingsMenu } from "../toolbar/SettingsMenu";
import { useEffect } from "react";
import { PhoneTabs, type PhoneTabItem } from "../../components/PhoneTabs";
import { useAtom } from "../../state/atom";
import { useAgentService } from "../../state/agent";
import { useOverviewService } from "../../state/market";
import { usePaperRuns, usePaperService } from "../../state/paper";
import { follow } from "../../state/paperStream";
import { phoneTab, useKeyboard, useLandscape, usePhoneRoot, versionOpen, type PhoneTab } from "../../state/phone";
import { showLivePage, showMarketPage, showRunsPage, showToolWindow } from "../../state/shell";
import { ACTIVE } from "../../model/chain";
import { AgentRuntime } from "../agent/AgentRuntime";
import { RunDriver } from "../RunDriver";
import { AgentTab } from "./AgentTab";
import { MarketTab } from "./MarketTab";
import { ResearchTab } from "./ResearchTab";
import { RunsTab } from "./RunsTab";
import { useShown } from "../../state/shown";

/** The phone's window: a page at a time to the screen's edges over four tabs, no islands, panels or dividers. It
 *  mounts the desktop's own widgets and only arranges them; its tabs drive the same page state (state/shell.ts).
 *  A paper stream runs only on the tabs that read one; the listing keeps the run dot live on the others. */
export function PhoneShell() {
  usePhoneRoot();
  const tab = useAtom(phoneTab), open = useAtom(versionOpen), agent = useAgentService() === "present", landscape = useLandscape(), typing = useKeyboard();
  const overview = useOverviewService(), market = overview === "present" || overview === "offline";
  const paper = usePaperService(), runs = usePaperRuns()?.runs ?? [];
  const live = useShown().stage === "live";
  const streaming = tab === "research" || tab === "runs" && !live;
  useEffect(() => {
    // A version's page shows the Runs page's chart, and Details describes the stage it shows.
    if (tab === "runs" || (tab === "research" && open)) showRunsPage();
    else if (tab === "market") showMarketPage();
    else if (tab === "live") { showLivePage(); phoneTab.set("runs"); }
    else if (tab === "research") showToolWindow("versions", "left");
    if (!streaming) follow(null, null);
  }, [tab, streaming, open]);
  const items: PhoneTabItem<PhoneTab>[] = [
    { id: "runs", icon: "tool.runs", label: "Runs", dot: paper === "offline" ? "fail" : runs.some((r) => ACTIVE.has(r.state)) ? "meets" : undefined },
    { id: "research", icon: "tool.versions", label: "Research" },
    ...(market ? [{ id: "market" as const, icon: "tool.market" as const, label: "Market", dot: overview === "offline" ? "fail" as const : undefined }] : []),
    ...(agent ? [{ id: "agent" as const, icon: "tool.agent" as const, label: "Agent" }] : []),
  ];
  const page = (
    <div className="fixed inset-x-0 top-(--page-top) flex h-(--page-h) min-h-0 flex-col overflow-hidden bg-island pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {streaming && <RunDriver />}
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === "runs" || tab === "live" ? <RunsTab /> : tab === "research" ? <ResearchTab /> : tab === "market" ? <MarketTab /> : <AgentTab />}
      </main>
      {!typing && !(landscape && !live && (tab === "runs" || (tab === "research" && open))) && <PhoneTabs items={items} value={tab} onChange={phoneTab.set} accessory={<SettingsMenu phone />} />}
    </div>
  );
  // The chat runtime sits above the tabs, so a thread keeps streaming on another one.
  return agent ? <AgentRuntime>{page}</AgentRuntime> : page;
}
