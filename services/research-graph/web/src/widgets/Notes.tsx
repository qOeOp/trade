import type { NotesWidget } from "../types";

export function Notes({ widget }: { widget: NotesWidget }) {
  if (!widget.items.length) return <p className="faint">无</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 muted">
      {widget.items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}
