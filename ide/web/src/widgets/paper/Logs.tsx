import { useEffect, useState } from "react";
import { paperApi } from "../../lib/paperApi";
import { polled } from "../../lib/polled";
import { SkeletonLines } from "../../components/Missing";
import { TextButton } from "../../components/TextButton";

type Log = { paper_id: number; source: string; text: string; sealed: boolean };

/** Read a bounded tail; losing this browser never owns or stops the runner. */
export function Logs({ paperId }: { paperId: number }) {
  const [source, setSource] = useState("runner");
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLog(null); setError(null);
    const read = () => paperApi<Log>(`/runs/${paperId}/logs?source=${source}&tail=300`).then((log) => ({ log }),
      (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    return polled(read, (got) => "log" in got && got.log.sealed ? null : 5000, (got) => {
      if ("log" in got) { setLog(got.log); setError(null); } else setError(got.error);
    }).stop;
  }, [paperId, source]);
  return (
    <div className="space-y-2 p-3 text-dense">
      <div className="flex items-center gap-3">
        <TextButton onClick={() => setSource("runner")} active={source === "runner"}>Runner</TextButton>
        <TextButton onClick={() => setSource("egress")} active={source === "egress"}>Network</TextButton>
        <span className="ml-auto text-small text-fg-faint">{log?.sealed ? "Sealed capture" : "Refreshes every 5 seconds"} · latest 300 lines</span>
      </div>
      {error && <p role="status" className="text-misses-fg">Logs unavailable · {error}. Last received text is retained.</p>}
      {!log ? <div className="space-y-3"><SkeletonLines /><SkeletonLines /></div>
        : <pre className="whitespace-pre-wrap break-words font-mono text-small text-fg-muted">{log.text || "No log output yet"}</pre>}
    </div>
  );
}
