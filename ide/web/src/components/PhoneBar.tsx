import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

/** A phone's top bar: the frame colour and height of the desktop's toolbar, under the notch. */
export function PhoneBar({ children }: { children: ReactNode }) {
  return <header className="flex shrink-0 items-center gap-1 border-b border-line bg-frame pl-1 pr-1 pt-[env(safe-area-inset-top)]"><div className="flex h-(--header-h) min-w-0 flex-1 items-center gap-1">{children}</div></header>;
}

/** The toolbar widget a phone's bar names something with (a name and a chevron, as the desktop's run picker), a click opening its list. */
export function PhoneBarButton({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="inline-flex h-(--frame-control) min-w-0 items-center gap-1.5 rounded-control px-2 text-dense active:bg-pressed">
      {children}<span className="shrink-0 text-icon"><Icon name="chevron-down" /></span>
    </button>
  );
}

/** A page's way back: the chevron and the name of what it returns to. */
export function PhoneBack({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const look = "inline-flex h-(--frame-control) min-w-0 items-center gap-1 rounded-control pl-1 pr-2 text-dense text-fg-muted active:bg-pressed";
  const inner = <><span className="shrink-0 text-icon"><Icon name="chevron-left" size={20} /></span><span className="truncate">{children}</span></>;
  return href ? <a href={href} className={look}>{inner}</a> : <button type="button" onClick={onClick} className={look}>{inner}</button>;
}

/** A row in a phone's list leading to a page. */
export function PhoneRow({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const look = "flex min-h-13 w-full items-center gap-2 border-b border-line px-3 py-2 text-left active:bg-pressed";
  const inner = <><span className="min-w-0 flex-1">{children}</span><span className="shrink-0 text-icon"><Icon name="chevron-right" /></span></>;
  return href ? <a href={href} className={look}>{inner}</a> : <button type="button" onClick={onClick} className={look}>{inner}</button>;
}

/** A phone's page under its bar: it scrolls down to its end and never sideways (a wide table scrolls in its own box). */
export function PhonePage({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>;
}
