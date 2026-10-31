import { useRef, type ReactNode } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { useOverlayBars } from "../ScrollArea";

/** The thread's scrolling message list, with the islands' overlay scrollbars. It is assistant-ui's
 *  own viewport, which keeps the newest message in view while the reader stays at the bottom. */
export function ThreadViewport({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useOverlayBars(host, viewport);
  return (
    <div ref={host} className="relative min-h-0 flex-1">
      {/* OverlayScrollbars owns the viewport's padding, so the gutter is on the content inside it. */}
      {/* The last lines fade out above the message box rather than being cut at its edge. */}
      <ThreadPrimitive.Viewport ref={viewport} className="h-full overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]">
        <div className="flex min-h-full flex-col gap-4 px-3 py-3">{children}</div>
      </ThreadPrimitive.Viewport>
    </div>
  );
}
