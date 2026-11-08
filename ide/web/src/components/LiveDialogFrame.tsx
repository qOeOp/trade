import { useEffect, useRef, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { FormButton } from "./chat/Field";

/** One scroll body; the same dialog becomes a full-screen form on a phone. */
export function LiveDialogFrame({ open, close, title, description, children, footer, steps, narrow = false, focusKey }: {
  open: boolean; close: () => void; title: string; description: string; children: ReactNode; footer: ReactNode;
  steps?: ReactNode; narrow?: boolean; focusKey?: string | number;
}) {
  const heading = useRef<HTMLHeadingElement>(null), body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) { heading.current?.focus(); if (body.current) body.current.scrollTop = 0; }
  }, [open, focusKey]);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
      <Dialog.Content onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus(); }}
        className={`fixed inset-0 z-50 flex h-dvh w-screen flex-col bg-popup text-dense shadow-popup outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-64px)] sm:max-w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-popup sm:border sm:border-popup-border ${narrow ? "sm:w-[520px]" : "sm:w-[720px]"}`}>
        <header className="shrink-0 space-y-3 border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Dialog.Title ref={heading} tabIndex={-1} className="text-ui font-semibold outline-none">{title}</Dialog.Title>
              <Dialog.Description className="text-small text-fg-muted">{description}</Dialog.Description>
            </div>
            <FormButton aria-label="Close dialog" onClick={close} className="min-w-0">Close</FormButton>
          </div>
          {steps}
        </header>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

const STEPS = ["Strategy", "Account & limits", "Review"];
export function LiveLaunchSteps({ step }: { step: number }) {
  return <ol aria-label="New live run steps" className="flex items-center gap-3 text-small">
    {STEPS.map((name, index) => <li key={name} aria-current={index === step ? "step" : undefined}
      className={`${index === step ? "flex text-fg" : "hidden text-fg-faint sm:flex"} min-w-0 items-center gap-2`}>
      <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${index === step ? "border-focus text-primary" : "border-line-strong"}`}>{index + 1}</span>
      <span><span className="sm:hidden">Step {index + 1} of 3 · </span>{name}</span>
    </li>)}
  </ol>;
}
