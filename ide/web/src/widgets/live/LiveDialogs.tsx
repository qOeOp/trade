import { useLiveTrading } from "../../state/liveTrading";
import { useLiveWorkspace, closeLiveReview, closeLiveCredentials, openLiveRequests, closeLiveRequests, showLiveRun } from "../../state/liveWorkspace";
import { LiveRunReview } from "../../components/LiveRunReview";
import { LiveCredentialsDialog } from "../../components/LiveCredentialsDialog";
import { LiveRequestsDialog } from "../../components/LiveRequestsDialog";

/** Mounted once in App. Overlay forms unmount on close. A new run starts inline on the Live page, never here. */
export function LiveDialogs() {
  const { view, actions } = useLiveTrading(), workspace = useLiveWorkspace();
  const selectRun = (id: string) => { closeLiveRequests(); closeLiveCredentials(); closeLiveReview(); showLiveRun(id); };
  return <>
    {workspace.review && <LiveRunReview key={workspace.review} runId={workspace.review}
      open={!workspace.credentials && !workspace.requests} close={closeLiveReview} view={view} actions={actions} requests={openLiveRequests} />}
    {workspace.credentials && !workspace.requests && <LiveCredentialsDialog view={view} actions={actions} close={closeLiveCredentials} requests={openLiveRequests} />}
    {workspace.requests && <LiveRequestsDialog view={view} actions={actions} close={closeLiveRequests} selectRun={selectRun} />}
  </>;
}
