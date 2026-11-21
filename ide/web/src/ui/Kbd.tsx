import { keyLabel } from "../lib/keys";

/** A shortcut as the platform writes it: ⌘K on a Mac, Ctrl+K elsewhere. */
export function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-badge border border-line-strong bg-island px-1 font-mono text-small text-fg-faint">{keyLabel(children)}</kbd>;
}
