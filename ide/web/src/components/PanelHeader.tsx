import type { ReactNode } from "react";
import type { IconName } from "../icons/registry";
import { IconButton } from "./IconButton";

export type HeaderAction = { id: string; icon: IconName; label: string; keys?: string; run: () => void; active?: boolean };

/** A tool window's header row, the same on every island: the bold title (or tabs) at the left, its
 *  icon actions at the right. */
export function PanelHeader({ title, children, actions }: { title?: string; children?: ReactNode; actions: readonly HeaderAction[] }) {
  return (
    <div className="flex h-(--header-h) shrink-0 items-center gap-2 px-3">
      {title && <h2 className="shrink-0 font-semibold">{title}</h2>}
      {children}
      {actions.length > 0 && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {actions.map((a) => <IconButton key={a.id} icon={a.icon} label={a.label} keys={a.keys} active={a.active} onClick={a.run} />)}
        </div>
      )}
    </div>
  );
}
