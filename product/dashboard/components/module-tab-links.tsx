"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState, type WheelEvent } from "react";

export function ModuleTabLinks({
  activeHref,
  ariaLabel,
  className,
  drawerOpen,
  tabs,
}: {
  activeHref: string;
  ariaLabel: string;
  className: "module-tabs" | "mobile-tab-dock";
  drawerOpen?: boolean;
  tabs: readonly { label: string; href: string }[];
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    setOverflow({
      start: nav.scrollLeft > 2,
      end: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2,
    });
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = activeRef.current;
    if (nav && active) {
      nav.scrollLeft = Math.max(0, active.offsetLeft - ((nav.clientWidth - active.offsetWidth) / 2));
    }
    updateOverflow();
    if (!nav) return undefined;
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(nav);
    Array.from(nav.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [activeHref, updateOverflow]);

  const scrollHorizontally = (event: WheelEvent<HTMLElement>) => {
    const nav = navRef.current;
    if (!nav || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.deltaY === 0) return;
    if (nav.scrollWidth <= nav.clientWidth) return;
    event.preventDefault();
    nav.scrollBy({ left: event.deltaY, behavior: "auto" });
  };

  return (
    <nav aria-label={ariaLabel} className={className}
      data-density={className === "module-tabs" && tabs.length >= 9 ? "compact" : undefined}
      data-overflow-end={overflow.end || undefined}
      data-overflow-start={overflow.start || undefined}
      data-drawer-open={className === "mobile-tab-dock" ? drawerOpen : undefined}
      onScroll={updateOverflow}
      onWheel={scrollHorizontally}
      ref={navRef}>
      {tabs.map((tab) => {
        const active = activeHref === tab.href;
        return <Link aria-current={active ? "page" : undefined} data-active={active || undefined}
          href={tab.href} key={tab.href} ref={active ? activeRef : undefined}>{tab.label}</Link>;
      })}
    </nav>
  );
}
