import type { NotesWidget } from "../model/types";

/** What the graph does not hold, numbered. */
export function Notes({ widget }: { widget: NotesWidget }) {
  if (!widget.items.length) return <p className="p-3 text-fg-faint">无</p>;
  return (
    <ol className="space-y-1.5 p-3 text-dense text-fg-muted">
      {widget.items.map((item, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_1fr]"><span className="text-fg-faint">{String(i + 1).padStart(2, "0")}</span><span>{item}</span></li>
      ))}
    </ol>
  );
}
