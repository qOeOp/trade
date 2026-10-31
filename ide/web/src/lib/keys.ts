import { tinykeys } from "tinykeys";

/** True while the user is typing in a field, when single-key shortcuts must not fire. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export type Binding = { keys: string; run: () => void; whileTyping?: boolean };

/** Binds shortcuts on the window; returns the unbind function. */
export function bind(bindings: readonly Binding[]): () => void {
  return tinykeys(window, Object.fromEntries(bindings.map((b) => [b.keys, (e: KeyboardEvent) => {
    if (!b.whileTyping && typing(e)) return;
    e.preventDefault();
    b.run();
  }])));
}
