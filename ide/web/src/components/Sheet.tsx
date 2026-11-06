import type { ReactNode } from "react";
import { Dialog, VisuallyHidden } from "radix-ui";

/** A phone's popup: the desktop's popup surface (hairline, shadow, popup radius on its top corners) risen from
 *  the foot over a scrim, its grab bar on top. It closes on the scrim, the bar, or the browser's Escape. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-island border-t border-popup-border bg-popup pb-[env(safe-area-inset-bottom)] shadow-popup outline-none">
          <VisuallyHidden.Root><Dialog.Title>{title}</Dialog.Title></VisuallyHidden.Root>
          <Dialog.Close aria-label="Close" className="grid h-6 w-full shrink-0 place-items-center"><i className="h-1 w-9 rounded-full bg-line-strong" /></Dialog.Close>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
