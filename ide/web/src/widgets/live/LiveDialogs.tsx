import { useLiveTrading } from "../../state/liveTrading";
import { useLiveWorkspace, closeLiveReview, closeLiveCredentials } from "../../state/liveWorkspace";
import { LiveRunReview } from "../../components/LiveRunReview";
import { LiveCredentialsDialog } from "../../components/LiveCredentialsDialog";

/** Mounted once in App. Overlay forms unmount on close. A new run starts inline on the Live page, never here. */
export function LiveDialogs() {
  const { view, actions } = useLiveTrading(), workspace = useLiveWorkspace();
  return <>
    {workspace.review && <LiveRunReview key={workspace.review} runId={workspace.review}
      open={!workspace.credentials} close={closeLiveReview} view={view} actions={actions} />}
    {workspace.credentials && <LiveCredentialsDialog view={view} actions={actions} close={closeLiveCredentials} />}
  </>;
}
