import { useRef, type ReactNode, type TouchEvent } from "react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { SCRIM } from "./dialog";

/** A phone's popup: the desktop's popup surface (hairline, shadow, popup radius on its top corners) risen from
 *  the foot over a scrim, its grab bar on top. It closes on the scrim, the bar, the browser's Escape, or dragged down
 *  from the bar or from its content scrolled to the top. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; by: number } | null>(null);
  const start = (e: TouchEvent) => {
    const t = e.touches[0]!;
    drag.current = body.current!.scrollTop <= 0 ? { x: t.clientX, y: t.clientY, by: 0 } : null;
  };
  const move = (e: TouchEvent) => {
    const d = drag.current, t = e.touches[0]!;
    if (!d) return;
    const by = t.clientY - d.y;
    // The first move decides: up scrolls the content, sideways scrolls a table or code in it.
    if (d.by === 0 && (by <= 0 || Math.abs(t.clientX - d.x) > by)) { drag.current = null; return; }
    d.by = Math.max(1, by);
    sheet.current!.style.transition = "none";
    sheet.current!.style.transform = `translateY(${d.by}px)`;
  };
  const end = () => {
    const d = drag.current, el = sheet.current;
    drag.current = null;
    if (!d || !el || d.by === 0) return;
    el.style.transition = "transform 180ms ease-out";
    el.style.transform = d.by > 72 ? "translateY(100%)" : "";
    if (d.by > 72) window.setTimeout(onClose, 180);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={SCRIM} />
        <Dialog.Content ref={sheet} onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end} aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-island border-t border-popup-border bg-popup pb-[env(safe-area-inset-bottom)] shadow-popup outline-none">
          <VisuallyHidden.Root><Dialog.Title>{title}</Dialog.Title></VisuallyHidden.Root>
          <Dialog.Close aria-label="Close" className="grid h-6 w-full shrink-0 place-items-center"><i className="h-1 w-9 rounded-full bg-line-strong" /></Dialog.Close>
          <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
