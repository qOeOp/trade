import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

/** A phone's top bar: the frame colour and height of the desktop's toolbar, under the notch. */
export function PhoneBar({ children }: { children: ReactNode }) {
  return <header className="flex shrink-0 items-center gap-1 border-b border-line bg-frame pl-1 pr-1 pt-[env(safe-area-inset-top)]"><div className="flex h-(--header-h) min-w-0 flex-1 items-center gap-1">{children}</div></header>;
}

/** A page's way back: the chevron and the name of what it returns to. */
export function PhoneBack({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-(--frame-control) min-w-0 items-center gap-1 rounded-control pl-1 pr-2 text-dense text-fg-muted active:bg-pressed">
    <span className="shrink-0 text-icon"><Icon name="chevron-left" size={20} /></span><span className="truncate">{children}</span>
  </button>;
}

/** A phone's page under its bar: it scrolls down to its end and never sideways (a wide table scrolls in its own box). */
export function PhonePage({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>;
}
