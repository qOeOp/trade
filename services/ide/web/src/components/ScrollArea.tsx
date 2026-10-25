import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { OverlayScrollbars } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";

/** Overlay scrollbars on `host` for an inner element that does the scrolling (a chat thread's own
 *  viewport, say). */
export function useOverlayBars(host: RefObject<HTMLElement | null>, viewport: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!host.current || !viewport.current) return;
    const bars = OverlayScrollbars({ target: host.current, elements: { viewport: viewport.current } },
      { scrollbars: { theme: "os-theme-island", autoHide: "leave", autoHideDelay: 300 } });
    return () => bars.destroy();
  }, [host, viewport]);
}

/** A region that scrolls with overlay scrollbars: thin lines on its edges (theme/base.css) instead of
 *  native bars. The inner element is the scroll viewport itself, so full-height content (the canvas,
 *  charts) sizes against it as before. */
export function ScrollArea({ children, className = "" }: { children: ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useOverlayBars(host, viewport);
  return (
    <div ref={host} className={`relative ${className}`}>
      <div ref={viewport} className="h-full overflow-auto">{children}</div>
    </div>
  );
}
