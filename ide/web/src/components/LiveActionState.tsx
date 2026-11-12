import { useRef, useState } from "react";

/** Avoid repeated UI submission while an explicit click's callback is pending. Never retry it. */
export function useLiveAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const submit = async (action: () => unknown) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailed(false);
    try { await action(); }
    catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return { busy, failed, submit };
}

export function LiveActionFailure({ failed }: { failed: boolean }) {
  return failed ? <p role="alert" className="text-dense text-fail">The request result is unknown. Check its status before submitting another action.</p> : null;
}
