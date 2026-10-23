import type { NotesWidget } from "../types";

export function Notes({ widget }: { widget: NotesWidget }) {
  if (!widget.items.length) return <p className="p-3 faint">无</p>;
  return (
    <ol className="space-y-1.5 p-3 text-[12px] muted">
      {widget.items.map((item, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_1fr]"><span className="mono faint">{String(i + 1).padStart(2, "0")}</span><span>{item}</span></li>
      ))}
    </ol>
  );
}
