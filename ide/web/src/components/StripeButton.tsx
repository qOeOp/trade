import type { IconName } from "../icons/registry";
import type { DataRole } from "../theme/roles";
import { Icon } from "../icons/Icon";
import { Kbd } from "./Kbd";
import { Tip } from "./Tip";

const DOT: Record<DataRole, string> = { recommended: "bg-recommended", meets: "bg-meets", misses: "bg-misses", fail: "bg-fail", masked: "bg-masked" };

/** A tool-window button on a side stripe: a frame control, the tool window's icon, a filled square while
 *  open; a `dot` on the icon's corner says something runs there, as IntelliJ's Run window does. */
export function StripeButton({ icon, label, keys, active, onClick, dot }: { icon: IconName; label: string; keys?: string; active: boolean; onClick: () => void; dot?: DataRole }) {
  return (
    <Tip side="right" content={<span className="inline-flex items-center gap-2">{label}{keys && <Kbd>{keys}</Kbd>}</span>}>
      <button type="button" aria-label={label} aria-pressed={active} onClick={onClick}
              className={`relative grid size-(--frame-control) place-items-center rounded-popup transition-colors hover:bg-hover active:bg-pressed ${active ? "bg-pressed text-fg" : "text-icon"}`}>
        <Icon name={icon} size={20} />
        {dot && <span className={`absolute right-1 top-1 size-1.5 rounded-full ring-2 ring-frame ${DOT[dot]}`} />}
      </button>
    </Tip>
  );
}
