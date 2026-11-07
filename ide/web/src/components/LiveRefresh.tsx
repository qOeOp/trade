import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";

export function LiveRefresh({ refresh }: { refresh?: () => void | Promise<void> }) {
  const action = useLiveAction();
  return <FormButton disabled={!refresh || action.busy} onClick={() => { if (refresh) void action.submit(refresh); }} className="min-h-10">{action.busy ? "Reading…" : "Refresh observations"}</FormButton>;
}
