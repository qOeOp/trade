import { when } from "../lib/format";

/** The body of a tooltip about something that happened: what, to which version, when, which record. */
export function EventTip({ kind, version, at, record, note }: {
  kind: string; version?: string | null; at?: string | null; record?: string | null; note?: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{kind}</div>
      {version && <div className="font-mono">{version}</div>}
      <div className="font-mono text-fg-faint">{[when(at), record].filter(Boolean).join(" · ")}</div>
      {note && <div className="line-clamp-4 text-fg-muted">{note}</div>}
    </div>
  );
}
