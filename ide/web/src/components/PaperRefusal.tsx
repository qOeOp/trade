import { Icon } from "../icons/Icon";
import { useAtom } from "../state/atom";
import { refusal } from "../state/paper";

/** The last refused paper action over the page, on desktop and phone alike, until it is closed: what was not
 *  done, the server's reason and its code. */
export function PaperRefusal() {
  const refused = useAtom(refusal);
  if (!refused) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-popup border border-line-strong bg-popup px-4 py-3 text-dense shadow-popup">
      <Icon name="warning" size={16} tone="fail" className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-fg">{refused.title}</p>
        <p className="text-fg-muted">{refused.message}</p>
        <p className="font-mono text-small text-fg-faint">{refused.code}</p>
      </div>
      <button type="button" aria-label="Close" onClick={() => refusal.set(null)}
              className="-mr-1 grid size-6 shrink-0 place-items-center rounded-control text-fg-faint hover:bg-hover active:bg-pressed">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
