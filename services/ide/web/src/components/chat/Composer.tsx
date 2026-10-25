import type { ReactNode } from "react";
import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { IconButton } from "../IconButton";

// The message box: a card that grows with its text, Enter sends and Shift+Enter breaks the line; under
// it the model picker (`model`) and Send, which becomes Stop while an answer is being written.
export function Composer({ model, disabled }: { model: ReactNode; disabled: boolean }) {
  return (
    <ComposerPrimitive.Root className="rounded-card border border-card-border bg-island-alt transition-colors focus-within:border-focus">
      <ComposerPrimitive.Input disabled={disabled} submitMode="enter" rows={1} autoFocus
        placeholder={disabled ? "Add an agent and test it to start" : "Ask about strategies, runs or the ledger"}
        className="block max-h-48 w-full resize-none bg-transparent px-3 pt-2 pb-1 outline-none placeholder:text-fg-faint disabled:cursor-not-allowed" />
      <div className="flex items-center gap-1 px-1 pb-1">
        {model}
        <div className="ml-auto">
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send asChild><IconButton icon="arrow-up" label="Send" keys="↵" disabled={disabled} /></ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild><IconButton icon="stop" label="Stop" /></ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
