import { useLiveTrading } from "../../state/liveTrading";
import { useLiveWorkspace, closeLiveWizard, openLiveCredentials, closeLiveCredentials, openLiveRequests, closeLiveRequests, showLiveRun } from "../../state/liveWorkspace";
import { LiveLaunchWizard } from "../../components/LiveLaunchWizard";
import { LiveCredentialsDialog } from "../../components/LiveCredentialsDialog";
import { LiveRequestsDialog } from "../../components/LiveRequestsDialog";

/** Mounted once in App. Overlay forms unmount on close; only the non-secret wizard draft survives. */
export function LiveDialogs() {
  const { view, actions } = useLiveTrading(), workspace = useLiveWorkspace();
  const selectRun = (id: string) => { closeLiveRequests(); closeLiveCredentials(); closeLiveWizard(); showLiveRun(id); };
  return <>
    {workspace.wizard && <LiveLaunchWizard key={workspace.wizard.runId ?? "new"} initialRunId={workspace.wizard.runId}
      open={!workspace.credentials && !workspace.requests} close={closeLiveWizard} view={view} actions={actions}
      manage={openLiveCredentials} requests={openLiveRequests} selectRun={showLiveRun} />}
    {workspace.credentials && !workspace.requests && <LiveCredentialsDialog view={view} actions={actions} close={closeLiveCredentials} requests={openLiveRequests} />}
    {workspace.requests && <LiveRequestsDialog view={view} actions={actions} close={closeLiveRequests} selectRun={selectRun} />}
  </>;
}
