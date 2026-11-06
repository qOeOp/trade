import { sessionRequired } from "../state/session";
import { useAtom } from "../state/atom";

export function SessionNotice() {
  const expired = useAtom(sessionRequired);
  if (!expired) return null;
  const back = location.pathname + location.search + location.hash;
  return (
    <div role="alert" className="fixed left-1/2 top-12 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-popup border border-line-strong bg-popup px-4 py-3 text-dense shadow-popup">
      Your session expired. Paper runs continue on the server. <a className="text-primary underline" href={`/oauth2/start?rd=${encodeURIComponent(back)}`}>Sign in with GitHub</a>
    </div>
  );
}
