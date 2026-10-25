export function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-badge border border-line-strong bg-island px-1 font-mono text-small text-fg-faint">{children}</kbd>;
}
