import { useEffect, useState } from "react";
import { paperApi } from "../../lib/paperApi";
import { TextButton } from "../../components/TextButton";

type Log = { paper_id: number; source: string; text: string; sealed: boolean };

/** Read a bounded tail; losing this browser never owns or stops the runner. */
export function Logs({ paperId }: { paperId: number }) {
  const [source, setSource] = useState("runner");
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    setLog(null); setError(null);
    const read = async () => {
      try {
        const next = await paperApi<Log>(`/runs/${paperId}/logs?source=${source}&tail=300`);
        if (closed) return;
        setLog(next); setError(null);
        if (next.sealed) return;
      } catch (e) {
        if (closed) return;
        setError(e instanceof Error ? e.message : String(e));
      }
      timer = setTimeout(() => void read(), 5000);
    };
    void read();
    return () => { closed = true; clearTimeout(timer); };
  }, [paperId, source]);
  return (
    <div className="space-y-2 p-3 text-dense">
      <div className="flex items-center gap-3">
        <TextButton onClick={() => setSource("runner")} active={source === "runner"}>Runner</TextButton>
        <TextButton onClick={() => setSource("egress")} active={source === "egress"}>Network</TextButton>
        <span className="ml-auto text-small text-fg-faint">{log?.sealed ? "Sealed capture" : "Refreshes every 5 seconds"} · latest 300 lines</span>
      </div>
      {error && <p role="status" className="text-misses">Logs unavailable · {error}. Last received text is retained.</p>}
      <pre className="whitespace-pre-wrap break-words font-mono text-small text-fg-muted">{log?.text || (log ? "No log output yet" : "Reading logs…")}</pre>
    </div>
  );
}
