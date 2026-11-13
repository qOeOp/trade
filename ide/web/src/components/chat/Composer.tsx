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
      {/* Send is the box's default action, filled blue (pale while there is nothing to send); Stop takes its
          place. `disabled` is passed only when set: a false one would override the library's empty-box state. */}
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        {model}
        <div className="ml-auto">
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send asChild><IconButton primary icon="arrow-up" label="Send" keys="↵" {...(disabled ? { disabled } : {})} /></ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild><IconButton primary icon="stop" label="Stop" /></ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
