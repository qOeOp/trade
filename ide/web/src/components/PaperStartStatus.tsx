import { useAtom } from "../state/atom";
import { starting } from "../state/paper";
import { useNow } from "./hooks/useNow";
import { Spinner } from "./Spinner";
import { Tip } from "./Tip";

const WHY = "The server takes the runtime image (pulling it when this host does not have it yet, which can take minutes after a release), "
  + "then starts the run's egress proxy and runner. The Runs page opens with the run once the server accepts it.";

/** How long a start has waited, to the second: 8s, 2m 05s. */
export const waited = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** The status bar's background task for paper starts in flight, as UpdateStatus's: a turning ring (a still
 *  clock under reduced motion), the version and how long its start has waited, from the click on; only the
 *  version's name gives way when the bar is full. */
export function PaperStartStatus() {
  const pending = [...useAtom(starting)];
  return pending[0] ? <Pending first={pending[0]} count={pending.length} /> : null;
}

function Pending({ first: [candidate, since], count }: { first: [string, number]; count: number }) {
  const now = useNow(1000);
  return (
    <Tip content={WHY} side="top">
      <span role="status" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-fg-muted">
        <Spinner />
        {count > 1 ? `Starting ${count} paper runs` : <>Starting paper <span className="max-w-48 truncate">· {candidate}</span></>}
        <span className="tabular-nums">· {waited(now - since)}</span>
      </span>
    </Tip>
  );
}
