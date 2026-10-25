import { useEffect, useRef, type ReactNode } from "react";
import { OverlayScrollbars } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";

/** A region that scrolls with overlay scrollbars: thin lines on its edges (theme/base.css) instead of
 *  native bars. The inner element is the scroll viewport itself, so full-height content (the canvas,
 *  charts) sizes against it as before. */
export function ScrollArea({ children, className = "" }: { children: ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !viewport.current) return;
    const bars = OverlayScrollbars({ target: host.current, elements: { viewport: viewport.current } },
      { scrollbars: { theme: "os-theme-island", autoHide: "leave", autoHideDelay: 300 } });
    return () => bars.destroy();
  }, []);
  return (
    <div ref={host} className={`relative ${className}`}>
      <div ref={viewport} className="h-full overflow-auto">{children}</div>
    </div>
  );
}
