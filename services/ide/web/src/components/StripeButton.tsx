import type { IconName } from "../icons/registry";
import { Icon } from "../icons/Icon";
import { Kbd } from "./Kbd";
import { Tip } from "./Tip";

/** A tool-window button on a side stripe: a frame control, the tool window's icon, a filled square while open. */
export function StripeButton({ icon, label, keys, active, onClick }: { icon: IconName; label: string; keys?: string; active: boolean; onClick: () => void }) {
  return (
    <Tip side="right" content={<span className="inline-flex items-center gap-2">{label}{keys && <Kbd>{keys}</Kbd>}</span>}>
      <button type="button" aria-label={label} aria-pressed={active} onClick={onClick}
              className={`grid size-(--frame-control) place-items-center rounded-popup transition-colors hover:bg-hover active:bg-pressed ${active ? "bg-pressed text-fg" : "text-icon"}`}>
        <Icon name={icon} size={20} />
      </button>
    </Tip>
  );
}
