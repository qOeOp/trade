"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { dashboardRouteForPathname, moduleFor, parentTabFor } from "../lib/navigation.js";
import { DesktopModuleNavigation, MobileModuleDrawer } from "./module-navigation";
import { ModuleTabLinks } from "./module-tab-links";
import { ThemeToggle } from "./theme-toggle";
import { InterfaceIcons } from "./ui/iconography";

function TopBar({ current }: { current: string }) {
  const activeModule = moduleFor(current);
  const activeHref = parentTabFor(current);
  return (
    <header className="top-bar">
      <MobileModuleDrawer current={current} />
      <ModuleTabLinks activeHref={activeHref} ariaLabel={`${activeModule.label} pages`}
        className="module-tabs" tabs={activeModule.tabs} />
      <div className="top-actions">
        <button type="button" disabled title="Search is not admitted"><InterfaceIcons.search size={16} /><span className="sr-only">Search unavailable</span></button>
        <button type="button" disabled title="Notifications are not admitted"><InterfaceIcons.notification size={16} /><span className="sr-only">Notifications unavailable</span></button>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function DashboardChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = dashboardRouteForPathname(pathname);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return (
    <div className="dashboard-shell">
      <DesktopModuleNavigation current={current} />
      <main className="main-column">
        <TopBar current={current} />
        <div className="page-viewport" ref={viewportRef}>{children}</div>
      </main>
    </div>
  );
}
