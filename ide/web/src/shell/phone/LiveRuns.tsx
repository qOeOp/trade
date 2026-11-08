import { useState } from "react";
import { PhoneBar, PhoneBarButton, PhonePage } from "../../components/PhoneBar";
import { Sheet } from "../../components/Sheet";
import { TextButton } from "../../components/TextButton";
import { openLiveCredentials, openLiveWizard } from "../../state/liveWorkspace";
import { useShown } from "../../state/shown";
import { LiveRunCanvas } from "../../widgets/live/LiveRunCanvas";
import { LiveRunDetails } from "../../widgets/live/LiveRunDetails";
import { LiveTrades, LiveTradesTools } from "../../widgets/live/LiveTrades";
import { RunMenuList } from "../../widgets/runs/RunMenuList";

/** Live uses the Runs tab and its same run picker, with Details and Trades below the canvas. */
export function LiveRuns() {
  const { liveRun: run } = useShown(), [picking, setPicking] = useState(false);
  return <>
    <PhoneBar>
      <PhoneBarButton label="Choose a run" onClick={() => setPicking(true)}><span className="truncate">Live · {run?.candidate ?? "Runs"}</span></PhoneBarButton>
      {/* The desktop toolbar's Review run…: the phone has no toolbar. */}
      {run && <TextButton className="shrink-0 text-dense" onClick={() => openLiveWizard(run.id)}>Review…</TextButton>}
      <TextButton className="shrink-0 text-dense" onClick={() => openLiveWizard()}>New…</TextButton>
    </PhoneBar>
    <PhonePage>
      <div className="h-[65dvh] min-h-96 border-b border-line"><LiveRunCanvas /></div>
      {run && <><section aria-label="Run details"><LiveRunDetails /></section>
        <section className="border-t border-line"><div className="flex min-h-(--header-h) flex-wrap items-center gap-3 px-3 py-2"><LiveTradesTools /></div><LiveTrades /></section></>}
      <div className="border-t border-line px-3 py-3"><TextButton className="-ml-1" onClick={openLiveCredentials}>Manage credentials…</TextButton></div>
    </PhonePage>
    <Sheet open={picking} onClose={() => setPicking(false)} title="Runs"><RunMenuList phone close={() => setPicking(false)} /></Sheet>
  </>;
}
