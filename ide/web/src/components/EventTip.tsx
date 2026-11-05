/** The body of a tooltip about something that happened: what and to which version. */
export function EventTip({ kind, version, note }: {
  kind: string; version?: string | null; note?: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{kind}</div>
      {version && <div className="font-mono">{version}</div>}
      {note && <div className="line-clamp-4 text-fg-muted">{note}</div>}
    </div>
  );
}
