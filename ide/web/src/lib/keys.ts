import { tinykeys } from "tinykeys";

/** A Mac, by tinykeys' own test: there `$mod` is ⌘, elsewhere Ctrl. */
const MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const NAMES: Record<string, string> = { "⌘": "Ctrl+", "⌃": "Ctrl+", "⌥": "Alt+", "⇧": "Shift+" };
/** A shortcut written with Mac symbols (⌘K, ⌥8, ⇧Esc) as this platform writes it: unchanged on a Mac,
 *  Ctrl+K, Alt+8, Shift+Esc elsewhere. */
export const keyLabel = (keys: string, mac = MAC) => (mac ? keys : keys.replace(/[⌘⌃⌥⇧]/g, (k) => NAMES[k]!));

/** True while the user is typing in a field, when single-key shortcuts must not fire. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

type Binding = { keys: string; run: () => void; whileTyping?: boolean };

/** Binds shortcuts on the window; returns the unbind function. */
export function bind(bindings: readonly Binding[]): () => void {
  return tinykeys(window, Object.fromEntries(bindings.map((b) => [b.keys, (e: KeyboardEvent) => {
    if (!b.whileTyping && typing(e)) return;
    e.preventDefault();
    b.run();
  }])));
}
