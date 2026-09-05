"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { moduleFor, modules, parentTabFor } from "../lib/navigation.js";
import { ModuleTabLinks } from "./module-tab-links";
import { InterfaceIcons, ModuleIcons } from "./ui/iconography";

const iconByName = ModuleIcons;

function BrandMark() {
  return <a className="launcher-brand" href="/login" title="Local operator access" aria-label="Local operator access">VX</a>;
}

function ModuleRail({ current, id, onNavigate }: { current: string; id?: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Product modules" className="module-icon-rail" id={id}>
      {modules.map((module) => {
        const Icon = iconByName[module.icon as keyof typeof iconByName];
        const active = moduleFor(current).id === module.id;
        return (
          <a
            aria-current={active ? "page" : undefined}
            aria-label={module.label}
            className="rail-module-link"
            data-active={active || undefined}
            href={module.href}
            key={module.id}
            onClick={onNavigate}
            title={module.label}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.5} />
          </a>
        );
      })}
    </nav>
  );
}

export function DesktopModuleNavigation({ current }: { current: string }) {
  return (
    <aside className="desktop-side-column" aria-label="Dashboard navigation">
      <div className="module-launcher">
        <BrandMark />
        <span aria-hidden="true" className="module-trigger"><InterfaceIcons.menu size={14} /></span>
      </div>
      <ModuleRail current={current} />
    </aside>
  );
}

export function MobileModuleDrawer({ current }: { current: string }) {
  const [open, setOpen] = React.useState(false);
  const [portalReady, setPortalReady] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLElement>(null);
  const drawerId = React.useId();
  const activeModule = moduleFor(current);
  const activeHref = parentTabFor(current);

  const closeDrawer = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    first?.focus();

    const containDrawerFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key === "Tab" && first && last) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", containDrawerFocus);
    return () => window.removeEventListener("keydown", containDrawerFocus);
  }, [closeDrawer, open]);

  return (
    <div className="mobile-module-navigation">
      <nav className="module-launcher" aria-label="Dashboard navigation">
        <BrandMark />
        <button
          aria-controls={drawerId}
          aria-expanded={open}
          aria-label={open ? "Close modules" : "Open modules"}
          className="module-trigger"
          onClick={() => open ? closeDrawer() : setOpen(true)}
          ref={triggerRef}
          type="button"
        >
          <InterfaceIcons.menu aria-hidden="true" size={14} />
        </button>
      </nav>
      {portalReady && createPortal(
        <>
          <div aria-hidden={!open} className="module-drawer-layer" data-open={open}>
            <button aria-label="Close modules" className="module-drawer-backdrop" type="button" tabIndex={-1} onClick={closeDrawer} />
            <aside aria-label="Product modules drawer" className="module-drawer" id={drawerId} ref={drawerRef}>
              <ModuleRail current={current} onNavigate={closeDrawer} />
            </aside>
          </div>
          <ModuleTabLinks activeHref={activeHref} ariaLabel={`${activeModule.label} pages`}
            className="mobile-tab-dock" drawerOpen={open} tabs={activeModule.tabs} />
        </>,
        document.body,
      )}
    </div>
  );
}
