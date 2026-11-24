import { useAtom } from "../../state/atom";
import { refusal } from "../../state/paper";
import { Notice } from "../../ui/Notice";

/** The last refused paper action over the page, on desktop and phone alike, until it is closed: what was not
 *  done, the server's reason and its code. */
export function PaperRefusal() {
  const refused = useAtom(refusal);
  return refused && (
    <Notice tone="fail" title={refused.title} onClose={() => refusal.set(null)}>
      <p className="text-fg-muted">{refused.message}</p>
      <p className="font-mono text-small text-fg-faint">{refused.code}</p>
    </Notice>
  );
}
